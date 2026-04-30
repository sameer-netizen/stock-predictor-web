const ALPHA_BASE_URL = 'https://www.alphavantage.co/query'
const YAHOO_BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart'

function finiteOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function getYahooWindow(timeframe) {
  if (timeframe === '5m') {
    return { range: '5d', interval: '5m' }
  }
  if (timeframe === 'hourly') {
    return { range: '1mo', interval: '1h' }
  }
  return { range: '6mo', interval: '1d' }
}

function normalizeTimeframe(raw) {
  const value = String(raw || 'daily').toLowerCase()
  if (value === '5m') return '5m'
  if (value === 'hourly') return 'hourly'
  return 'daily'
}

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || 'AAPL').toUpperCase()
  const timeframe = normalizeTimeframe(req.query.timeframe)
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY

  try {
    const { range, interval } = getYahooWindow(timeframe)
    const yahooUrl = `${YAHOO_BASE_URL}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
    const yahooResponse = await fetch(yahooUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    const yahooData = await yahooResponse.json()

    const result = yahooData?.chart?.result?.[0]
    const timestamps = result?.timestamp || []
    const quote = result?.indicators?.quote?.[0] || {}

    if (timestamps.length > 0 && Array.isArray(quote.close)) {
      const prices = timestamps
        .map((ts, index) => {
          const close = finiteOrNull(quote.close?.[index])
          if (close === null || close <= 0) return null

          const open = finiteOrNull(quote.open?.[index]) ?? close
          const highRaw = finiteOrNull(quote.high?.[index])
          const lowRaw = finiteOrNull(quote.low?.[index])
          const high = highRaw ?? Math.max(open, close)
          const low = lowRaw ?? Math.min(open, close)

          return {
            date: new Date(ts * 1000).toISOString(),
            open,
            high: Math.max(high, open, close),
            low: Math.min(low, open, close),
            close,
            volume: Number(finiteOrNull(quote.volume?.[index]) || 0),
          }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(a.date) - new Date(b.date))

      if (prices.length > 0) {
        const cacheWindow = timeframe === 'daily'
          ? 's-maxage=900, stale-while-revalidate=3600'
          : timeframe === 'hourly'
            ? 's-maxage=120, stale-while-revalidate=300'
            : 's-maxage=30, stale-while-revalidate=120'
        res.setHeader('Cache-Control', cacheWindow)
        return res.status(200).json({ symbol, timeframe, prices })
      }
    }

    if (timeframe !== 'daily') {
      return res.status(404).json({ error: `No ${timeframe} history found for symbol ${symbol}` })
    }

    if (!apiKey) {
      return res.status(404).json({ error: `No daily history found for symbol ${symbol}` })
    }

    // Optional fallback to Alpha Vantage for symbols Yahoo cannot provide.
    const alphaUrl = `${ALPHA_BASE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`
    const alphaResponse = await fetch(alphaUrl)
    const alphaData = await alphaResponse.json()

    if (alphaData.Note || alphaData.Information || alphaData['Error Message']) {
      return res.status(429).json({
        error: alphaData.Note || alphaData.Information || alphaData['Error Message'],
      })
    }

    const daily = alphaData['Time Series (Daily)']
    if (!daily) {
      return res.status(404).json({ error: `No daily history found for symbol ${symbol}` })
    }

    const prices = Object.entries(daily)
      .map(([date, candle]) => ({
        date,
        open: Number(candle['1. open']),
        high: Number(candle['2. high']),
        low: Number(candle['3. low']),
        close: Number(candle['4. close']),
        volume: Number(candle['5. volume']),
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date))

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600')

    return res.status(200).json({ symbol, timeframe, prices })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'History fetch failed' })
  }
}
