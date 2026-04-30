const ALPHA_BASE_URL = 'https://www.alphavantage.co/query'
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search'

const STOPWORDS = new Set([
  'the', 'inc', 'corp', 'corporation', 'company', 'co', 'group', 'holdings',
  'plc', 'sa', 'ag', 'nv', 'and', 'for', 'class', 'common', 'stock',
])

function buildSymbolTokens(symbol) {
  return String(symbol || '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length > 1)
}

function buildCompanyTokens(name) {
  return String(name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
}

function isHeadlineRelevant(item, symbol, symbolTokens, companyTokens) {
  const title = String(item.title || '').toLowerCase()
  const text = `${title}`
  const normalizedSymbol = String(symbol || '').toUpperCase()

  if (text.includes(normalizedSymbol.toLowerCase())) return true

  const hasSymbolMatch = symbolTokens.some((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase()
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text)
  })

  if (hasSymbolMatch) return true

  return companyTokens.some((token) => text.includes(token))
}

function scoreHeadlines(news) {
  const positiveWords = ['beat', 'growth', 'upgrade', 'surge', 'record', 'strong', 'bullish', 'outperform']
  const negativeWords = ['miss', 'downgrade', 'fall', 'lawsuit', 'weak', 'bearish', 'risk', 'drop']

  let positiveHits = 0
  let negativeHits = 0

  news.forEach((item) => {
    const text = `${item.title || ''} ${item.publisher || ''}`.toLowerCase()
    positiveWords.forEach((word) => {
      if (text.includes(word)) positiveHits += 1
    })
    negativeWords.forEach((word) => {
      if (text.includes(word)) negativeHits += 1
    })
  })

  const total = positiveHits + negativeHits
  if (total === 0) {
    return { score: 0.5, label: 'Neutral', details: 'Headlines are mixed or low-signal.' }
  }

  const score = positiveHits / total
  if (score > 0.62) {
    return { score, label: 'Positive', details: 'News flow leans constructive.' }
  }
  if (score < 0.38) {
    return { score, label: 'Negative', details: 'News flow leans cautious.' }
  }
  return { score, label: 'Neutral', details: 'Headlines are balanced.' }
}

function buildNeutralSentimentForNoCoverage(symbol) {
  return {
    score: 0.5,
    label: 'Neutral',
    details: `No strongly ${symbol}-specific headlines were found in the latest feed.`,
  }
}

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || 'AAPL').toUpperCase()
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY

  try {
    const newsResponse = await fetch(
      `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=8`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    )
    const newsData = await newsResponse.json()

    const symbolTokens = buildSymbolTokens(symbol)
    const companyTokens = buildCompanyTokens(newsData.quotes?.[0]?.longname || newsData.quotes?.[0]?.shortname || '')

    const rawHeadlines = (newsData.news || []).slice(0, 10).map((item) => ({
      title: item.title || 'Untitled',
      publisher: item.publisher || 'Unknown',
      link: item.link || '',
      relatedTickers: item.relatedTickers || [],
    }))

    const relevantHeadlines = rawHeadlines.filter((item) => isHeadlineRelevant(item, symbol, symbolTokens, companyTokens))
    const headlines = relevantHeadlines.slice(0, 6)

    const sentiment = headlines.length > 0
      ? scoreHeadlines(headlines)
      : buildNeutralSentimentForNoCoverage(symbol)

    const relevanceCount = relevantHeadlines.length
    const relevanceRatio = rawHeadlines.length
      ? Math.round((relevanceCount / rawHeadlines.length) * 100)
      : 0
    const sentimentWithContext = {
      ...sentiment,
      details: `${sentiment.details} Based on ${headlines.length} ${symbol}-related headlines (${relevanceRatio}% relevance).`,
    }

    let fundamentals = {
      peRatio: null,
      eps: null,
      pbRatio: null,
      roe: null,
      source: 'unavailable',
    }

    if (apiKey) {
      const alphaResponse = await fetch(
        `${ALPHA_BASE_URL}?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`,
      )
      const alphaData = await alphaResponse.json()

      if (!alphaData.Note && !alphaData.Information && !alphaData['Error Message']) {
        fundamentals = {
          peRatio: Number(alphaData.PERatio || 0) || null,
          eps: Number(alphaData.EPS || 0) || null,
          pbRatio: Number(alphaData.PriceToBookRatio || 0) || null,
          roe: Number(alphaData.ReturnOnEquityTTM || 0) || null,
          source: 'alpha-vantage',
        }
      }
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900')

    return res.status(200).json({
      symbol,
      fundamentals,
      sentiment: sentimentWithContext,
      headlines,
    })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Insights fetch failed' })
  }
}
