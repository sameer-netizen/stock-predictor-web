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
import { buildForecast, formatCurrency, formatPercent, getSignalLabel } from './utils/predictions'
import './App.css'

const WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA']
const POLL_INTERVAL_MS = 60_000
const CLIENT_ALPHA_KEY = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY

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

async function fetchHistoryWithFallback(symbol) {
  try {
    const data = await fetchJson(`/api/history?symbol=${encodeURIComponent(symbol)}`)
    return data.prices
  } catch (serverError) {
    if (!CLIENT_ALPHA_KEY) throw serverError

    const data = await fetchJson(
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${encodeURIComponent(CLIENT_ALPHA_KEY)}`,
    )
    return parseHistoryPayload(data, symbol)
  }
}

function App() {
  const [symbol, setSymbol] = useState('AAPL')
  const [quote, setQuote] = useState(null)
  const [history, setHistory] = useState([])
  const [loadingQuote, setLoadingQuote] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    let isMounted = true

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
    const timer = setInterval(loadQuote, POLL_INTERVAL_MS)

    return () => {
      isMounted = false
      clearInterval(timer)
    }
  }, [symbol])

  useEffect(() => {
    let isMounted = true

    const loadHistory = async () => {
      try {
        const data = await fetchHistoryWithFallback(symbol)
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

    return () => {
      isMounted = false
    }
  }, [symbol])

  const model = useMemo(() => buildForecast(history), [history])

  const chartData = useMemo(() => {
    const actual = history.map((item) => ({
      date: dayjs(item.date).format('DD MMM'),
      actual: item.close,
      forecast: null,
      lower: null,
      upper: null,
    }))

    const future = model.forecast.map((point) => ({
      date: dayjs(point.date).format('DD MMM'),
      actual: null,
      forecast: point.value,
      lower: point.lower,
      upper: point.upper,
    }))

    return [...actual.slice(-40), ...future]
  }, [history, model])

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Realtime + Forecast Dashboard</p>
          <h1>Stock Pulse Lab</h1>
          <p className="subtitle">
            Track near realtime prices and estimate the next 7 sessions with a trend-plus-volatility model.
          </p>
        </div>
        <div className="symbol-picker" role="tablist" aria-label="Stock symbols">
          {WATCHLIST.map((item) => (
            <button
              key={item}
              type="button"
              className={item === symbol ? 'symbol-btn active' : 'symbol-btn'}
              onClick={() => setSymbol(item)}
            >
              {item}
            </button>
          ))}
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
          <p>Forecast (Day +7)</p>
          <h2>{model.forecast[6] ? formatCurrency(model.forecast[6].value) : '...'}</h2>
          <span>{model.signal}</span>
        </article>

        <article className="kpi-card">
          <p>Model Confidence</p>
          <h2>{model.confidenceLabel}</h2>
          <span>{getSignalLabel(model.score)}</span>
        </article>

        <article className="kpi-card">
          <p>Last Refresh</p>
          <h2>{lastUpdated ? dayjs(lastUpdated).format('HH:mm:ss') : '--:--:--'}</h2>
          <span>Auto updates every 60s</span>
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

      <footer className="footer-note">
        <p>
          Educational use only, not financial advice. Free API tiers may delay prices and enforce rate limits.
        </p>
      </footer>
    </main>
  )
}

export default App
