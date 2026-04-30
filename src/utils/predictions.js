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

function quantile(values, q) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * clamp(q, 0, 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  const weight = index - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

function computeReturns(closes) {
  return closes.slice(1).map((value, index) => {
    const prev = closes[index]
    if (!prev) return 0
    return (value - prev) / prev
  })
}

function buildRobustCloses(closes) {
  if (closes.length < 8) return [...closes]

  const rawReturns = computeReturns(closes).filter((item) => Number.isFinite(item))
  const low = quantile(rawReturns, 0.03)
  const high = quantile(rawReturns, 0.97)

  const cleaned = [closes[0]]
  for (let i = 1; i < closes.length; i += 1) {
    const prev = cleaned[i - 1]
    const rawReturn = prev ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0
    const clippedReturn = clamp(rawReturn, low, high)
    cleaned.push(Math.max(0.01, prev * (1 + clippedReturn)))
  }

  return cleaned
}

function weightedMetrics(samples) {
  if (!samples.length) return { rmse: null, mape: null, sampleSize: 0 }

  const weightedSe = samples.reduce((acc, item) => acc + item.weight * item.se, 0)
  const weightedApe = samples.reduce((acc, item) => acc + item.weight * item.ape, 0)
  const totalWeight = samples.reduce((acc, item) => acc + item.weight, 0) || 1

  return {
    rmse: Math.sqrt(weightedSe / totalWeight),
    mape: (weightedApe / totalWeight) * 100,
    sampleSize: samples.length,
  }
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function clampInt(value, min, max) {
  return Math.round(clamp(value, min, max))
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

function evaluateModel(closes, lookback = 30, predictor = trendPredict) {
  return evaluateGenericModel(closes, lookback, predictor)
}

function evaluateGenericModel(closes, lookback, predictor) {
  if (closes.length < lookback + 10) {
    return { rmse: null, mape: null, sampleSize: 0 }
  }

  const totalSteps = closes.length - lookback - 1
  const samples = []

  for (let i = lookback; i < closes.length - 1; i += 1) {
    const train = closes.slice(i - lookback, i)
    const predicted = predictor(train)
    const actual = closes[i]
    const diff = actual - predicted

    const relativePos = samples.length / Math.max(1, totalSteps)
    const weight = 0.3 + relativePos * 0.7
    samples.push({
      se: diff ** 2,
      ape: actual !== 0 ? Math.abs(diff / actual) : 0,
      weight,
    })
  }

  return weightedMetrics(samples)
}

function trendPredict(train) {
  const slope = linearRegressionSlope(train)
  const drift = train.at(-1) === 0 ? 0 : slope / train.at(-1)
  return train.at(-1) * (1 + drift)
}

function meanReversionPredict(train) {
  const last = train.at(-1)
  const center = mean(train.slice(-Math.min(20, train.length)))
  const adjustment = (center - last) * 0.35
  return Math.max(0.01, last + adjustment)
}

function ar1Predict(train) {
  if (train.length < 4) return train.at(-1)

  const returns = train.slice(1).map((value, index) => {
    const prev = train[index]
    if (!prev) return 0
    return (value - prev) / prev
  })

  const x = returns.slice(0, -1)
  const y = returns.slice(1)
  const xMean = mean(x)
  const yMean = mean(y)
  const variance = x.reduce((acc, value) => acc + (value - xMean) ** 2, 0)
  const covariance = x.reduce((acc, value, index) => acc + ((value - xMean) * (y[index] - yMean)), 0)

  const phi = variance === 0 ? 0 : covariance / variance
  const lastReturn = returns.at(-1) || 0
  const meanReturn = mean(returns)
  const predictedReturn = clamp(phi * lastReturn + (1 - Math.min(1, Math.abs(phi))) * meanReturn, -0.08, 0.08)

  return Math.max(0.01, train.at(-1) * (1 + predictedReturn))
}

function adaptiveEmaPredict(train) {
  if (train.length < 6) return train.at(-1)
  const fast = ema(train, 6) || train.at(-1)
  const slow = ema(train, 18) || train.at(-1)
  const momentum = slow === 0 ? 0 : (fast - slow) / slow
  const blend = clamp(0.5 + momentum * 8, 0.2, 0.85)
  const baseline = fast * blend + slow * (1 - blend)
  const cappedMove = clamp(momentum, -0.06, 0.06)
  return Math.max(0.01, baseline * (1 + cappedMove * 0.5))
}

function estimateMarketRegime(closes) {
  const returns = computeReturns(closes)
  const recentReturns = returns.slice(-25)
  const vol = std(recentReturns)
  const trend = closes.length > 15 && closes.at(-1)
    ? linearRegressionSlope(closes.slice(-15)) / closes.at(-1)
    : 0
  const center = mean(closes.slice(-Math.min(20, closes.length)))
  const distanceFromMean = center ? Math.abs((closes.at(-1) - center) / center) : 0
  const latestMove = Math.abs(returns.at(-1) || 0)
  const shockRatio = vol > 0 ? latestMove / vol : 0

  return {
    trendStrength: Math.abs(trend),
    trendDirection: trend,
    volatility: vol,
    distanceFromMean,
    shockRatio,
  }
}

function regimeMultiplier(modelKey, regime) {
  const trendBoost = 1 + clamp(regime.trendStrength * 55, 0, 1.2)
  const volPenalty = 1 - clamp(regime.volatility * 10, 0, 0.35)
  const meanRevBoost = 1 + clamp(regime.distanceFromMean * 4, 0, 1)
  const shockPenalty = regime.shockRatio > 2.6 ? 0.9 : 1

  if (modelKey === 'trend') return trendBoost * volPenalty
  if (modelKey === 'reversion') return meanRevBoost * (regime.volatility > 0.018 ? 1.15 : 1)
  if (modelKey === 'ar1') return (regime.volatility > 0.01 && regime.volatility < 0.04 ? 1.1 : 0.95) * shockPenalty
  if (modelKey === 'adaptive') return 1.12 * shockPenalty
  return 1
}

function evaluateRecentModel(closes, lookback, predictor, recentSteps = 35) {
  if (closes.length < lookback + 10) return { rmse: null, mape: null, sampleSize: 0 }

  const start = Math.max(lookback, closes.length - recentSteps - 1)
  const samples = []
  for (let i = start; i < closes.length - 1; i += 1) {
    const train = closes.slice(i - lookback, i)
    const predicted = predictor(train)
    const actual = closes[i]
    const diff = actual - predicted
    const progressiveWeight = 0.4 + ((i - start + 1) / Math.max(1, closes.length - 1 - start)) * 0.6

    samples.push({
      se: diff ** 2,
      ape: actual !== 0 ? Math.abs(diff / actual) : 0,
      weight: progressiveWeight,
    })
  }

  return weightedMetrics(samples)
}

function estimateResidualProfile(closes, lookback, modelSuite) {
  if (closes.length < lookback + 12) {
    return { residualSigma: 0.015, lowerQuantile: -0.02, upperQuantile: 0.02 }
  }

  const residuals = []
  for (let i = lookback; i < closes.length - 1; i += 1) {
    const train = closes.slice(i - lookback, i)
    const base = closes[i]
    if (!base) continue

    const projected = modelSuite.reduce((sum, model) => sum + model.predictor(train) * model.weight, 0)
    const actual = closes[i + 1]
    const residualReturn = (actual - projected) / base
    if (Number.isFinite(residualReturn)) residuals.push(residualReturn)
  }

  const sigma = std(residuals) || 0.015
  return {
    residualSigma: clamp(sigma, 0.006, 0.08),
    lowerQuantile: quantile(residuals, 0.1),
    upperQuantile: quantile(residuals, 0.9),
  }
}

function ensemblePredict(train, modelSuite) {
  return modelSuite.reduce((sum, model) => sum + model.predictor(train) * model.weight, 0)
}

function evaluateDirectionalAccuracy(closes, lookback, predictor, recentSteps = 45) {
  if (closes.length < lookback + 10) return { hitRate: 0, sampleSize: 0 }

  const start = Math.max(lookback, closes.length - recentSteps - 1)
  let hits = 0
  let trades = 0

  for (let i = start; i < closes.length - 1; i += 1) {
    const train = closes.slice(i - lookback, i)
    const now = closes[i]
    const next = closes[i + 1]
    if (!now || !next) continue

    const predicted = predictor(train)
    const predictedDirection = predicted >= now ? 1 : -1
    const actualDirection = next >= now ? 1 : -1
    if (predictedDirection === actualDirection) hits += 1
    trades += 1
  }

  return {
    hitRate: trades ? (hits / trades) * 100 : 0,
    sampleSize: trades,
  }
}

function tuneLookback(closes, baseLookback, minLookback, maxLookback) {
  const candidateOffsets = [-24, -16, -8, 0, 8, 16, 24]
  const candidates = [...new Set(candidateOffsets
    .map((offset) => clampInt(baseLookback + offset, minLookback, maxLookback)))]

  const scored = candidates.map((lookback) => {
    const suite = computeModelSuite(closes, lookback)
    const recentEval = evaluateRecentModel(
      closes,
      lookback,
      (train) => ensemblePredict(train, suite),
      45,
    )
    const direction = evaluateDirectionalAccuracy(
      closes,
      lookback,
      (train) => ensemblePredict(train, suite),
      45,
    )

    const rmse = recentEval.rmse || Number.POSITIVE_INFINITY
    const mape = recentEval.mape || Number.POSITIVE_INFINITY
    const hitRate = direction.hitRate || 0
    const priceScale = mean(closes.slice(-Math.min(20, closes.length))) || closes.at(-1) || 1
    const normalizedRmse = rmse / Math.max(priceScale, 0.0001)

    // Lower score is better: penalize scaled error, reward directional accuracy.
    const score = normalizedRmse * 0.55 + (mape / 100) * 0.35 - (hitRate / 100) * 0.2

    return {
      lookback,
      score,
      recentRmse: recentEval.rmse,
      recentMape: recentEval.mape,
      hitRate,
      sampleSize: recentEval.sampleSize,
    }
  })

  const best = [...scored].sort((a, b) => a.score - b.score)[0]
  return {
    bestLookback: best?.lookback || baseLookback,
    diagnostics: scored,
    bestDiagnostics: best || null,
  }
}

function applyLiveAnchor(closes, timeframe, currentPrice) {
  const live = Number(currentPrice)
  if (!Number.isFinite(live) || live <= 0 || !closes.length) {
    return { closes: [...closes], anchorGapPercent: 0 }
  }

  const anchored = [...closes]
  const last = anchored.at(-1)
  if (!last || !Number.isFinite(last) || last <= 0) {
    return { closes: anchored, anchorGapPercent: 0 }
  }

  const rawGap = (live - last) / last
  const clampedGap = clamp(rawGap, -0.06, 0.06)
  const anchorStrength = timeframe === '5m' ? 0.98 : timeframe === 'hourly' ? 0.88 : 0.62
  const anchoredLast = last * (1 - anchorStrength) + live * anchorStrength
  anchored[anchored.length - 1] = Math.max(0.01, anchoredLast)

  return {
    closes: anchored,
    anchorGapPercent: clampedGap * 100,
  }
}

function computeModelSuite(closes, lookback) {
  const modelDefs = [
    { key: 'trend', name: 'Trend Regression', predictor: trendPredict },
    { key: 'reversion', name: 'Mean Reversion', predictor: meanReversionPredict },
    { key: 'ar1', name: 'Autoregressive AR(1)', predictor: ar1Predict },
    { key: 'adaptive', name: 'Adaptive EMA Blend', predictor: adaptiveEmaPredict },
  ]

  const regime = estimateMarketRegime(closes)

  const models = modelDefs.map((model) => {
    const metrics = evaluateGenericModel(closes, lookback, model.predictor)
    const recentMetrics = evaluateRecentModel(closes, lookback, model.predictor)
    return {
      ...model,
      metrics,
      recentMetrics,
    }
  })

  const validRmses = models
    .map((model) => model.metrics.rmse)
    .filter((value) => Number.isFinite(value) && value > 0)
  const fallbackRmse = validRmses.length ? mean(validRmses) : 1

  const weightBase = models.map((model) => {
    const rmse = model.metrics.rmse || fallbackRmse
    const recentRmse = model.recentMetrics.rmse || rmse
    const blendedRmse = rmse * 0.45 + recentRmse * 0.55
    const regimeBias = regimeMultiplier(model.key, regime)
    return (1 / Math.max(blendedRmse, 0.0001)) * regimeBias
  })
  const weightTotal = weightBase.reduce((acc, value) => acc + value, 0) || 1

  return models.map((model, index) => ({
    ...model,
    weight: weightBase[index] / weightTotal,
  }))
}

function computeDrawdown(equityCurve) {
  if (!equityCurve.length) return 0
  let peak = equityCurve[0]
  let maxDrawdown = 0

  equityCurve.forEach((value) => {
    if (value > peak) peak = value
    const dd = peak === 0 ? 0 : ((peak - value) / peak) * 100
    if (dd > maxDrawdown) maxDrawdown = dd
  })

  return maxDrawdown
}

function buildWalkForwardBacktest(closes, lookback, modelSuite) {
  if (closes.length < lookback + 20) {
    return {
      sampleSize: 0,
      startEquity: 10000,
      modelStats: [],
      bestModel: null,
    }
  }

  const startEquity = 10000
  const states = modelSuite.reduce((acc, model) => {
    acc[model.key] = {
      equity: startEquity,
      hits: 0,
      trades: 0,
      curve: [startEquity],
    }
    return acc
  }, {})

  const ensembleState = {
    equity: startEquity,
    hits: 0,
    trades: 0,
    curve: [startEquity],
  }

  for (let i = lookback; i < closes.length - 1; i += 1) {
    const train = closes.slice(i - lookback, i)
    const now = closes[i]
    const next = closes[i + 1]
    if (!now || !next) continue

    const predictions = modelSuite.map((model) => {
      const predicted = model.predictor(train)
      const direction = predicted >= now ? 1 : -1
      const actualReturn = (next - now) / now
      const tradeReturn = direction * actualReturn

      const state = states[model.key]
      state.equity *= (1 + tradeReturn)
      state.trades += 1
      if ((next - now) * direction > 0) state.hits += 1
      state.curve.push(state.equity)

      return {
        key: model.key,
        direction,
        weight: model.weight,
      }
    })

    const ensembleDirectionScore = predictions.reduce((sum, item) => sum + item.direction * item.weight, 0)
    const ensembleDirection = ensembleDirectionScore >= 0 ? 1 : -1
    const actualReturn = (next - now) / now
    const ensembleReturn = ensembleDirection * actualReturn

    ensembleState.equity *= (1 + ensembleReturn)
    ensembleState.trades += 1
    if ((next - now) * ensembleDirection > 0) ensembleState.hits += 1
    ensembleState.curve.push(ensembleState.equity)
  }

  const modelStats = [
    ...modelSuite.map((model) => {
      const state = states[model.key]
      const totalReturn = ((state.equity / startEquity) - 1) * 100
      return {
        key: model.key,
        name: model.name,
        type: 'model',
        hitRate: state.trades ? (state.hits / state.trades) * 100 : 0,
        totalReturn,
        maxDrawdown: computeDrawdown(state.curve),
      }
    }),
    {
      key: 'ensemble',
      name: 'Ensemble Strategy',
      type: 'ensemble',
      hitRate: ensembleState.trades ? (ensembleState.hits / ensembleState.trades) * 100 : 0,
      totalReturn: ((ensembleState.equity / startEquity) - 1) * 100,
      maxDrawdown: computeDrawdown(ensembleState.curve),
    },
  ]

  const bestModel = [...modelStats].sort((a, b) => b.totalReturn - a.totalReturn)[0] || null

  const maxLength = Math.max(
    ensembleState.curve.length,
    ...modelSuite.map((model) => states[model.key].curve.length),
  )

  const equityCurve = Array.from({ length: maxLength }, (_, index) => {
    const point = {
      step: index,
      ensemble: Number((ensembleState.curve[index] || ensembleState.curve.at(-1) || startEquity).toFixed(2)),
    }
    modelSuite.forEach((model) => {
      const value = states[model.key].curve[index] || states[model.key].curve.at(-1) || startEquity
      point[model.key] = Number(value.toFixed(2))
    })
    return point
  })

  return {
    sampleSize: ensembleState.trades,
    startEquity,
    modelStats,
    bestModel,
    equityCurve,
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
  const returns = closes.slice(1).map((value, index) => {
    const prev = closes[index]
    if (!prev) return 0
    return (value - prev) / prev
  })
  const realizedVolatility = std(returns.slice(-20)) * Math.sqrt(252) * 100
  const momentum3 = closes.length > 3 ? ((closes.at(-1) - closes.at(-4)) / closes.at(-4)) * 100 : 0
  const momentum10 = closes.length > 10 ? ((closes.at(-1) - closes.at(-11)) / closes.at(-11)) * 100 : 0

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
    realizedVolatility,
    momentum3,
    momentum10,
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

export function buildForecast(history, timeframe = 'daily', options = {}) {
  const trainSplitPercent = Number(options.trainSplitPercent || 75)
  const currentPrice = Number(options.currentPrice)
  const liveChangePercent = Number(options.liveChangePercent || 0)
  const isFiveMinute = timeframe === '5m'
  const isHourly = timeframe === 'hourly'

  const horizonLabel = isFiveMinute ? '5m +36' : isHourly ? 'Hour +24' : 'Day +7'

  if (!Array.isArray(history) || history.length < 25) {
    return {
      forecast: [],
      signal: 'Need more historical candles',
      confidenceLabel: 'Low',
      score: 0.5,
      evaluation: { rmse: null, mape: null, sampleSize: 0 },
      horizonLabel,
      modelComparison: [],
      featureDiagnostics: {
        momentumSignal: 0,
        volatilitySignal: 0,
        trendSignal: 0,
        residualSigma: 0,
        liveAnchorGapPercent: 0,
        realtimeBlendPercent: 0,
        corridorSteps: 0,
        corridorWidthPercent: 0,
      },
      walkForward: {
        sampleSize: 0,
        startEquity: 10000,
        modelStats: [],
        bestModel: null,
        equityCurve: [],
      },
      trainSplitPercent,
      trainingDiagnostics: {
        baseLookback: null,
        tunedLookback: null,
        tuningCandidates: [],
        bestTuning: null,
      },
    }
  }

  const rawCloses = history.map((point) => point.close)
  const robustCloses = buildRobustCloses(rawCloses)
  const liveAnchor = applyLiveAnchor(robustCloses, timeframe, currentPrice)
  const closes = liveAnchor.closes
  const returns = computeReturns(closes)

  const shortWindow = closes.slice(-7)
  const longWindow = closes.slice(-21)

  const trendSlope = linearRegressionSlope(closes.slice(-20))
  const shortMA = mean(shortWindow)
  const longMA = mean(longWindow)
  const returnVolatility = std(returns.slice(-30))

  const maSignal = longMA === 0 ? 0 : (shortMA - longMA) / longMA
  const normalizedSlope = closes.at(-1) ? trendSlope / closes.at(-1) : 0

  const scoreRaw = 0.5 + (maSignal * 4.8 + normalizedSlope * 11.5 - returnVolatility * 2.3)
  const score = Math.max(0, Math.min(1, scoreRaw))

  const latestDate = new Date(history.at(-1).date)
  const lastClose = closes.at(-1)

  const forecast = []
  const steps = isFiveMinute ? 36 : isHourly ? 24 : 7
  const minLookback = isFiveMinute ? 96 : isHourly ? 48 : 30
  const maxLookback = Math.max(minLookback, closes.length - 12)
  const baseLookback = clampInt(Math.floor(closes.length * (trainSplitPercent / 100)), minLookback, maxLookback)
  const tuning = tuneLookback(closes, baseLookback, minLookback, maxLookback)
  const lookback = tuning.bestLookback
  const volatilityScale = isFiveMinute ? 0.8 : isHourly ? 1.1 : 1.6
  const modelSuite = computeModelSuite(closes, lookback)
  const residualProfile = estimateResidualProfile(closes, lookback, modelSuite)

  const modelStates = modelSuite.reduce((acc, model) => {
    acc[model.key] = [...closes]
    return acc
  }, {})

  const intradayLiveDrift = clamp(liveChangePercent / 100, -0.04, 0.04)
  const liveBase = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : lastClose
  const liveDriftFactor = isFiveMinute ? 0.58 : isHourly ? 0.42 : 0.22
  const blendStart = isFiveMinute ? 0.82 : isHourly ? 0.68 : 0.46
  const blendEnd = isFiveMinute ? 0.22 : isHourly ? 0.16 : 0.1
  const blendHalfLife = isFiveMinute ? 14 : isHourly ? 10 : 5
  const corridorSteps = isFiveMinute ? 10 : isHourly ? 6 : 3
  const baseCorridorWidth = isFiveMinute ? 0.005 : isHourly ? 0.008 : 0.012

  for (let step = 1; step <= steps; step += 1) {
    const modelPredictions = modelSuite.map((model) => {
      const state = modelStates[model.key]
      const prediction = model.predictor(state)
      state.push(prediction)
      return { key: model.key, value: prediction, weight: model.weight, state }
    })

    const projectionRaw = modelPredictions.reduce((sum, item) => sum + item.value * item.weight, 0)
    const previous = step === 1 ? lastClose : forecast.at(-1)?.value || lastClose
    const cappedStepMove = Math.max(
      previous * (isFiveMinute ? 0.026 : isHourly ? 0.042 : 0.07),
      lastClose * (isFiveMinute ? 0.02 : isHourly ? 0.03 : 0.05),
    )

    const referencePath = liveBase * (1 + intradayLiveDrift * Math.min(step, 6) * liveDriftFactor)
    const blendDecay = Math.exp(-Math.log(2) * (step - 1) / blendHalfLife)
    const realtimeBlend = blendEnd + (blendStart - blendEnd) * blendDecay
    const blendedProjection = projectionRaw * (1 - realtimeBlend) + referencePath * realtimeBlend
    let projection = clamp(blendedProjection, previous - cappedStepMove, previous + cappedStepMove)

    if (step <= corridorSteps) {
      const dynamicWidth = baseCorridorWidth
        + returnVolatility * (isFiveMinute ? 0.45 : isHourly ? 0.38 : 0.3) * Math.sqrt(step)
      const stepWidth = clamp(dynamicWidth, baseCorridorWidth, isFiveMinute ? 0.03 : isHourly ? 0.05 : 0.08)
      const corridorLower = referencePath * (1 - stepWidth)
      const corridorUpper = referencePath * (1 + stepWidth)
      projection = clamp(projection, corridorLower, corridorUpper)
    }

    // Keep future steps coherent with corrected projection to prevent snapback drift.
    modelPredictions.forEach((item) => {
      const idx = item.state.length - 1
      const softCorrected = item.value + (projection - item.value) * 0.88
      item.state[idx] = Math.max(0.01, softCorrected)
    })

    const uncertaintyFromVol = lastClose * returnVolatility * Math.sqrt(step) * volatilityScale
    const uncertaintyFromResidual = projection * residualProfile.residualSigma * Math.sqrt(step)
    const uncertainty = Math.max(uncertaintyFromVol, uncertaintyFromResidual)
    const quantileLower = projection * (1 + residualProfile.lowerQuantile * Math.sqrt(step))
    const quantileUpper = projection * (1 + residualProfile.upperQuantile * Math.sqrt(step))
    const lowerBound = Math.min(projection - uncertainty, quantileLower)
    const upperBound = Math.max(projection + uncertainty, quantileUpper)

    const date = new Date(latestDate)
    if (isFiveMinute) {
      date.setMinutes(date.getMinutes() + step * 5)
    } else if (isHourly) {
      date.setHours(date.getHours() + step)
    } else {
      date.setDate(date.getDate() + step)
    }

    forecast.push({
      date: date.toISOString(),
      value: Number(projection.toFixed(2)),
      lower: Number(Math.max(0.01, lowerBound).toFixed(2)),
      upper: Number(Math.max(Math.max(0.01, lowerBound + 0.01), upperBound).toFixed(2)),
    })
  }

  let confidenceLabel = 'Low'
  if (returnVolatility < 0.015) confidenceLabel = 'High'
  else if (returnVolatility < 0.03) confidenceLabel = 'Medium'

  const evaluation = evaluateModel(closes, lookback, (train) => ensemblePredict(train, modelSuite))
  const modelComparison = modelSuite.map((model) => ({
    name: model.name,
    rmse: model.metrics.rmse,
    mape: model.metrics.mape,
    recentRmse: model.recentMetrics.rmse,
    recentMape: model.recentMetrics.mape,
    weight: model.weight * 100,
  }))
  const walkForward = buildWalkForwardBacktest(closes, lookback, modelSuite)

  const featureDiagnostics = {
    momentumSignal: maSignal * 100,
    volatilitySignal: returnVolatility * 100,
    trendSignal: normalizedSlope * 100,
    residualSigma: residualProfile.residualSigma * 100,
    liveAnchorGapPercent: liveAnchor.anchorGapPercent,
    realtimeBlendPercent: blendStart * 100,
    corridorSteps,
    corridorWidthPercent: baseCorridorWidth * 100,
  }

  return {
    forecast,
    signal: getSignalLabel(score),
    confidenceLabel,
    score,
    evaluation,
    horizonLabel,
    modelComparison,
    featureDiagnostics,
    walkForward,
    trainSplitPercent,
    trainingDiagnostics: {
      baseLookback,
      tunedLookback: lookback,
      tuningCandidates: tuning.diagnostics,
      bestTuning: tuning.bestDiagnostics,
    },
  }
}
