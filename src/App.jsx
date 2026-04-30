import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  buildForecast,
  buildTechnicalSnapshot,
  calculateSevenPercentRule,
  formatCurrency,
  formatPercent,
  getSignalLabel,
  getTradingWindowHint,
} from './utils/predictions'
import './App.css'

const MARKET_OPTIONS = [
  {
    key: 'US',
    label: 'US',
    suffix: '',
    watchlist: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA'],
    popular: ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA'],
    trending: ['NVDA', 'AMD', 'PLTR', 'SMCI', 'ARM', 'SNOW'],
    stable: ['JNJ', 'PG', 'KO', 'PEP', 'WMT', 'MCD'],
  },
  {
    key: 'NSE',
    label: 'India NSE',
    suffix: '.NS',
    watchlist: ['RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'SBIN.NS'],
    popular: ['RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'ITC.NS'],
    trending: ['TATAMOTORS.NS', 'ADANIENT.NS', 'TRENT.NS', 'BAJFINANCE.NS', 'HAL.NS', 'BEL.NS'],
    stable: ['HINDUNILVR.NS', 'NESTLEIND.NS', 'ASIANPAINT.NS', 'SUNPHARMA.NS', 'LT.NS', 'SBIN.NS'],
  },
  {
    key: 'BSE',
    label: 'India BSE',
    suffix: '.BO',
    watchlist: ['RELIANCE.BO', 'TCS.BO', 'INFY.BO', 'HDFCBANK.BO', 'ICICIBANK.BO', 'SBIN.BO'],
    popular: ['RELIANCE.BO', 'TCS.BO', 'INFY.BO', 'HDFCBANK.BO', 'ICICIBANK.BO', 'ITC.BO'],
    trending: ['TATAMOTORS.BO', 'ADANIENT.BO', 'BAJFINANCE.BO', 'TRENT.BO', 'HAL.BO', 'BEL.BO'],
    stable: ['HINDUNILVR.BO', 'NESTLEIND.BO', 'ASIANPAINT.BO', 'SUNPHARMA.BO', 'LT.BO', 'SBIN.BO'],
  },
  {
    key: 'UK',
    label: 'UK LSE',
    suffix: '.L',
    watchlist: ['VOD.L', 'HSBA.L', 'BP.L', 'AZN.L', 'BARC.L', 'RIO.L'],
    popular: ['HSBA.L', 'BP.L', 'VOD.L', 'AZN.L', 'GSK.L', 'SHEL.L'],
    trending: ['RR.L', 'NWG.L', 'BARC.L', 'GLEN.L', 'TSCO.L', 'BA.L'],
    stable: ['ULVR.L', 'DGE.L', 'REL.L', 'RKT.L', 'NG.L', 'LGEN.L'],
  },
  {
    key: 'JP',
    label: 'Japan TSE',
    suffix: '.T',
    watchlist: ['7203.T', '6758.T', '9984.T', '6861.T', '7974.T', '9432.T'],
    popular: ['7203.T', '6758.T', '9984.T', '6501.T', '9432.T', '8035.T'],
    trending: ['6920.T', '6146.T', '6857.T', '5411.T', '7267.T', '8306.T'],
    stable: ['2914.T', '4452.T', '9433.T', '9020.T', '4502.T', '2502.T'],
  },
]
const TIMEFRAMES = [
  { key: '5m', label: '5m' },
  { key: 'daily', label: 'Daily' },
  { key: 'hourly', label: 'Hourly' },
]
const QUOTE_POLL_BY_TIMEFRAME = {
  '5m': 5_000,
  daily: 60_000,
  hourly: 15_000,
}
const HISTORY_POLL_BY_TIMEFRAME = {
  '5m': 15_000,
  daily: 10 * 60_000,
  hourly: 60_000,
}
const INSIGHTS_POLL_BY_TIMEFRAME = {
  '5m': 3 * 60_000,
  daily: 15 * 60_000,
  hourly: 5 * 60_000,
}
const STALE_ALERT_SECONDS = 30
const CLIENT_ALPHA_KEY = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY
const SYMBOL_PATTERN = /^[A-Z0-9.-]{1,20}$/

function resolveMarketConfig(marketKey) {
  return MARKET_OPTIONS.find((item) => item.key === marketKey) || MARKET_OPTIONS[0]
}

function normalizeSymbolForMarket(value, marketKey) {
  const input = String(value || '').trim().toUpperCase()
  if (!input) return input

  if (input.includes('.')) return input

  const marketConfig = resolveMarketConfig(marketKey)
  if (!marketConfig.suffix) return input
  return `${input}${marketConfig.suffix}`
}

function parseQuotePayload(data, symbol) {
  const quote = data['Global Quote']
  if (!quote || !quote['05. price']) throw new Error(`No quote found for ${symbol}`)

  return {
    symbol,
    price: Number(quote['05. price']),
    open: Number(quote['02. open']),
    high: Number(quote['03. high']),
    low: Number(quote['04. low']),
    previousClose: Number(quote['08. previous close']),
    change: Number(quote['09. change']),
    changePercent: Number(String(quote['10. change percent'] || '0').replace('%', '')),
    latestTradingDay: quote['07. latest trading day'],
  }
}

function parseHistoryPayload(data, symbol) {
  const daily = data['Time Series (Daily)']
  if (!daily) throw new Error(`No history found for ${symbol}`)

  return Object.entries(daily)
    .map(([date, candle]) => ({
      date,
      open: Number(candle['1. open']),
      high: Number(candle['2. high']),
      low: Number(candle['3. low']),
      close: Number(candle['4. close']),
      volume: Number(candle['5. volume']),
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}

async function fetchJson(url) {
  const response = await fetch(url)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Request failed')
  }

  return data
}

async function fetchQuoteWithFallback(symbol) {
  try {
    return await fetchJson(`/api/quote?symbol=${encodeURIComponent(symbol)}`)
  } catch (serverError) {
    if (!CLIENT_ALPHA_KEY) throw serverError

    const data = await fetchJson(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(CLIENT_ALPHA_KEY)}`,
    )
    return parseQuotePayload(data, symbol)
  }
}

async function fetchHistoryWithFallback(symbol, timeframe) {
  try {
    const data = await fetchJson(`/api/history?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`)
    return data.prices
  } catch (serverError) {
    if (timeframe !== 'daily') throw serverError
    if (!CLIENT_ALPHA_KEY) throw serverError

    const data = await fetchJson(
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${encodeURIComponent(CLIENT_ALPHA_KEY)}`,
    )
    return parseHistoryPayload(data, symbol)
  }
}

async function fetchInsights(symbol) {
  return fetchJson(`/api/insights?symbol=${encodeURIComponent(symbol)}`)
}

function safeMetric(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A'
  return `${Number(value).toFixed(2)}${suffix}`
}

function App() {
  const [symbol, setSymbol] = useState('AAPL')
  const [market, setMarket] = useState('US')
  const [timeframe, setTimeframe] = useState('daily')
  const [analysisTab, setAnalysisTab] = useState('overview')
  const [trainSplitPercent, setTrainSplitPercent] = useState(75)
  const [symbolInput, setSymbolInput] = useState('')
  const [customSymbols, setCustomSymbols] = useState([])
  const [symbolError, setSymbolError] = useState('')
  const [quote, setQuote] = useState(null)
  const [history, setHistory] = useState([])
  const [insights, setInsights] = useState({
    fundamentals: { peRatio: null, eps: null, pbRatio: null, roe: null, source: 'unavailable' },
    sentiment: { score: 0.5, label: 'Neutral', details: 'Waiting for headlines...' },
    headlines: [],
  })
  const [entryPrice, setEntryPrice] = useState('')
  const [loadingQuote, setLoadingQuote] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [loadingInsights, setLoadingInsights] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [nowTick, setNowTick] = useState(Date.now())
  const [alertsEnabled, setAlertsEnabled] = useState(true)
  const [alertEvents, setAlertEvents] = useState([])
  const staleAlertLastTsRef = useRef(0)
  const staleActiveRef = useRef(false)
  const staleStartedAtRef = useRef(null)

  const activeMarket = useMemo(() => resolveMarketConfig(market), [market])

  const allSymbols = useMemo(() => {
    return [...new Set([...activeMarket.watchlist, ...customSymbols])]
  }, [activeMarket, customSymbols])

  const marketStockBuckets = useMemo(() => {
    return [
      { key: 'popular', label: 'Most Popular', symbols: activeMarket.popular || [] },
      { key: 'trending', label: 'Trending', symbols: activeMarket.trending || [] },
      { key: 'stable', label: 'Stable Picks', symbols: activeMarket.stable || [] },
    ]
  }, [activeMarket])

  const activateSymbol = (value) => {
    const next = normalizeSymbolForMarket(value, market)

    if (!SYMBOL_PATTERN.test(next)) {
      setSymbolError('Use a valid ticker format like AAPL, RELIANCE.NS, TCS.BO, or 7203.T.')
      return
    }

    setSymbolError('')
    setSymbol(next)
    setSymbolInput('')
    setCustomSymbols((prev) => {
      if (activeMarket.watchlist.includes(next) || prev.includes(next)) return prev
      return [next, ...prev].slice(0, 8)
    })
  }

  const switchMarket = (nextMarket) => {
    const marketConfig = resolveMarketConfig(nextMarket)
    setMarket(nextMarket)
    setSymbolError('')
    setSymbolInput('')
    setSymbol(marketConfig.watchlist[0] || 'AAPL')
    setCustomSymbols([])
  }

  useEffect(() => {
    let isMounted = true
    const pollMs = QUOTE_POLL_BY_TIMEFRAME[timeframe] || QUOTE_POLL_BY_TIMEFRAME.daily

    const loadQuote = async () => {
      try {
        const nextQuote = await fetchQuoteWithFallback(symbol)
        if (!isMounted) return
        setQuote(nextQuote)
        setLastUpdated(new Date())
        setError('')
      } catch (err) {
        if (!isMounted) return
        setError(err.message || 'Unable to load live quote')
      } finally {
        if (isMounted) setLoadingQuote(false)
      }
    }

    setLoadingQuote(true)
    loadQuote()
    const timer = setInterval(loadQuote, pollMs)

    return () => {
      isMounted = false
      clearInterval(timer)
    }
  }, [symbol, timeframe])

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let isMounted = true
    const pollMs = HISTORY_POLL_BY_TIMEFRAME[timeframe] || HISTORY_POLL_BY_TIMEFRAME.daily

    const loadHistory = async () => {
      try {
        const data = await fetchHistoryWithFallback(symbol, timeframe)
        if (!isMounted) return
        setHistory(data)
        setError('')
      } catch (err) {
        if (!isMounted) return
        setError(err.message || 'Unable to load history')
      } finally {
        if (isMounted) setLoadingHistory(false)
      }
    }

    setLoadingHistory(true)
    loadHistory()
    const timer = setInterval(loadHistory, pollMs)

    return () => {
      isMounted = false
      clearInterval(timer)
    }
  }, [symbol, timeframe])

  useEffect(() => {
    let isMounted = true
    const pollMs = INSIGHTS_POLL_BY_TIMEFRAME[timeframe] || INSIGHTS_POLL_BY_TIMEFRAME.daily

    const loadInsights = async () => {
      try {
        const data = await fetchInsights(symbol)
        if (!isMounted) return
        setInsights(data)
      } catch {
        if (!isMounted) return
        setInsights({
          fundamentals: { peRatio: null, eps: null, pbRatio: null, roe: null, source: 'unavailable' },
          sentiment: { score: 0.5, label: 'Neutral', details: 'Unable to load latest headlines.' },
          headlines: [],
        })
      } finally {
        if (isMounted) setLoadingInsights(false)
      }
    }

    setLoadingInsights(true)
    loadInsights()
    const timer = setInterval(loadInsights, pollMs)

    return () => {
      isMounted = false
      clearInterval(timer)
    }
  }, [symbol, timeframe])

  const model = useMemo(
    () => buildForecast(history, timeframe, {
      trainSplitPercent,
      currentPrice: quote?.price,
      liveChangePercent: quote?.changePercent,
    }),
    [history, timeframe, trainSplitPercent, quote],
  )
  const technical = useMemo(() => buildTechnicalSnapshot(history), [history])
  const tradingWindowHint = useMemo(() => getTradingWindowHint(), [])
  const sevenRule = useMemo(() => calculateSevenPercentRule(entryPrice, quote?.price), [entryPrice, quote])
  const secondsSinceUpdate = useMemo(() => {
    if (!lastUpdated) return null
    return Math.max(0, Math.floor((nowTick - new Date(lastUpdated).getTime()) / 1000))
  }, [lastUpdated, nowTick])

  const heartbeatState = useMemo(() => {
    if (secondsSinceUpdate === null) return { label: 'Waiting for first tick', tone: 'warn' }
    const pollMs = QUOTE_POLL_BY_TIMEFRAME[timeframe] || 60_000
    const staleAfter = Math.round((pollMs * 2.5) / 1000)
    if (secondsSinceUpdate <= Math.round(pollMs / 1000)) {
      return { label: `Live · ${secondsSinceUpdate}s ago`, tone: 'live' }
    }
    if (secondsSinceUpdate <= staleAfter) {
      return { label: `Lagging · ${secondsSinceUpdate}s ago`, tone: 'warn' }
    }
    return { label: `Stale · ${secondsSinceUpdate}s ago`, tone: 'stale' }
  }, [secondsSinceUpdate, timeframe])

  const isStaleForAlert = heartbeatState.tone === 'stale' && (secondsSinceUpdate || 0) >= STALE_ALERT_SECONDS

  useEffect(() => {
    if (!alertsEnabled || !isStaleForAlert) return

    const now = Date.now()
    if (now - staleAlertLastTsRef.current < STALE_ALERT_SECONDS * 1000) return

    staleAlertLastTsRef.current = now

    try {
      const context = new window.AudioContext()
      const oscillator = context.createOscillator()
      const gain = context.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(740, context.currentTime)
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35)

      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.36)

      oscillator.onended = () => {
        context.close().catch(() => {})
      }
    } catch {
      // Ignore browser autoplay restrictions for users who disable sound permission.
    }
  }, [alertsEnabled, isStaleForAlert, secondsSinceUpdate])

  useEffect(() => {
    const nowIso = new Date().toISOString()

    if (isStaleForAlert && !staleActiveRef.current) {
      staleActiveRef.current = true
      staleStartedAtRef.current = Date.now()
      setAlertEvents((prev) => [
        {
          id: `${Date.now()}-stale`,
          type: 'stale',
          at: nowIso,
          message: `Feed became stale (${secondsSinceUpdate || 0}s since last tick).`,
        },
        ...prev,
      ].slice(0, 12))
      return
    }

    if (!isStaleForAlert && staleActiveRef.current) {
      staleActiveRef.current = false
      const staleDurationMs = staleStartedAtRef.current ? Date.now() - staleStartedAtRef.current : 0
      staleStartedAtRef.current = null
      setAlertEvents((prev) => [
        {
          id: `${Date.now()}-recovered`,
          type: 'recovered',
          at: nowIso,
          message: `Feed recovered after ${Math.max(1, Math.round(staleDurationMs / 1000))}s stale window.`,
        },
        ...prev,
      ].slice(0, 12))
    }
  }, [isStaleForAlert, secondsSinceUpdate])

  const chartData = useMemo(() => {
    const dateFormat = timeframe === 'daily' ? 'DD MMM' : 'DD MMM HH:mm'
    const actual = history.map((item) => ({
      date: dayjs(item.date).format(dateFormat),
      actual: item.close,
      forecast: null,
      lower: null,
      upper: null,
    }))

    const future = model.forecast.map((point) => ({
      date: dayjs(point.date).format(dateFormat),
      actual: null,
      forecast: point.value,
      lower: point.lower,
      upper: point.upper,
    }))

    return [...actual.slice(-40), ...future]
  }, [history, model, timeframe])

  const backtestCurveData = useMemo(() => {
    const curve = model.walkForward?.equityCurve || []
    if (!curve.length) return []
    return curve.map((point, index) => ({
      step: index,
      ensemble: point.ensemble,
      trend: point.trend,
      reversion: point.reversion,
      ar1: point.ar1,
    }))
  }, [model])

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Realtime + Forecast Dashboard</p>
          <h1>Stock Pulse Lab</h1>
          <p className="subtitle">
            Track near realtime prices across Indian and global markets with timeframe-aware forecasts.
          </p>
        </div>
        <div>
          <div className="market-picker" role="tablist" aria-label="Market selection">
            {MARKET_OPTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === market ? 'market-btn active' : 'market-btn'}
                onClick={() => switchMarket(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <form
            className="symbol-form"
            onSubmit={(event) => {
              event.preventDefault()
              activateSymbol(symbolInput)
            }}
          >
            <input
              type="text"
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
              className="symbol-input"
              placeholder={activeMarket.suffix ? `Search ticker e.g. RELIANCE${activeMarket.suffix}` : 'Search ticker e.g. META'}
              aria-label="Search stock ticker"
            />
            <button type="submit" className="symbol-search-btn">Load</button>
          </form>
          <div className="timeframe-picker" role="tablist" aria-label="Chart timeframe">
            {TIMEFRAMES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === timeframe ? 'timeframe-btn active' : 'timeframe-btn'}
                onClick={() => setTimeframe(item.key)}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              className={alertsEnabled ? 'timeframe-btn alert-on' : 'timeframe-btn'}
              onClick={() => setAlertsEnabled((prev) => !prev)}
            >
              Alerts: {alertsEnabled ? 'On' : 'Off'}
            </button>
          </div>
          {symbolError && <p className="symbol-error">{symbolError}</p>}

          <div className="symbol-picker" role="tablist" aria-label="Stock symbols">
            {allSymbols.map((item) => (
              <button
                key={item}
                type="button"
                className={item === symbol ? 'symbol-btn active' : 'symbol-btn'}
                onClick={() => activateSymbol(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <section className="market-buckets-card" aria-label="Market stock buckets">
            <h3>{activeMarket.label} Buckets</h3>
            <p className="panel-sub">Quick picks grouped by popularity, momentum, and relative stability.</p>
            <div className="market-buckets-grid">
              {marketStockBuckets.map((bucket) => (
                <article key={bucket.key} className="market-bucket">
                  <h4>{bucket.label}</h4>
                  <div className="bucket-symbols">
                    {bucket.symbols.map((item) => (
                      <button
                        key={`${bucket.key}-${item}`}
                        type="button"
                        className={item === symbol ? 'bucket-symbol active' : 'bucket-symbol'}
                        onClick={() => activateSymbol(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </header>

      {error && <p className="error-banner">{error}</p>}

      <section className="kpi-grid">
        <article className="kpi-card strong">
          <p>Live Price</p>
          <h2>{loadingQuote || !quote ? '...' : formatCurrency(quote.price)}</h2>
          <span className={quote?.changePercent >= 0 ? 'up' : 'down'}>
            {quote ? `${formatPercent(quote.changePercent)} today` : 'Waiting for data'}
          </span>
        </article>

        <article className="kpi-card">
          <p>Forecast ({model.horizonLabel})</p>
          <h2>{model.forecast.at(-1) ? formatCurrency(model.forecast.at(-1).value) : '...'}</h2>
          <span>{model.signal}</span>
        </article>

        <article className="kpi-card">
          <p>Model Confidence</p>
          <h2>{model.confidenceLabel}</h2>
          <span>{getSignalLabel(model.score)}</span>
        </article>

        <article className="kpi-card">
          <p>Sentiment Pulse</p>
          <h2>{loadingInsights ? '...' : insights.sentiment.label}</h2>
          <span>{insights.sentiment.details}</span>
        </article>
      </section>

      <section className="heartbeat-row">
        <p className={`heartbeat-pill ${heartbeatState.tone} ${isStaleForAlert ? 'alerting' : ''}`}>
          Feed Health: {heartbeatState.label}
        </p>
        {isStaleForAlert && (
          <p className="stale-warning">
            Warning: feed is stale for {secondsSinceUpdate}s. Retry network or switch timeframe.
          </p>
        )}
      </section>

      <section className="alert-log-card">
        <h3>Alert Log</h3>
        <p className="panel-sub">Recent stale-feed events and recovery timestamps.</p>
        {alertEvents.length === 0 ? (
          <p className="panel-note">No alert events yet.</p>
        ) : (
          <ul className="alert-log-list">
            {alertEvents.map((event) => (
              <li key={event.id} className={event.type === 'stale' ? 'alert-stale' : 'alert-recovered'}>
                <span>{dayjs(event.at).format('DD MMM HH:mm:ss')}</span>
                <strong>{event.type === 'stale' ? 'STALE' : 'RECOVERED'}</strong>
                <em>{event.message}</em>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="analysis-tabs">
        <button
          type="button"
          className={analysisTab === 'overview' ? 'analysis-tab active' : 'analysis-tab'}
          onClick={() => setAnalysisTab('overview')}
        >
          Market Overview
        </button>
        <button
          type="button"
          className={analysisTab === 'backtest' ? 'analysis-tab active' : 'analysis-tab'}
          onClick={() => setAnalysisTab('backtest')}
        >
          Strategy Backtest
        </button>
      </section>

      {analysisTab === 'overview' ? (
        <>

      <section className="panel-grid">
        <article className="panel-card">
          <h3>Fundamental Analysis</h3>
          <p className="panel-sub">Intrinsic-value lens using core company metrics.</p>
          <div className="metric-grid">
            <div><span>P/E</span><strong>{safeMetric(insights.fundamentals.peRatio)}</strong></div>
            <div><span>EPS</span><strong>{safeMetric(insights.fundamentals.eps)}</strong></div>
            <div><span>P/B</span><strong>{safeMetric(insights.fundamentals.pbRatio)}</strong></div>
            <div><span>ROE</span><strong>{safeMetric(insights.fundamentals.roe, '%')}</strong></div>
          </div>
          <p className="panel-note">
            Source: {insights.fundamentals.source === 'alpha-vantage' ? 'Alpha Vantage' : 'Set ALPHA_VANTAGE_API_KEY for fundamentals'}
          </p>
        </article>

        <article className="panel-card">
          <h3>Technical Analysis</h3>
          <p className="panel-sub">Indicators from price charts, volume, and momentum.</p>
          <div className="metric-grid">
            <div><span>SMA 20</span><strong>{safeMetric(technical.sma20)}</strong></div>
            <div><span>EMA 20</span><strong>{safeMetric(technical.ema20)}</strong></div>
            <div><span>RSI 14</span><strong>{safeMetric(technical.rsi14)}</strong></div>
            <div><span>Trend</span><strong>{technical.trend}</strong></div>
            <div><span>Support</span><strong>{safeMetric(technical.support)}</strong></div>
            <div><span>Resistance</span><strong>{safeMetric(technical.resistance)}</strong></div>
            <div><span>Bollinger Upper</span><strong>{safeMetric(technical.bollinger.upper)}</strong></div>
            <div><span>Bollinger Lower</span><strong>{safeMetric(technical.bollinger.lower)}</strong></div>
            <div><span>Annualized Volatility</span><strong>{safeMetric(technical.realizedVolatility, '%')}</strong></div>
            <div><span>Momentum (3)</span><strong>{safeMetric(technical.momentum3, '%')}</strong></div>
            <div><span>Momentum (10)</span><strong>{safeMetric(technical.momentum10, '%')}</strong></div>
          </div>
        </article>

        <article className="panel-card">
          <h3>Sentiment Analysis</h3>
          <p className="panel-sub">Headlines and publisher language to capture investor psychology.</p>
          <p className="panel-note">Score: {safeMetric(insights.sentiment.score * 100, '%')} ({insights.sentiment.label})</p>
          <ul className="headline-list">
            {insights.headlines.length === 0 && <li>No headlines available right now.</li>}
            {insights.headlines.slice(0, 4).map((item) => (
              <li key={item.link || item.title}>
                <a href={item.link} target="_blank" rel="noreferrer">{item.title}</a>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel-card">
          <h3>Machine Learning Pipeline</h3>
          <p className="panel-sub">Data collection, preprocessing, feature engineering, model blending, and validation.</p>
          <div className="metric-grid">
            <div><span>Data Split</span><strong>75% train / 25% test</strong></div>
            <div><span>Model Family</span><strong>Ensemble (Trend + Reversion + AR)</strong></div>
            <div><span>RMSE</span><strong>{safeMetric(model.evaluation.rmse)}</strong></div>
            <div><span>MAPE</span><strong>{safeMetric(model.evaluation.mape, '%')}</strong></div>
            <div><span>Samples</span><strong>{model.evaluation.sampleSize}</strong></div>
            <div><span>Momentum Signal</span><strong>{safeMetric(model.featureDiagnostics?.momentumSignal, '%')}</strong></div>
            <div><span>Volatility Signal</span><strong>{safeMetric(model.featureDiagnostics?.volatilitySignal, '%')}</strong></div>
            <div><span>Trend Signal</span><strong>{safeMetric(model.featureDiagnostics?.trendSignal, '%')}</strong></div>
          </div>
          <p className="panel-note">Model leaderboard (lower RMSE/MAPE is better):</p>
          <ul className="model-list">
            {(model.modelComparison || []).map((item) => (
              <li key={item.name}>
                <span>{item.name}</span>
                <strong>W {safeMetric(item.weight, '%')}</strong>
                <em>RMSE {safeMetric(item.rmse)} · MAPE {safeMetric(item.mape, '%')}</em>
              </li>
            ))}
          </ul>
          <p className="panel-note">Walk-forward backtest:</p>
          <ul className="model-list">
            {(model.walkForward?.modelStats || []).map((item) => (
              <li key={item.name}>
                <span>{item.name}</span>
                <strong>{safeMetric(item.hitRate, '%')} hit</strong>
                <em>Return {safeMetric(item.totalReturn, '%')} · MaxDD {safeMetric(item.maxDrawdown, '%')}</em>
              </li>
            ))}
          </ul>
          <p className="panel-note">
            Best walk-forward strategy: {model.walkForward?.bestModel ? `${model.walkForward.bestModel.name} (${safeMetric(model.walkForward.bestModel.totalReturn, '%')})` : 'N/A'}
          </p>
          <p className="panel-note">Next upgrade path: LSTM, gradient boosting, and regime-switching models.</p>
        </article>
      </section>

      <section className="chart-card">
        <div className="chart-head">
          <h3>{symbol} Price Path</h3>
          <p>Solid line: historical close. Dashed: model forecast with confidence band.</p>
        </div>
      </section>

      <section className="chart-wrap">
        {loadingHistory ? (
          <p className="loading">Loading chart...</p>
        ) : (
          <ResponsiveContainer width="100%" height={390}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="date" tick={{ fill: '#C6C2DA', fontSize: 12 }} />
              <YAxis tick={{ fill: '#C6C2DA', fontSize: 12 }} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{
                  background: '#111129',
                  border: '1px solid #2C2B56',
                  borderRadius: '10px',
                }}
              />
              <Legend />
              <Line type="monotone" dataKey="actual" stroke="#58E5A7" strokeWidth={2.5} dot={false} name="Actual" />
              <Line type="monotone" dataKey="forecast" stroke="#FFC857" strokeWidth={2.5} dot={false} strokeDasharray="5 5" name="Forecast" />
              <Line type="monotone" dataKey="upper" stroke="#FF6B6B" strokeWidth={1} dot={false} name="Upper Band" />
              <Line type="monotone" dataKey="lower" stroke="#4D96FF" strokeWidth={1} dot={false} name="Lower Band" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="risk-grid">
        <article className="panel-card">
          <h3>Risk Management</h3>
          <p className="panel-sub">Apply practical rules before placing or adjusting a trade.</p>
          <label className="entry-label" htmlFor="entryPrice">Entry Price</label>
          <input
            id="entryPrice"
            className="symbol-input"
            type="number"
            min="0"
            step="0.01"
            placeholder="Enter your buy price"
            value={entryPrice}
            onChange={(event) => setEntryPrice(event.target.value)}
          />
          <p className="panel-note">7% rule stop-loss: {sevenRule.stopPrice ? formatCurrency(sevenRule.stopPrice) : 'N/A'}</p>
          <p className="panel-note">{sevenRule.status}</p>
          <p className="panel-note">{tradingWindowHint}</p>
          <p className="panel-note">Diversification reminder: spread exposure across sectors and market caps.</p>
        </article>

        <article className="panel-card">
          <h3>Best Practices & Pitfalls</h3>
          <p className="panel-sub">Forecasts improve with discipline, not certainty.</p>
          <ul className="headline-list">
            <li>Use fundamentals + technicals + sentiment + model outputs together.</li>
            <li>Avoid overfitting: validate using out-of-sample periods.</li>
            <li>Do not rely only on technical signals for long-term investing.</li>
            <li>Treat projections as probability ranges, not guarantees.</li>
          </ul>
          <p className="panel-note">Last refresh: {lastUpdated ? dayjs(lastUpdated).format('HH:mm:ss') : '--:--:--'} (updates every {Math.round((QUOTE_POLL_BY_TIMEFRAME[timeframe] || 60000) / 1000)}s)</p>
          <p className="panel-note">Active market: {activeMarket.label}</p>
          <p className="panel-note">Active mode: {timeframe === '5m' ? '5m (ultra-fast intraday)' : timeframe === 'hourly' ? 'Hourly (fast refresh)' : 'Daily (swing trend view)'}</p>
        </article>
      </section>
        </>
      ) : (
        <section className="backtest-card">
          <h3>Walk-Forward Strategy Backtest</h3>
          <p className="panel-sub">Compare equity growth across models with configurable train/test split.</p>

          <div className="split-control">
            <label htmlFor="trainSplit">Train Split: {trainSplitPercent}%</label>
            <input
              id="trainSplit"
              type="range"
              min="60"
              max="90"
              step="1"
              value={trainSplitPercent}
              onChange={(event) => setTrainSplitPercent(Number(event.target.value))}
            />
          </div>

          <div className="metric-grid" style={{ marginBottom: '12px' }}>
            <div><span>Backtest Samples</span><strong>{model.walkForward?.sampleSize || 0}</strong></div>
            <div><span>Start Equity</span><strong>{formatCurrency(model.walkForward?.startEquity || 10000)}</strong></div>
            <div><span>Best Strategy</span><strong>{model.walkForward?.bestModel?.name || 'N/A'}</strong></div>
            <div><span>Best Return</span><strong>{safeMetric(model.walkForward?.bestModel?.totalReturn, '%')}</strong></div>
          </div>

          <div className="backtest-chart">
            {backtestCurveData.length === 0 ? (
              <p className="loading">Not enough history for backtest curve.</p>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={backtestCurveData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="step" tick={{ fill: '#C6C2DA', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#C6C2DA', fontSize: 12 }} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{
                      background: '#111129',
                      border: '1px solid #2C2B56',
                      borderRadius: '10px',
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="ensemble" stroke="#58E5A7" strokeWidth={2.6} dot={false} name="Ensemble" />
                  <Line type="monotone" dataKey="trend" stroke="#FFC857" strokeWidth={1.7} dot={false} name="Trend" />
                  <Line type="monotone" dataKey="reversion" stroke="#4D96FF" strokeWidth={1.7} dot={false} name="Reversion" />
                  <Line type="monotone" dataKey="ar1" stroke="#FF7F50" strokeWidth={1.7} dot={false} name="AR(1)" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <ul className="model-list">
            {(model.walkForward?.modelStats || []).map((item) => (
              <li key={item.name}>
                <span>{item.name}</span>
                <strong>{safeMetric(item.hitRate, '%')} hit</strong>
                <em>Return {safeMetric(item.totalReturn, '%')} · MaxDD {safeMetric(item.maxDrawdown, '%')}</em>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="footer-note">
        <p>
          Educational use only, not financial advice. Free API tiers may delay prices and enforce rate limits.
        </p>
      </footer>
    </main>
  )
}

export default App
