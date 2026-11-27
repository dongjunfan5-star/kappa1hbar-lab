function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label}必须是有限数值`)
  return value
}

function nonNegative(value, label) {
  finite(value, label)
  if (value < 0) throw new RangeError(`${label}不能为负`)
  return value
}

function numericArray(values, label, minimum = 1) {
  if (!Array.isArray(values)) throw new TypeError(`${label}必须是数组`)
  if (values.length < minimum) throw new RangeError(`${label}至少需要 ${minimum} 项`)
  return Array.from(values, (value, index) => finite(value, `${label}第 ${index + 1} 项`))
}

function degrees(value) {
  if (value !== Infinity && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError('自由度必须是正数或 Infinity')
  }
  return value
}

function probabilityValue(value) {
  finite(value, '置信概率')
  if (value <= 0 || value >= 1) throw new RangeError('置信概率须在 0 与 1 之间')
  return value
}

export function measurementError(value, reference) {
  finite(value, '测量值')
  finite(reference, '参考值')
  const error = finite(value - reference, '误差')
  const relativeError = reference === 0 ? null : finite(error / Math.abs(reference), '相对误差')
  return { error, absoluteError: Math.abs(error), relativeError,
    absoluteRelativeError: relativeError === null ? null : Math.abs(relativeError) }
}

// 百分数用规格表里的数值，如 0.2 表示 0.2%。
export function instrumentError(spec) {
  const { kind } = spec
  let contributions
  if (kind === 'analog') {
    const range = nonNegative(spec.range, '量程')
    const accuracyClass = nonNegative(spec.accuracyClass, '准确度等级')
    contributions = { range: range * (accuracyClass / 100) }
  } else if (kind === 'digital') {
    const { reading, readingPercent = 0, range = 0, rangePercent = 0,
      digits = 0, resolution = 0 } = spec
    if (!Number.isSafeInteger(digits) || digits < 0) {
      throw new RangeError('末位计数必须是非负整数')
    }
    if (!Object.hasOwn(spec, 'range') && rangePercent !== 0) {
      throw new RangeError('量程百分项需要给定量程')
    }
    if (digits > 0 && resolution <= 0) {
      throw new RangeError('末位计数项需要给定正的末位分辨力')
    }
    contributions = {
      reading: Math.abs(finite(reading, '读数')) * (nonNegative(readingPercent, '读数百分系数') / 100),
      range: nonNegative(range, '量程') * (nonNegative(rangePercent, '量程百分系数') / 100),
      digits: digits * nonNegative(resolution, '末位分辨力'),
    }
  } else if (kind === 'resistanceBox') {
    if (!Array.isArray(spec.decades) || spec.decades.length === 0) {
      throw new RangeError('电阻箱至少需要一个挡位')
    }
    contributions = Array.from(spec.decades, ({ reading, accuracyClass }) =>
      nonNegative(reading, '挡位电阻') * (nonNegative(accuracyClass, '挡位准确度等级') / 100))
  } else {
    throw new RangeError('未知仪器允差模型')
  }
  const limit = finite(Object.values(contributions).reduce((sum, term) => sum + term, 0), '允差')
  return { limit, contributions }
}

function decimalParts(input) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new TypeError('输入必须是十进制数字或数字字符串')
  }
  const source = String(input).trim()
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(source)
  if (!match) throw new TypeError('输入必须是十进制数字或科学计数法')
  const fraction = match[3] ?? match[4] ?? ''
  const coefficient = ((match[2] ?? '') + fraction).replace(/^0+/, '')
  const exponent = Number(match[5] ?? 0)
  const place = exponent - fraction.length
  if (!Number.isFinite(Number(source)) || (coefficient && Number(source) === 0) ||
      !Number.isSafeInteger(place) || Math.abs(place) > 1000) {
    throw new RangeError('数字超出可处理范围')
  }
  return { negative: match[1] === '-', coefficient, place, fractionDigits: fraction.length }
}

// 末尾 0 表示精度时，保留字符串输入（如“1.200”或“1.20e3”）。
export function significantDigits(value) {
  const parts = decimalParts(value)
  return parts.coefficient.length || Math.max(1, parts.fractionDigits)
}

function checkPlace(place) {
  if (!Number.isSafeInteger(place) || Math.abs(place) > 1000) {
    throw new RangeError('修约位必须是 -1000 到 1000 的整数')
  }
  return place
}

function quantize(parts, place, mode) {
  if (!['halfEven', 'halfAwayFromZero', 'truncate', 'ceil'].includes(mode)) {
    throw new RangeError('未知修约方式')
  }
  const { coefficient } = parts
  if (!coefficient) return '0'
  const keep = coefficient.length + parts.place - place
  if (keep >= coefficient.length) return coefficient.padEnd(keep, '0')
  if (keep < 0) return mode === 'ceil' && !parts.negative ? '1' : '0'
  const kept = coefficient.slice(0, keep) || '0'
  const firstDiscarded = coefficient[keep]
  const exactlyHalf = firstDiscarded === '5' && !/[1-9]/.test(coefficient.slice(keep + 1))
  const aboveHalf = firstDiscarded > '5' || (firstDiscarded === '5' && !exactlyHalf)
  const odd = Number(kept.at(-1)) % 2 === 1
  const increment = mode === 'ceil' ? !parts.negative && /[1-9]/.test(coefficient.slice(keep)) :
    mode !== 'truncate' && (aboveHalf || (exactlyHalf && (mode === 'halfAwayFromZero' || odd)))
  return increment ? (BigInt(kept) + 1n).toString() : kept
}

function decimalText(coefficient, place, negative) {
  if (negative && coefficient !== '0') return '-' + decimalText(coefficient, place, false)
  if (place >= 0) return coefficient === '0' ? '0' : coefficient + '0'.repeat(place)
  const width = -place
  const padded = coefficient.padStart(width + 1, '0')
  return `${padded.slice(0, -width)}.${padded.slice(-width)}`
}

function scientificText(coefficient, place, negative) {
  const sign = negative && coefficient !== '0' ? '-' : ''
  const mantissa = coefficient.length === 1 ? coefficient : coefficient[0] + '.' + coefficient.slice(1)
  return `${sign}${mantissa}e${place + coefficient.length - 1}`
}

export function roundToPlace(value, place, mode = 'halfEven') {
  checkPlace(place)
  const parts = decimalParts(value)
  const coefficient = quantize(parts, place, mode)
  const result = finite(Number(`${parts.negative ? '-' : ''}${coefficient}e${place}`), '修约结果')
  const formatted = decimalText(coefficient, place, parts.negative)
  const digits = coefficient !== '0' ? coefficient.length : Math.max(1, -place)
  return { value: result === 0 ? 0 : result, formatted, place, significantDigits: digits }
}

export function roundSignificant(value, digits, mode = 'halfEven') {
  if (!Number.isSafeInteger(digits) || digits < 1 || digits > 1000) {
    throw new RangeError('有效数字位数必须是 1 到 1000 的整数')
  }
  const parts = decimalParts(value)
  let place = parts.coefficient ? parts.place + parts.coefficient.length - digits : -digits
  let coefficient = quantize(parts, place, mode)
  if (coefficient.length > digits) {
    place += 1
    coefficient = quantize(parts, place, mode)
  }
  const rounded = roundToPlace(value, place, mode)
  const formatted = place >= 0 && coefficient !== '0' && (place > 0 || coefficient.endsWith('0')) ?
    scientificText(coefficient, place, parts.negative) : rounded.formatted
  return { ...rounded, formatted, significantDigits: digits }
}

export function formatMeasurement(value, uncertainty, options = {}) {
  const { unit = '', digits = 2, kind = 'standard', style = 'compact', mode = 'halfEven',
    uncertaintyMode = kind === 'expanded' ? 'ceil' : mode, coverageFactor: k, confidence } = options
  if (kind !== 'standard' && kind !== 'expanded') throw new RangeError('未知不确定度类型')
  if (style !== 'compact' && style !== 'explicit' && style !== 'separate') {
    throw new RangeError('未知报告格式')
  }
  if (typeof unit !== 'string') throw new TypeError('单位必须是字符串')
  if (k !== undefined && (finite(k, '包含因子') <= 0 || kind !== 'expanded')) {
    throw new RangeError('包含因子用于扩展不确定度报告且必须为正')
  }
  if (confidence !== undefined) {
    if (kind !== 'expanded') throw new RangeError('置信概率用于扩展不确定度报告')
    probabilityValue(confidence)
  }
  const input = decimalParts(value)
  const uncertaintyParts = decimalParts(uncertainty)
  if (uncertaintyParts.negative && uncertaintyParts.coefficient) {
    throw new RangeError('不确定度不能为负')
  }
  const measurementPlace = options.measurementPlace ??
    (typeof value === 'string' ? input.place : undefined)
  if (measurementPlace !== undefined) checkPlace(measurementPlace)
  let rounded = roundSignificant(uncertainty, digits, uncertaintyMode)
  if (!uncertaintyParts.coefficient) {
    rounded = roundToPlace(uncertainty, measurementPlace ?? input.place, uncertaintyMode)
  } else if (measurementPlace !== undefined && digits === 2 && measurementPlace > rounded.place) {
    const oneDigit = roundSignificant(uncertainty, 1, uncertaintyMode)
    if (oneDigit.place === measurementPlace) rounded = oneDigit
  }
  const place = rounded.place
  const result = roundToPlace(value, place, mode)
  const coefficient = quantize(input, place, mode)
  const uncertaintyCoefficient = quantize(uncertaintyParts, place, uncertaintyMode)
  const suffix = unit ? ` ${unit}` : ''
  const uncertaintyText = decimalText(uncertaintyCoefficient, place, false)
  let text
  if (kind === 'expanded') {
    text = `(${result.formatted} ± ${uncertaintyText})${suffix}`
    if (k !== undefined) text += `，k = ${k}`
    if (confidence !== undefined) text += `，P ≈ ${Number((100 * confidence).toPrecision(15))}%`
  } else if (style === 'separate') {
    text = `${result.formatted}${suffix}，u_c = ${uncertaintyText}${suffix}`
  } else if (style === 'explicit') {
    text = `${result.formatted}(${uncertaintyText})${suffix}`
  } else if (place > 0) {
    const exponent = place + coefficient.length - 1
    const mantissa = decimalText(coefficient, place - exponent, input.negative)
    text = `${mantissa}(${uncertaintyCoefficient})e${exponent}${suffix}`
  } else {
    text = `${result.formatted}(${uncertaintyCoefficient})${suffix}`
  }
  return { value: result.value, uncertainty: rounded.value, place, kind, text,
    valueText: result.formatted, uncertaintyText }
}

function meanOf(values) {
  // 先除以后加，避免多个接近数值上界的同号读数求和溢出。
  let mean = 0
  let compensation = 0
  for (const value of values) {
    const scaled = value / values.length
    const next = mean + scaled
    compensation += Math.abs(mean) >= Math.abs(scaled) ? (mean - next) + scaled : (scaled - next) + mean
    mean = next
  }
  return finite(mean + compensation, '样本均值')
}

export function sampleStatistics(values) {
  const sample = numericArray(values, '样本')
  const count = sample.length
  const mean = meanOf(sample)
  const deviations = sample.map(value => value - mean)
  const degreesOfFreedom = count - 1
  if (count === 1) {
    return { count, mean, deviations, degreesOfFreedom, sampleVariance: null,
      sampleStandardDeviation: null, meanVariance: null, standardError: null }
  }
  const sampleStandardDeviation = finite(deviations.reduce((norm, x) =>
    Math.hypot(norm, x / Math.sqrt(degreesOfFreedom)), 0), '样本标准差')
  const standardError = sampleStandardDeviation / Math.sqrt(count)
  return { count, mean, deviations, degreesOfFreedom,
    sampleVariance: finite(sampleStandardDeviation ** 2, '样本方差'), sampleStandardDeviation,
    meanVariance: standardError ** 2, standardError }
}

export function pooledStandardDeviation(groups) {
  if (!Array.isArray(groups) || groups.length === 0) throw new RangeError('至少需要一组历史观测值')
  const statistics = Array.from(groups, group => {
    const result = sampleStatistics(group)
    if (result.count < 2) throw new RangeError('每组历史观测值至少需要两项')
    return result
  })
  const degreesOfFreedom = statistics.reduce((sum, group) => sum + group.degreesOfFreedom, 0)
  const sampleStandardDeviation = statistics.reduce((norm, group) => Math.hypot(norm,
    group.sampleStandardDeviation * Math.sqrt(group.degreesOfFreedom / degreesOfFreedom)), 0)
  return { groups: statistics, degreesOfFreedom, sampleStandardDeviation,
    sampleVariance: finite(sampleStandardDeviation ** 2, '合并样本方差') }
}

export function typeA(values, options = {}) {
  const { historicalValues, historicalGroups, historicalStandardDeviation, historicalDegreesOfFreedom } = options
  const current = sampleStatistics(values)
  const sources = [historicalValues, historicalGroups, historicalStandardDeviation]
    .filter(source => source !== undefined).length
  if (sources > 1) throw new RangeError('历史单组数据、多组数据和已知标准差任选其一')
  if (sources === 0) {
    if (current.count < 2) throw new RangeError('单次测量需要同流程预先评定的标准差')
    if (historicalDegreesOfFreedom !== undefined) throw new RangeError('历史自由度需有历史评定')
    return { ...current, value: current.mean, standardUncertainty: current.standardError, source: 'current' }
  }
  let historical = null
  if (historicalValues !== undefined) historical = sampleStatistics(historicalValues)
  if (historicalGroups !== undefined) historical = pooledStandardDeviation(historicalGroups)
  if (historical?.count === 1) throw new RangeError('历史数据至少需要两次测量')
  const usedStandardDeviation = historical?.sampleStandardDeviation ??
    nonNegative(historicalStandardDeviation, '历史标准差')
  const degreesOfFreedom = historicalDegreesOfFreedom === undefined ?
    (historical?.degreesOfFreedom ?? null) : degrees(historicalDegreesOfFreedom)
  return { ...current, value: current.mean, source: 'historical', usedStandardDeviation,
    standardUncertainty: usedStandardDeviation / Math.sqrt(current.count), degreesOfFreedom }
}

// Lanczos 近似用于计算 t 分布所需的正则化不完全 Beta 函数。
const lanczos = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.6150291621406, 12.507343278686905, -0.13857109526572012,
  9.984369578019572e-6, 1.5056327351493116e-7]

function logGamma(value) {
  if (value < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * value)) - logGamma(1 - value)
  const z = value - 1
  let sum = 0.9999999999998099
  for (const [index, coefficient] of lanczos.entries()) sum += coefficient / (z + index + 1)
  const t = z + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum)
}

function betaFraction(x, a, b) {
  const tiny = 1e-300
  let c = 1
  let d = 1 / Math.max(tiny, Math.abs(1 - (a + b) * x / (a + 1)))
  let fraction = d
  for (let step = 1; step <= 200; step++) {
    const twice = 2 * step
    const terms = [
      step * (b - step) * x / ((a + twice - 1) * (a + twice)),
      -(a + step) * (a + b + step) * x / ((a + twice) * (a + twice + 1)),
    ]
    let change = 1
    for (const term of terms) {
      d = 1 + term * d
      if (Math.abs(d) < tiny) d = tiny
      c = 1 + term / c
      if (Math.abs(c) < tiny) c = tiny
      d = 1 / d
      change *= c * d
    }
    fraction *= change
    if (Math.abs(change - 1) < 3e-14) return fraction
  }
  throw new RangeError('t 分布数值计算未收敛')
}

function regularizedBeta(x, a, b) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const coefficient = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log1p(-x))
  return x < (a + 1) / (a + b + 2) ?
    coefficient * betaFraction(x, a, b) / a :
    1 - coefficient * betaFraction(1 - x, b, a) / b
}

function polynomial(coefficients, x) {
  return coefficients.reduce((result, coefficient) => result * x + coefficient, 0)
}

// 标准正态分位数的有理近似，其输入是对称区间单侧外尾概率。
function normalFactor(confidence) {
  const tail = (1 - confidence) / 2
  if (tail < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(tail))
    const numerator = polynomial([-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783], q)
    const denominator = polynomial([0.007784695709041462, 0.3224671290700398, 2.445134137142996,
      3.754408661907416, 1], q)
    return -numerator / denominator
  }
  const q = confidence / 2
  const r = q * q
  const numerator = polynomial([-39.69683028665376, 220.9460984245205, -275.9285104469687,
    138.357751867269, -30.66479806614716, 2.506628277459239], r)
  const denominator = polynomial([-54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572, 1], r)
  return q * numerator / denominator
}

export function coverageFactor(probability, degreesOfFreedom = Infinity) {
  const confidence = probabilityValue(probability)
  const nu = degrees(degreesOfFreedom)
  const z = normalFactor(confidence)
  if (nu > 1e7) return z + (z ** 3 + z) / (4 * nu)
  const tail = 1 - confidence
  // 用中心概率或外侧概率比较，在接近 0 或 1 的置信概率下减少消减误差。
  function intervalTooNarrow(k) {
    const scaled = k / Math.sqrt(nu)
    if (confidence <= 0.5) {
      const x = scaled ** 2 / (1 + scaled ** 2)
      return regularizedBeta(x, 0.5, nu / 2) < confidence
    }
    const x = 1 / (1 + scaled ** 2)
    return regularizedBeta(x, nu / 2, 0.5) > tail
  }
  let low = 0
  let high = z
  while (intervalTooNarrow(high)) {
    low = high
    high *= 2
    if (!Number.isFinite(high) || high > 1e150) throw new RangeError('包含因子超出计算范围')
  }
  for (let iteration = 0; iteration < 65; iteration++) {
    const middle = (low + high) / 2
    if (intervalTooNarrow(middle)) low = middle
    else high = middle
    if (high - low <= 1e-12 * high) break
  }
  return (low + high) / 2
}

export function typeB(options) {
  const { distribution = 'uniform', halfWidth, lower, upper, resolution,
    beta = 0.5, coverageFactor: suppliedFactor, confidence, estimate,
    degreesOfFreedom = Infinity } = options
  const nu = degrees(degreesOfFreedom)
  const hasBounds = lower !== undefined || upper !== undefined
  const sources = Number(halfWidth !== undefined) + Number(hasBounds) + Number(resolution !== undefined)
  if (sources !== 1) throw new RangeError('请在半宽、上下限、分辨力中选择一项')
  let value = estimate === undefined ? null : finite(estimate, '估计值')
  let a
  if (hasBounds) {
    finite(lower, '下限')
    finite(upper, '上限')
    if (upper < lower) throw new RangeError('上限不能低于下限')
    a = upper / 2 - lower / 2
    if (value === null) value = lower / 2 + upper / 2
  } else if (resolution !== undefined) {
    a = nonNegative(resolution, '分辨力') / 2
  } else {
    a = nonNegative(halfWidth, '半宽')
  }
  if (distribution !== 'normal' && distribution !== 'reported' &&
      (confidence !== undefined || suppliedFactor !== undefined)) {
    throw new RangeError('给定置信概率或包含因子时请选择正态分布或证书因子')
  }
  let divisor
  if (distribution === 'normal' || distribution === 'reported') {
    if (suppliedFactor !== undefined && confidence !== undefined) {
      throw new RangeError('置信概率和包含因子只能提供一项')
    }
    if (distribution === 'reported' && suppliedFactor === undefined && confidence === undefined) {
      throw new RangeError('证书需给定包含因子或置信概率')
    }
    const coverageDegreesOfFreedom = distribution === 'normal' ? Infinity : nu
    divisor = suppliedFactor ?? (confidence === undefined ? 3 : coverageFactor(confidence, coverageDegreesOfFreedom))
    if (finite(divisor, '包含因子') <= 0) throw new RangeError('包含因子必须为正')
  } else if (distribution === 'uniform') {
    divisor = Math.sqrt(3)
  } else if (distribution === 'triangular') {
    divisor = Math.sqrt(6)
  } else if (distribution === 'arcsine') {
    divisor = Math.SQRT2
  } else if (distribution === 'trapezoid') {
    if (nonNegative(beta, '梯形顶底宽比') > 1) throw new RangeError('梯形顶底宽比不得超过 1')
    divisor = Math.sqrt(6 / (1 + beta ** 2))
  } else {
    throw new RangeError('未知 B 类评定分布')
  }
  return { value, distribution, halfWidth: a, coverageFactor: divisor,
    standardUncertainty: finite(a / divisor, 'B 类标准不确定度'), degreesOfFreedom: nu }
}

function positiveHalfWidth(halfWidth) {
  if (nonNegative(halfWidth, '分布半宽') === 0) throw new RangeError('分布半宽必须大于零')
  return halfWidth
}

function boundedDistribution(distribution, halfWidth, beta) {
  positiveHalfWidth(halfWidth)
  if (!['uniform', 'triangular', 'trapezoid'].includes(distribution)) throw new RangeError('未知分布')
  const ratio = distribution === 'uniform' ? 1 : distribution === 'triangular' ? 0 : beta
  if (nonNegative(ratio, '梯形顶底宽比') > 1) throw new RangeError('梯形顶底宽比不得超过 1')
  return ratio
}

function deviationUnits(delta, standardDeviation) {
  if (nonNegative(standardDeviation, '标准差') === 0) throw new RangeError('标准差必须大于零')
  return delta / standardDeviation
}

export function distributionDensity(value, options) {
  const { distribution, center = 0, standardDeviation, halfWidth, beta = 0.5 } = options
  const delta = Math.abs(finite(value, '分布自变量') - finite(center, '分布中心值'))
  if (distribution === 'normal') {
    const z = deviationUnits(delta, standardDeviation)
    return (Math.exp(-0.5 * z ** 2) / Math.sqrt(2 * Math.PI)) / standardDeviation
  }
  if (distribution === 'arcsine') {
    const x = delta / positiveHalfWidth(halfWidth)
    if (x > 1) return 0
    // 支撑区间端点的密度趋于无穷，单个端点的概率仍为零。
    return (1 / (Math.PI * Math.sqrt((1 - x) * (1 + x)))) / halfWidth
  }
  const ratio = boundedDistribution(distribution, halfWidth, beta)
  const x = delta / halfWidth
  const plateau = (1 / halfWidth) / (1 + ratio)
  if (x > 1) return 0
  return x <= ratio ? plateau : plateau * (1 - x) / (1 - ratio)
}

export function distributionCoverage(intervalHalfWidth, options) {
  const { distribution, standardDeviation, halfWidth, beta = 0.5 } = options
  nonNegative(intervalHalfWidth, '区间半宽')
  if (distribution === 'normal') {
    const z = deviationUnits(intervalHalfWidth, standardDeviation)
    if (z === 0) return 0
    // normalFactor 是中心覆盖概率的反函数。
    let low = 0
    let high = 1
    for (let iteration = 0; iteration < 53; iteration++) {
      const probability = (low + high) / 2
      if (normalFactor(probability) < z) low = probability
      else high = probability
    }
    return (low + high) / 2
  }
  if (distribution === 'arcsine') {
    const x = intervalHalfWidth / positiveHalfWidth(halfWidth)
    return 2 * Math.asin(Math.min(1, x)) / Math.PI
  }
  const ratio = boundedDistribution(distribution, halfWidth, beta)
  const x = intervalHalfWidth / halfWidth
  if (x >= 1) return 1
  if (x <= ratio) return 2 * x / (1 + ratio)
  return 1 - (1 - x) ** 2 / (1 - ratio ** 2)
}

export function checkThreeSigma(value, expected, standardDeviation, multiplier = 3) {
  finite(value, '待核查观测值')
  finite(expected, '期望值')
  nonNegative(standardDeviation, '标准差或图中单侧误差限')
  if (nonNegative(multiplier, '核查倍数') === 0) throw new RangeError('核查倍数必须大于零')
  const difference = finite(value - expected, '偏差')
  const threshold = finite(multiplier * standardDeviation, '核查阈值')
  return { difference, absoluteDifference: Math.abs(difference), threshold,
    exceeds: Math.abs(difference) > threshold }
}

export function sampleCovariance(xValues, yValues) {
  const x = numericArray(xValues, '第一列观测值', 2)
  const y = numericArray(yValues, '第二列观测值', 2)
  if (x.length !== y.length) throw new RangeError('协方差需要等长的配对观测值')
  const first = sampleStatistics(x)
  const second = sampleStatistics(y)
  const { sampleStandardDeviation: sx, degreesOfFreedom } = first
  const { sampleStandardDeviation: sy } = second
  if (sx === 0 || sy === 0) return { covariance: 0, correlation: null, degreesOfFreedom }
  const scale = Math.sqrt(degreesOfFreedom)
  const normalized = first.deviations.reduce((sum, dx, index) =>
    sum + (dx / sx / scale) * (second.deviations[index] / sy / scale), 0)
  const correlation = Math.max(-1, Math.min(1, normalized))
  const covariance = finite((correlation * sx) * sy, '样本协方差')
  return { covariance, correlation, degreesOfFreedom }
}

function uncertaintyComponent(component) {
  const input = typeof component === 'number' ? { standardUncertainty: component } : component
  if (input === null || typeof input !== 'object') throw new TypeError('不确定度分量必须是数值或对象')
  const { standardUncertainty, degreesOfFreedom = Infinity } = input
  nonNegative(standardUncertainty, '标准不确定度')
  if (degreesOfFreedom !== null) degrees(degreesOfFreedom)
  return { standardUncertainty, degreesOfFreedom }
}

function uncertaintyComponents(components) {
  if (!Array.isArray(components) || components.length === 0) {
    throw new RangeError('至少需要一个标准不确定度分量')
  }
  return Array.from(components, uncertaintyComponent)
}

export function effectiveDegreesOfFreedom(components) {
  const terms = uncertaintyComponents(components)
  const norm = terms.reduce((value, term) => Math.hypot(value, term.standardUncertainty), 0)
  if (norm === 0) return Infinity
  finite(norm, '合成标准不确定度')
  if (terms.some(term => term.standardUncertainty > 0 && term.degreesOfFreedom === null)) return null
  const inverseDof = terms.reduce((value, term) =>
    term.standardUncertainty === 0 || term.degreesOfFreedom === Infinity ? value :
      value + (term.standardUncertainty / norm) ** 4 / term.degreesOfFreedom, 0)
  return 1 / inverseDof
}

function correlationFactor(correlation, size) {
  if (!Array.isArray(correlation) || correlation.length !== size) {
    throw new RangeError('相关矩阵维度须与输入量数量一致')
  }
  const matrix = Array.from(correlation, (row, index) => {
    const values = numericArray(row, `相关矩阵第 ${index + 1} 行`, size)
    if (values.length !== size) throw new RangeError('相关矩阵必须是方阵')
    return values
  })
  const tolerance = size * 32 * Number.EPSILON
  const lower = matrix.map(row => row.map(() => 0))
  for (let i = 0; i < size; i++) {
    if (matrix[i][i] !== 1) throw new RangeError('相关矩阵对角线必须为 1')
    for (let j = 0; j <= i; j++) {
      const rho = matrix[i][j]
      if (Math.abs(rho) > 1 || Math.abs(matrix[j][i] - rho) > tolerance) {
        throw new RangeError('相关矩阵须对称，系数范围为 [-1, 1]')
      }
      let remaining = rho
      for (let k = 0; k < j; k++) remaining -= lower[i][k] * lower[j][k]
      if (i === j) {
        if (remaining < -tolerance) throw new RangeError('相关矩阵不是半正定矩阵')
        lower[i][j] = Math.sqrt(Math.max(0, remaining))
      } else if (lower[j][j] > 0) {
        lower[i][j] = remaining / lower[j][j]
      } else if (Math.abs(remaining) > tolerance) {
        throw new RangeError('相关矩阵不是半正定矩阵')
      }
    }
  }
  return { matrix, lower }
}

function combineContributions(terms, correlation) {
  const covarianceTerms = []
  let correlatedOutput = false
  let standardUncertainty = terms.reduce((norm, term) => Math.hypot(norm, term.standardUncertainty), 0)
  if (correlation !== undefined) {
    const { matrix, lower } = correlationFactor(correlation, terms.length)
    for (let i = 0; i < terms.length; i++) {
      for (let j = 0; j < i; j++) {
        const correlation = matrix[i][j]
        if (correlation === 0) continue
        correlatedOutput ||= terms[i].signedContribution !== 0 && terms[j].signedContribution !== 0
        const contribution = 2 * ((correlation * terms[i].signedContribution) * terms[j].signedContribution)
        covarianceTerms.push({ firstIndex: j, secondIndex: i, correlation,
          contribution: finite(contribution, '协方差贡献') })
      }
    }
    if (correlatedOutput) {
      // u² = cᵀ R c，其中 R = L Lᵀ。计算 Lᵀc 的范数，避免相消导致负方差。
      const transformed = terms.map((term, j) =>
        terms.reduce((sum, other, i) => sum + lower[i][j] * other.signedContribution, 0))
      standardUncertainty = transformed.reduce((norm, item) => Math.hypot(norm, item), 0)
    }
  }
  finite(standardUncertainty, '合成标准不确定度')
  const variance = finite(standardUncertainty ** 2, '合成方差')
  return { standardUncertainty, variance, covarianceTerms,
    effectiveDegreesOfFreedom: correlatedOutput ? null : effectiveDegreesOfFreedom(terms),
    components: terms.map(term => ({
      ...term, varianceFraction: variance > 0 ? term.variance / variance : null,
    })) }
}

export function combineUncertainties(components, options = {}) {
  const terms = uncertaintyComponents(components).map((component, index) => ({
    ...component, index, signedContribution: component.standardUncertainty,
    variance: finite(component.standardUncertainty ** 2, '方差贡献'),
  }))
  return combineContributions(terms, options.correlation)
}

function estimateGradient(model, values) {
  return values.map((value, index) => {
    const step = Math.cbrt(Number.EPSILON) * (value === 0 ? 1 : Math.abs(value))
    const high = [...values]
    const low = [...values]
    high[index] += step
    low[index] -= step
    const fHigh = finite(model(high), '数值偏导正向取值')
    const fLow = finite(model(low), '数值偏导负向取值')
    return finite((fHigh - fLow) / (high[index] - low[index]), '数值偏导')
  })
}

export function propagateUncertainty(model, inputs, options = {}) {
  const { gradient, correlation } = options
  if (typeof model !== 'function') throw new TypeError('测量模型必须是函数')
  if (!Array.isArray(inputs) || inputs.length === 0) throw new RangeError('测量模型至少需要一个输入量')
  const values = Array.from(inputs, (input, index) => finite(input?.value, `输入量 ${index + 1} 的估计值`))
  const value = finite(model([...values]), '测量模型结果')
  if (gradient !== undefined && typeof gradient !== 'function') throw new TypeError('梯度必须是函数')
  const sensitivities = gradient === undefined ? estimateGradient(model, values) :
    numericArray(gradient([...values]), '灵敏系数')
  if (sensitivities.length !== values.length) throw new RangeError('每个输入量需要一个灵敏系数')
  const terms = Array.from(inputs, (input, index) => {
    const { standardUncertainty, degreesOfFreedom } = uncertaintyComponent(input)
    const sensitivity = sensitivities[index]
    const signedContribution = finite(sensitivity * standardUncertainty, '标准不确定度传播分量')
    return { index, value: values[index], inputStandardUncertainty: standardUncertainty, degreesOfFreedom,
      sensitivity, signedContribution, standardUncertainty: Math.abs(signedContribution),
      variance: finite(signedContribution ** 2, '方差贡献') }
  })
  const combined = combineContributions(terms, correlation)
  return { value, ...combined, relativeStandardUncertainty:
    value === 0 ? null : finite(combined.standardUncertainty / Math.abs(value), '相对标准不确定度') }
}

// 教材表 2-1-3。参数中的角度使用弧度，系数视作无不确定度的常数。
export function propagateFormula(kind, inputs, options = {}) {
  const { coefficient = 1, exponents, correlation } = options
  const formulas = {
    add: { arity: 2, model: ([x, y]) => x + y, gradient: () => [1, 1] },
    subtract: { arity: 2, model: ([x, y]) => x - y, gradient: () => [1, -1] },
    multiply: { arity: 2, model: ([x, y]) => x * y, gradient: ([x, y]) => [y, x] },
    divide: { arity: 2, model: ([x, y]) => x / y, gradient: ([x, y]) => [1 / y, -(x / y) / y] },
    scale: { arity: 1, model: ([x]) => coefficient * x, gradient: () => [coefficient] },
    sqrt: { arity: 1, model: ([x]) => coefficient * Math.sqrt(x),
      gradient: ([x]) => [coefficient / (2 * Math.sqrt(x))] },
    sin: { arity: 1, model: ([x]) => Math.sin(x), gradient: ([x]) => [Math.cos(x)] },
    log: { arity: 1, model: ([x]) => Math.log(x), gradient: ([x]) => [1 / x] },
  }
  if (kind === 'powerProduct') {
    const powers = numericArray(exponents, '幂指数')
    if (inputs?.length !== powers.length) throw new RangeError('每个输入量需要一个幂指数')
    const model = values => values.reduce((product, value, index) => product * value ** powers[index], 1)
    const gradient = values => values.map((value, index) => {
      const exponent = powers[index]
      if (exponent === 0) return 0
      return values.reduce((product, other, position) => product *
        other ** (position === index ? powers[position] - 1 : powers[position]),
      exponent)
    })
    return propagateUncertainty(model, inputs, { gradient, correlation })
  }
  if (!Object.hasOwn(formulas, kind)) throw new RangeError('未知不确定度传播公式')
  const { arity, model, gradient } = formulas[kind]
  if (inputs?.length !== arity) throw new RangeError(`此公式需要 ${arity} 个输入量`)
  if (kind === 'scale' || kind === 'sqrt') finite(coefficient, '常数系数')
  return propagateUncertainty(model, inputs, { gradient, correlation })
}

export function expandUncertainty(standardUncertainty, options = {}) {
  nonNegative(standardUncertainty, '合成标准不确定度')
  const { confidence, degreesOfFreedom = Infinity, coverageFactor: suppliedFactor, value } = options
  if (suppliedFactor === undefined && confidence === undefined) {
    throw new RangeError('扩展不确定度需要给定置信概率或包含因子')
  }
  if (degreesOfFreedom !== null) degrees(degreesOfFreedom)
  if (confidence !== undefined) probabilityValue(confidence)
  const k = suppliedFactor ?? coverageFactor(confidence, degreesOfFreedom)
  if (finite(k, '包含因子') <= 0) throw new RangeError('包含因子必须为正')
  const expandedUncertainty = finite(k * standardUncertainty, '扩展不确定度')
  const interval = value === undefined ? null : [
    finite(finite(value, '估计值') - expandedUncertainty, '区间下限'),
    finite(value + expandedUncertainty, '区间上限'),
  ]
  return { standardUncertainty, expandedUncertainty, coverageFactor: k, confidence: confidence ?? null,
    degreesOfFreedom, interval }
}
