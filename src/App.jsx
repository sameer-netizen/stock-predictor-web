import { useEffect, useMemo, useState } from 'react'
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

const WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA']
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
const CLIENT_ALPHA_KEY = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY
const SYMBOL_PATTERN = /^[A-Z.-]{1,10}$/

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
  const [timeframe, setTimeframe] = useState('daily')
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

  const allSymbols = useMemo(() => {
    return [...new Set([...WATCHLIST, ...customSymbols])]
  }, [customSymbols])

  const activateSymbol = (value) => {
    const next = String(value || '').trim().toUpperCase()

    if (!SYMBOL_PATTERN.test(next)) {
      setSymbolError('Use a valid ticker format like AAPL, BRK-B, or TSLA.')
      return
    }

    setSymbolError('')
    setSymbol(next)
    setSymbolInput('')
    setCustomSymbols((prev) => {
      if (WATCHLIST.includes(next) || prev.includes(next)) return prev
      return [next, ...prev].slice(0, 8)
    })
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

  const model = useMemo(() => buildForecast(history, timeframe), [history, timeframe])
  const technical = useMemo(() => buildTechnicalSnapshot(history), [history])
  const tradingWindowHint = useMemo(() => getTradingWindowHint(), [])
  const sevenRule = useMemo(() => calculateSevenPercentRule(entryPrice, quote?.price), [entryPrice, quote])

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

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Realtime + Forecast Dashboard</p>
          <h1>Stock Pulse Lab</h1>
          <p className="subtitle">
            Track near realtime prices and switch between daily and hourly monitoring with timeframe-aware forecasts.
          </p>
        </div>
        <div>
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
              placeholder="Search ticker e.g. META"
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
          <p className="panel-sub">Data collection, preprocessing, feature engineering, training, and evaluation.</p>
          <div className="metric-grid">
            <div><span>Data Split</span><strong>75% train / 25% test</strong></div>
            <div><span>Model Family</span><strong>Trend + Volatility</strong></div>
            <div><span>RMSE</span><strong>{safeMetric(model.evaluation.rmse)}</strong></div>
            <div><span>MAPE</span><strong>{safeMetric(model.evaluation.mape, '%')}</strong></div>
            <div><span>Samples</span><strong>{model.evaluation.sampleSize}</strong></div>
          </div>
          <p className="panel-note">Alternative algorithms to compare: LSTM, ARIMA, Random Forest, SVM.</p>
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
          <p className="panel-note">Active mode: {timeframe === '5m' ? '5m (ultra-fast intraday)' : timeframe === 'hourly' ? 'Hourly (fast refresh)' : 'Daily (swing trend view)'}</p>
        </article>
      </section>

      <footer className="footer-note">
        <p>
          Educational use only, not financial advice. Free API tiers may delay prices and enforce rate limits.
        </p>
      </footer>
    </main>
  )
}

export default App
