const BASE_URL = 'https://www.alphavantage.co/query'

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || 'AAPL').toUpperCase()
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY

  if (!apiKey) {
    return res.status(500).json({
      error: 'Missing ALPHA_VANTAGE_API_KEY environment variable',
    })
  }

  const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`

  try {
    const response = await fetch(url)
    const data = await response.json()

    if (data.Note || data.Information || data['Error Message']) {
      return res.status(429).json({
        error: data.Note || data.Information || data['Error Message'],
      })
    }

    const daily = data['Time Series (Daily)']
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
