const BASE_URL = 'https://www.alphavantage.co/query'

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || 'AAPL').toUpperCase()
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY

  if (!apiKey) {
    return res.status(500).json({
      error: 'Missing ALPHA_VANTAGE_API_KEY environment variable',
    })
  }

  const url = `${BASE_URL}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`

  try {
    const response = await fetch(url)
    const data = await response.json()

    if (data.Note || data.Information || data['Error Message']) {
      return res.status(429).json({
        error: data.Note || data.Information || data['Error Message'],
      })
    }

    const quote = data['Global Quote']

    if (!quote || !quote['05. price']) {
      return res.status(404).json({ error: `No quote found for symbol ${symbol}` })
    }

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120')

    return res.status(200).json({
      symbol,
      price: Number(quote['05. price']),
      open: Number(quote['02. open']),
      high: Number(quote['03. high']),
      low: Number(quote['04. low']),
      previousClose: Number(quote['08. previous close']),
      change: Number(quote['09. change']),
      changePercent: Number(String(quote['10. change percent'] || '0').replace('%', '')),
      latestTradingDay: quote['07. latest trading day'],
    })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Quote fetch failed' })
  }
}
