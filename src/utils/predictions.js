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

function sma(values, period) {
  if (values.length < period) return null
  return mean(values.slice(-period))
}

function ema(values, period) {
  if (values.length < period) return null

  const multiplier = 2 / (period + 1)
  let current = mean(values.slice(0, period))
  for (let i = period; i < values.length; i += 1) {
    current = (values[i] - current) * multiplier + current
  }
  return current
}

function rsi(values, period = 14) {
  if (values.length <= period) return null

  let gains = 0
  let losses = 0

  for (let i = values.length - period; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1]
    if (delta >= 0) gains += delta
    else losses += Math.abs(delta)
  }

  const avgGain = gains / period
  const avgLoss = losses / period

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

function bollinger(values, period = 20, width = 2) {
  if (values.length < period) return { middle: null, upper: null, lower: null }

  const window = values.slice(-period)
  const middle = mean(window)
  const sigma = std(window)

  return {
    middle,
    upper: middle + sigma * width,
    lower: middle - sigma * width,
  }
}

function evaluateModel(closes, lookback = 30) {
  if (closes.length < lookback + 10) {
    return { rmse: null, mape: null, sampleSize: 0 }
  }

  const errorsSquared = []
  const percentErrors = []

  for (let i = lookback; i < closes.length - 1; i += 1) {
    const train = closes.slice(i - lookback, i)
    const slope = linearRegressionSlope(train)
    const drift = train.at(-1) === 0 ? 0 : slope / train.at(-1)
    const predicted = train.at(-1) * (1 + drift)
    const actual = closes[i]
    const diff = actual - predicted

    errorsSquared.push(diff ** 2)
    if (actual !== 0) {
      percentErrors.push(Math.abs(diff / actual))
    }
  }

  return {
    rmse: errorsSquared.length ? Math.sqrt(mean(errorsSquared)) : null,
    mape: percentErrors.length ? mean(percentErrors) * 100 : null,
    sampleSize: errorsSquared.length,
  }
}

export function buildTechnicalSnapshot(history) {
  if (!Array.isArray(history) || history.length < 30) {
    return {
      sma20: null,
      ema20: null,
      rsi14: null,
      bollinger: { middle: null, upper: null, lower: null },
      support: null,
      resistance: null,
      trend: 'Insufficient data',
    }
  }

  const closes = history.map((point) => point.close)
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  const ema20 = ema(closes, 20)
  const rsi14 = rsi(closes, 14)
  const bb = bollinger(closes, 20, 2)

  const recent = history.slice(-20)
  const support = Math.min(...recent.map((point) => point.low || point.close))
  const resistance = Math.max(...recent.map((point) => point.high || point.close))

  let trend = 'Sideways'
  if (sma20 && sma50 && sma20 > sma50 * 1.01) trend = 'Uptrend'
  if (sma20 && sma50 && sma20 < sma50 * 0.99) trend = 'Downtrend'

  return {
    sma20,
    ema20,
    rsi14,
    bollinger: bb,
    support,
    resistance,
    trend,
  }
}

export function getTradingWindowHint() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const [hour, minute] = formatter.format(new Date()).split(':').map(Number)
  const totalMinutes = hour * 60 + minute
  const tenAm = 10 * 60

  if (totalMinutes < tenAm) {
    return 'Before 10:00 AM ET: volatility is often elevated in the opening session.'
  }
  return 'After 10:00 AM ET: opening volatility has usually cooled versus market open.'
}

export function calculateSevenPercentRule(entryPrice, currentPrice) {
  const entry = Number(entryPrice || 0)
  const current = Number(currentPrice || 0)
  if (!entry || entry <= 0) {
    return { stopPrice: null, status: 'Set entry price to evaluate risk.' }
  }

  const stopPrice = entry * 0.93
  const breached = current > 0 ? current <= stopPrice : false
  return {
    stopPrice,
    status: breached ? 'Stop-loss threshold breached (7% rule).' : 'Position is above the 7% stop-loss threshold.',
  }
}

export function buildForecast(history, timeframe = 'daily') {
  if (!Array.isArray(history) || history.length < 25) {
    return {
      forecast: [],
      signal: 'Need more historical candles',
      confidenceLabel: 'Low',
      score: 0.5,
      evaluation: { rmse: null, mape: null, sampleSize: 0 },
      horizonLabel: timeframe === 'hourly' ? 'Hour +24' : 'Day +7',
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
  const steps = timeframe === 'hourly' ? 24 : 7
  const lookback = timeframe === 'hourly' ? 48 : 30
  const volatilityScale = timeframe === 'hourly' ? 1.1 : 1.6

  for (let step = 1; step <= steps; step += 1) {
    const projection = lastClose * (1 + dailyDrift * step)
    const uncertainty = lastClose * returnVolatility * Math.sqrt(step) * volatilityScale
    const date = new Date(latestDate)
    if (timeframe === 'hourly') {
      date.setHours(date.getHours() + step)
    } else {
      date.setDate(date.getDate() + step)
    }

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

  const evaluation = evaluateModel(closes, lookback)

  return {
    forecast,
    signal: getSignalLabel(score),
    confidenceLabel,
    score,
    evaluation,
    horizonLabel: timeframe === 'hourly' ? 'Hour +24' : 'Day +7',
  }
}
