const ALPHA_BASE_URL = 'https://www.alphavantage.co/query'
const YAHOO_BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart'

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || 'AAPL').toUpperCase()
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY

  try {
    const yahooUrl = `${YAHOO_BASE_URL}/${encodeURIComponent(symbol)}?range=6mo&interval=1d`
    const yahooResponse = await fetch(yahooUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    const yahooData = await yahooResponse.json()

    const result = yahooData?.chart?.result?.[0]
    const timestamps = result?.timestamp || []
    const quote = result?.indicators?.quote?.[0] || {}

    if (timestamps.length > 0 && Array.isArray(quote.close)) {
      const prices = timestamps
        .map((ts, index) => ({
          date: new Date(ts * 1000).toISOString().slice(0, 10),
          open: Number(quote.open?.[index] || 0),
          high: Number(quote.high?.[index] || 0),
          low: Number(quote.low?.[index] || 0),
          close: Number(quote.close?.[index] || 0),
          volume: Number(quote.volume?.[index] || 0),
        }))
        .filter((point) => Number.isFinite(point.close) && point.close > 0)
        .sort((a, b) => new Date(a.date) - new Date(b.date))

      if (prices.length > 0) {
        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600')
        return res.status(200).json({ symbol, prices })
      }
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

    return res.status(200).json({ symbol, prices })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'History fetch failed' })
  }
}
