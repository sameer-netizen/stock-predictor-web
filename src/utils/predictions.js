function mean(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function std(values) {
  if (values.length < 2) return 0
  const avg = mean(values)
  const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function linearRegressionSlope(values) {
  if (values.length < 2) return 0

  const xAvg = (values.length - 1) / 2
  const yAvg = mean(values)

  let numerator = 0
  let denominator = 0

  values.forEach((value, index) => {
    numerator += (index - xAvg) * (value - yAvg)
    denominator += (index - xAvg) ** 2
  })

  return denominator === 0 ? 0 : numerator / denominator
}

export function formatCurrency(amount) {
  return Number(amount || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

export function formatPercent(value) {
  const parsed = Number(value || 0)
  const prefix = parsed > 0 ? '+' : ''
  return `${prefix}${parsed.toFixed(2)}%`
}

export function getSignalLabel(score) {
  if (score > 0.65) return 'Momentum bias: Bullish'
  if (score < 0.35) return 'Momentum bias: Bearish'
  return 'Momentum bias: Sideways'
}

export function buildForecast(history) {
  if (!Array.isArray(history) || history.length < 25) {
    return {
      forecast: [],
      signal: 'Need more historical candles',
      confidenceLabel: 'Low',
      score: 0.5,
    }
  }

  const closes = history.map((point) => point.close)
  const returns = closes.slice(1).map((value, index) => (value - closes[index]) / closes[index])

  const shortWindow = closes.slice(-7)
  const longWindow = closes.slice(-21)

  const trendSlope = linearRegressionSlope(closes.slice(-20))
  const shortMA = mean(shortWindow)
  const longMA = mean(longWindow)
  const returnVolatility = std(returns.slice(-30))

  const maSignal = longMA === 0 ? 0 : (shortMA - longMA) / longMA
  const normalizedSlope = closes.at(-1) ? trendSlope / closes.at(-1) : 0

  const scoreRaw = 0.5 + (maSignal * 5 + normalizedSlope * 12)
  const score = Math.max(0, Math.min(1, scoreRaw))

  const latestDate = new Date(history.at(-1).date)
  const lastClose = closes.at(-1)

  const dailyDrift = normalizedSlope + maSignal * 0.35
  const forecast = []

  for (let day = 1; day <= 7; day += 1) {
    const projection = lastClose * (1 + dailyDrift * day)
    const uncertainty = lastClose * returnVolatility * Math.sqrt(day) * 1.6
    const date = new Date(latestDate)
    date.setDate(date.getDate() + day)

    forecast.push({
      date: date.toISOString(),
      value: Number(projection.toFixed(2)),
      lower: Number((projection - uncertainty).toFixed(2)),
      upper: Number((projection + uncertainty).toFixed(2)),
    })
  }

  let confidenceLabel = 'Low'
  if (returnVolatility < 0.015) confidenceLabel = 'High'
  else if (returnVolatility < 0.03) confidenceLabel = 'Medium'

  return {
    forecast,
    signal: getSignalLabel(score),
    confidenceLabel,
    score,
  }
}
