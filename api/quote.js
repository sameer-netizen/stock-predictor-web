const ALPHA_BASE_URL = 'https://www.alphavantage.co/query'
const YAHOO_BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart'

function finiteOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || 'AAPL').toUpperCase()
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY

  try {
    const yahooUrl = `${YAHOO_BASE_URL}/${encodeURIComponent(symbol)}?range=5d&interval=1d`
    const yahooResponse = await fetch(yahooUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    const yahooData = await yahooResponse.json()

    const result = yahooData?.chart?.result?.[0]
    const meta = result?.meta
    const timestamps = result?.timestamp || []
    const quotes = result?.indicators?.quote?.[0] || {}
    const closes = Array.isArray(quotes.close)
      ? quotes.close.map((value) => finiteOrNull(value)).filter((value) => value !== null)
      : []
    const opens = Array.isArray(quotes.open)
      ? quotes.open.map((value) => finiteOrNull(value)).filter((value) => value !== null)
      : []
    const highs = Array.isArray(quotes.high)
      ? quotes.high.map((value) => finiteOrNull(value)).filter((value) => value !== null)
      : []
    const lows = Array.isArray(quotes.low)
      ? quotes.low.map((value) => finiteOrNull(value)).filter((value) => value !== null)
      : []

    if (meta?.regularMarketPrice && closes.length > 0) {
      const marketPrice = Number(meta.regularMarketPrice)
      const prevFromSeries = closes.length > 1 ? closes[closes.length - 2] : null
      const previousClose = prevFromSeries ?? finiteOrNull(meta.previousClose) ?? marketPrice
      const open = finiteOrNull(meta.regularMarketOpen) ?? opens.at(-1) ?? previousClose
      const high = finiteOrNull(meta.regularMarketDayHigh) ?? highs.at(-1) ?? Math.max(marketPrice, open, previousClose)
      const low = finiteOrNull(meta.regularMarketDayLow) ?? lows.at(-1) ?? Math.min(marketPrice, open, previousClose)

      const change = marketPrice - previousClose
      const baseline = previousClose || marketPrice
      const changePercent = baseline === 0 ? 0 : (change / baseline) * 100

      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120')

      return res.status(200).json({
        symbol,
        price: Number(marketPrice.toFixed(4)),
        open: Number(open.toFixed(4)),
        high: Number(high.toFixed(4)),
        low: Number(low.toFixed(4)),
        previousClose: Number(previousClose.toFixed(4)),
        change: Number(change.toFixed(4)),
        changePercent: Number(changePercent.toFixed(4)),
        latestTradingDay: timestamps.length ? new Date(timestamps[timestamps.length - 1] * 1000).toISOString().slice(0, 10) : '',
      })
    }

    if (!apiKey) {
      return res.status(404).json({ error: `No quote found for symbol ${symbol}` })
    }

    // Optional fallback to Alpha Vantage if Yahoo does not return the symbol.
    const alphaUrl = `${ALPHA_BASE_URL}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`
    const alphaResponse = await fetch(alphaUrl)
    const alphaData = await alphaResponse.json()

    if (alphaData.Note || alphaData.Information || alphaData['Error Message']) {
      return res.status(429).json({
        error: alphaData.Note || alphaData.Information || alphaData['Error Message'],
      })
    }

    const quote = alphaData['Global Quote']
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
