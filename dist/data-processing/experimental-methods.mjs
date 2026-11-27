import { combineUncertainties, expandUncertainty, formatMeasurement, propagateUncertainty,
  sampleStatistics, typeA, typeB } from './measurement.mjs';
import { linearRegression } from './processing.mjs';

function number(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} 必须是有限数字`);
  return value;
}

function positive(value, name) {
  if (number(value, name) <= 0) throw new RangeError(`${name} 必须大于零`);
  return value;
}

function nonnegative(value, name) {
  if (number(value, name) < 0) throw new RangeError(`${name} 不能为负数`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} 必须是正整数`);
  }
  return value;
}

/** §1.2 根据目标精度排序无量纲相对修正。输入保留符号，排序使用绝对值。 */
export function rankCorrections(corrections, targetRelative) {
  positive(targetRelative, '目标相对限值');
  if (!Array.isArray(corrections)) throw new TypeError('修正项必须是数组');
  const ranked = corrections.map(({ name, relative }, index) => {
    number(relative, `修正量 ${index + 1}`);
    const magnitude = Math.abs(relative);
    const exponent = magnitude === 0 ? null : Math.floor(Math.log10(magnitude));
    return { name, relative, magnitude, exponent, meetsTarget: magnitude <= targetRelative };
  }).sort((a, b) => b.magnitude - a.magnitude);
  const total = ranked.reduce((sum, item) => sum + item.relative, 0);
  const absoluteBound = ranked.reduce((sum, item) => sum + item.magnitude, 0);
  return { ranked, targetRelative, total, absoluteBound, meetsTarget: absoluteBound <= targetRelative };
}

/** §1.2 [目标] = ∏[因素]^p。给出特解与自由因子的无量纲组合。 */
export function dimensionalAnalysis(target, factors) {
  if (!target || typeof target !== 'object' || Array.isArray(target)
      || !Array.isArray(factors) || factors.length === 0) {
    throw new TypeError('请输入目标量纲和至少一个因素');
  }
  const dimensions = [target];
  for (const [index, factor] of factors.entries()) {
    if (!factor?.dimensions || typeof factor.dimensions !== 'object' || Array.isArray(factor.dimensions)
        || typeof factor.name !== 'string' || factor.name.trim() === '') {
      throw new TypeError(`因素 ${index + 1} 需要 name 和 dimensions`);
    }
    dimensions.push(factor.dimensions);
  }
  const names = factors.map(factor => factor.name);
  if (new Set(names).size !== names.length) throw new RangeError('因素名称必须唯一');
  const axes = [...new Set(dimensions.flatMap(Object.keys))];
  const matrix = axes.map(axis => {
    const read = dim => Object.hasOwn(dim, axis) ? number(dim[axis], `${axis} 指数`) : 0;
    return [...factors.map(factor => read(factor.dimensions)), read(target)];
  });
  const columns = factors.length;
  const tolerance = 1e-12;
  const pivots = [];
  for (let col = 0; col < columns && pivots.length < matrix.length; col += 1) {
    const row = pivots.length;
    let best = row;
    for (let i = row + 1; i < matrix.length; i += 1) {
      if (Math.abs(matrix[i][col]) > Math.abs(matrix[best][col])) best = i;
    }
    if (Math.abs(matrix[best][col]) <= tolerance) continue;
    [matrix[row], matrix[best]] = [matrix[best], matrix[row]];
    const divisor = matrix[row][col];
    matrix[row] = matrix[row].map(value => value / divisor);
    for (let i = 0; i < matrix.length; i += 1) {
      if (i === row) continue;
      const multiplier = matrix[i][col];
      matrix[i] = matrix[i].map((value, j) => value - multiplier * matrix[row][j]);
    }
    pivots.push(col);
  }
  const rank = pivots.length;
  const inconsistent = matrix.slice(rank).some(row => Math.abs(row[columns]) > tolerance);
  const asFactors = values => Object.fromEntries(names.map((name, i) => [name, values[i] || 0]));
  const particular = factors.map((_, col) => {
    const row = pivots.indexOf(col);
    return row < 0 ? 0 : matrix[row][columns];
  });
  const free = factors.map((_, col) => col).filter(col => !pivots.includes(col));
  const dimensionlessGroups = free.map(freeCol => {
    const powers = factors.map((_, col) => {
      if (col === freeCol) return 1;
      const row = pivots.indexOf(col);
      return row < 0 ? 0 : -matrix[row][freeCol];
    });
    return asFactors(powers);
  });
  return {
    status: inconsistent ? 'inconsistent' : free.length ? 'underdetermined' : 'unique',
    axes, rank, exponents: inconsistent ? null : asFactors(particular), dimensionlessGroups
  };
}

/** §1.3 比较法。读数与标准的比值必须是无量纲量。 */
export function compareWithStandard(standard, ratio) {
  return number(number(standard, '标准量') * number(ratio, '比较比值'), '待测量');
}

/** §1.3 电位差计示零，工作电流在两次补偿中保持一致。 */
export function potentiometerEmf(standardEmf, unknownResistance, standardResistance) {
  return compareWithStandard(standardEmf,
    nonnegative(unknownResistance, '待测端补偿电阻') / positive(standardResistance, '标准端补偿电阻'));
}

/** §1.3 线性平衡 Σ cᵢxᵢ = target。已知项的系数含方向。 */
export function solveLinearBalance(terms, unknownCoefficient, target = 0) {
  if (!Array.isArray(terms)) throw new TypeError('已知平衡项必须是数组');
  number(unknownCoefficient, '待测项系数');
  if (unknownCoefficient === 0) throw new RangeError('待测项系数不能为零');
  const knownTotal = terms.reduce((sum, { coefficient, value }) =>
    sum + number(coefficient, '已知项系数') * number(value, '已知量'), 0);
  return number((number(target, '平衡目标值') - knownTotal) / unknownCoefficient, '待测量');
}

/** §1.3 累积放大。限值和标准不确定度分别按读数次数折算。 */
export function accumulatedReading(total, count, { errorLimit, standardUncertainty } = {}) {
  number(total, '总读数');
  positiveInteger(count, '累积次数');
  const value = total / count;
  const limit = errorLimit === undefined ? null : nonnegative(errorLimit, '总读数误差限') / count;
  const uncertainty = standardUncertainty === undefined
    ? null : nonnegative(standardUncertainty, '总读数标准不确定度') / count;
  return { value, count, errorLimit: limit, standardUncertainty: uncertainty,
    relativeErrorLimit: value !== 0 && limit !== null ? limit / Math.abs(value) : null };
}

/** §1.3 机械放大，游标分度值与螺旋周向位移增益。 */
export function vernierResolution(mainDivision, divisions) {
  return positive(mainDivision, '主尺分度值') / positiveInteger(divisions, '游标格数');
}

export function screwAmplification(diameter, pitch) {
  return Math.PI * positive(diameter, '套筒直径') / positive(pitch, '螺距');
}

/** §1.3 光杠杆的小角度放大。两种长度使用同一单位。 */
export function opticalLever(displacement, distance, arm) {
  const gain = 2 * positive(distance, '标尺到镜面的距离') / positive(arm, '光杠杆臂长');
  return { gain, scaleShift: number(displacement, '被测位移') * gain };
}

/** §1.3 电学或机械放大。增益为线性比，SNR 使用相同口径的输入/输出功率。 */
export function signalGain(value, gain, { signalPower, noisePower } = {}) {
  const output = number(number(value, '输入量') * number(gain, '增益'), '输出量');
  const snr = signalPower === undefined && noisePower === undefined ? null
    : nonnegative(signalPower, '信号功率') / positive(noisePower, '噪声功率');
  return { output, snr };
}

/** §1.3 参数转换，浮力称衡。质量同单位，结果与流体密度同单位。 */
export function buoyancyDensity(airMass, immersedMass, fluidDensity) {
  positive(airMass, '空气中称量');
  number(immersedMass, '液体中称量');
  positive(fluidDensity, '流体密度');
  if (immersedMass >= airMass) throw new RangeError('浸没后示值必须小于空气中示值');
  return airMass / (airMass - immersedMass) * fluidDensity;
}

/** §1.3 传感器标定关系的正/反换算，或按相似模型的尺度换算。 */
export function affineConversion(value, scale, { offset = 0, inverse = false } = {}) {
  number(value, '输入量');
  number(scale, '比例系数');
  number(offset, '截距');
  if (typeof inverse !== 'boolean') throw new TypeError('inverse 必须是布尔值');
  if (inverse && scale === 0) throw new RangeError('比例系数为零时不可逆');
  return number(inverse ? (value - offset) / scale : scale * value + offset, '换算值');
}

/** §1.3 条纹计数；往返装置的 pathMultiplier 通常为 2。 */
export function fringeDisplacement(fringeCount, wavelength, pathMultiplier = 2) {
  const pathDifference = number(fringeCount, '条纹变化数') * positive(wavelength, '波长');
  return { pathDifference, displacement: pathDifference / positive(pathMultiplier, '光程倍率') };
}

/** §1.3 单缝夫琅和费衍射暗纹；细丝可用巴比涅原理。角度为弧度。 */
export function singleSlitWidth(order, wavelength, angleRad) {
  positiveInteger(order, '暗纹级次');
  const angle = Math.abs(number(angleRad, '暗纹偏角'));
  if (!(angle > 0 && angle <= Math.PI / 2)) throw new RangeError('暗纹偏角绝对值须在 (0, π/2]');
  return order * positive(wavelength, '波长') / Math.sin(angle);
}

/** §2.4 游标卡尺。zeroError 为闭合时带符号的读数。 */
export function vernierReading({ mainReading, alignedDivision, mainDivision = 1, divisions = 50, zeroError = 0 }) {
  if (!Number.isSafeInteger(alignedDivision) || alignedDivision < 0 || alignedDivision >= divisions) {
    throw new RangeError('游标对齐格序号须在 0 到总格数减 1 之间');
  }
  const resolution = vernierResolution(mainDivision, divisions);
  const reading = number(mainReading, '主尺读数') + alignedDivision * resolution;
  return { reading, resolution, corrected: reading - number(zeroError, '零点示值') };
}

/** §2.4 千分尺/读数显微镜；主尺输入含已读到的半毫米（若有）。 */
export function screwScaleReading({ mainReading, drumReading, pitch = 0.5, divisions = 50, zeroError = 0 }) {
  if (nonnegative(drumReading, '鼓轮读数') >= divisions) throw new RangeError('鼓轮读数须小于总格数');
  const resolution = positive(pitch, '螺距') / positiveInteger(divisions, '总格数');
  const reading = number(mainReading, '固定刻度读数') + drumReading * resolution;
  return { reading, resolution, corrected: reading - number(zeroError, '零点示值') };
}

export function readingDifference(start, end) {
  return Math.abs(number(end, '结束读数') - number(start, '起始读数'));
}

export function intervalFromClock({ minutes = 0, seconds = 0, milliseconds = 0 }) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new RangeError('分钟数必须为非负整数');
  if (nonnegative(seconds, '秒') >= 60 || nonnegative(milliseconds, '毫秒') >= 1000) {
    throw new RangeError('秒与毫秒超出表盘范围');
  }
  return minutes * 60 + seconds + milliseconds / 1000;
}

/** §§2.1、2.3 直接测量的完整流程，假设各已评定分量独立。 */
export function directMeasurement({ readings, correction = 0, historical, bSources = [], unit = '',
  confidence, coverageFactor, digits = 2 }) {
  const stats = sampleStatistics(readings);
  const value = number(stats.mean + number(correction, '示值修正'), '测量结果');
  if (!Array.isArray(bSources)) throw new TypeError('B 类来源须为数组');
  const a = stats.count >= 2 || historical !== undefined ? typeA(readings, historical) : null;
  const b = Array.from(bSources, source => typeB(source));
  const components = a === null ? b : [a, ...b];
  const combined = components.length ? combineUncertainties(components) : null;
  const expand = confidence !== undefined || coverageFactor !== undefined;
  if (expand && combined === null) throw new RangeError('未评定标准不确定度，不能计算扩展不确定度');
  const expanded = expand ? expandUncertainty(combined.standardUncertainty, {
    value, confidence, coverageFactor, degreesOfFreedom: combined.effectiveDegreesOfFreedom
  }) : null;
  const report = combined === null ? null : formatMeasurement(value,
    expanded?.expandedUncertainty ?? combined.standardUncertainty, {
      unit, digits, kind: expand ? 'expanded' : 'standard', coverageFactor: expanded?.coverageFactor
    });
  return { value, correction, statistics: stats, typeA: a, typeB: b, combined, expanded, report };
}

/** §§1.2、2.4。长度、质量、密度各自使用一致单位，角度用弧度。 */
export function pendulumCorrection({ length, diameter, stringMass, bobMass, airDensity, bobDensity, angleRad }) {
  positive(length, '摆长');
  positive(bobMass, '摆球质量');
  const ratio = nonnegative(diameter, '摆球直径') / length;
  const massRatio = nonnegative(stringMass, '摆线质量') / bobMass;
  const airRatio = nonnegative(airDensity, '空气密度') / positive(bobDensity, '摆球密度');
  const angle = Math.abs(number(angleRad, '摆角'));
  if (angle >= Math.PI) throw new RangeError('摆角绝对值必须小于 π');
  const terms = [
    { name: '摆球几何尺寸', relative: ratio ** 2 / 20 },
    { name: '摆线质量', relative: -massRatio / 12 * (1 + ratio / 2 + massRatio) },
    { name: '空气浮力', relative: airRatio / 2 },
    { name: '摆角', relative: angle ** 2 / 16 }
  ];
  const radicandFactor = 1 + terms.reduce((sum, term) => sum + term.relative, 0);
  if (!(radicandFactor > 0) || !Number.isFinite(radicandFactor)) {
    throw new RangeError('修正项已超出近似式的适用范围');
  }
  return { terms, radicandFactor, periodFactor: Math.sqrt(radicandFactor), smallAngle: angle <= 5 * Math.PI / 180 };
}

function repeatedReading(values, suppliedUncertainty, name) {
  if (!Array.isArray(values) || values.length === 0) throw new RangeError(`${name}至少需要一个读数`);
  for (const value of values) positive(value, name);
  const evaluatedA = values.length > 1 ? typeA(values) : null;
  const mean = values.reduce((total, value) => total + value / values.length, 0);
  const standardA = evaluatedA?.standardUncertainty ?? null;
  const standardB = suppliedUncertainty === undefined ? null : nonnegative(suppliedUncertainty, `${name} B 类标准不确定度`);
  if (standardA === null && standardB === null) {
    return { mean, count: values.length, standardA, standardB, standardUncertainty: null, degreesOfFreedom: null };
  }
  const standardUncertainty = Math.hypot(standardA ?? 0, standardB ?? 0);
  const degreesOfFreedom = standardA > 0
    ? evaluatedA.degreesOfFreedom * (standardUncertainty / standardA) ** 4
    : Infinity;
  return { mean, count: values.length, standardA, standardB, standardUncertainty, degreesOfFreedom };
}

/** §2.4 单摆。摆长用 m，累计计时用 s。输入的 B 类分量已换算为标准差。 */
export function gravityFromPendulum({ lengths, elapsedTimes, cycles, lengthStandardB, timeStandardB, correction }) {
  positiveInteger(cycles, '累计周期数');
  const length = repeatedReading(lengths, lengthStandardB, '摆长');
  const elapsed = repeatedReading(elapsedTimes, timeStandardB, '累计计时');
  const period = accumulatedReading(elapsed.mean, cycles, {
    standardUncertainty: elapsed.standardUncertainty ?? undefined
  });
  const appliedCorrection = correction === undefined ? null : pendulumCorrection({ ...correction, length: length.mean });
  const factor = appliedCorrection?.radicandFactor ?? 1;
  const model = ([l, t]) => 4 * Math.PI ** 2 * (l / t) / t * factor;
  const gravity = number(model([length.mean, period.value]), '重力加速度');
  const covarianceInputs = [
    { value: length.mean, standardUncertainty: length.standardUncertainty, degreesOfFreedom: length.degreesOfFreedom },
    { value: period.value, standardUncertainty: period.standardUncertainty, degreesOfFreedom: elapsed.degreesOfFreedom }
  ];
  let uncertainty = null;
  if (covarianceInputs.every(input => input.standardUncertainty !== null)) {
    // 传播摆长和周期。其余修正参数取输入的确定值。
    const lengthCorrection = appliedCorrection === null ? 0
      : (-2 * appliedCorrection.terms[0].relative +
        (correction.stringMass / correction.bobMass) * (correction.diameter / length.mean) / 24) / factor;
    uncertainty = propagateUncertainty(model, covarianceInputs, {
      gradient: () => [gravity / length.mean * (1 + lengthCorrection), -2 * gravity / period.value]
    });
  }
  return { gravity, unit: 'm/s²', length, elapsed, period, correction: appliedCorrection, uncertainty };
}

/** §2.4 双光电门，h/t = v₀ + (g/2)t，时间用 s、高度差用 m。 */
export function gravityFromPhotogates(records) {
  if (!Array.isArray(records) || records.length < 3) throw new RangeError('至少需要三组不同位置的光电门观测');
  const observations = records.map(({ heightDifference, elapsedTime, firstGateTime, secondGateTime }) => {
    positive(heightDifference, '两门高度差');
    const time = elapsedTime === undefined
      ? nonnegative(secondGateTime, '第二个光电门时刻') - nonnegative(firstGateTime, '第一个光电门时刻')
      : elapsedTime;
    positive(time, '两门经过时间差');
    return { heightDifference, elapsedTime: time, averageVelocity: heightDifference / time };
  });
  const points = observations.map(row => ({ x: row.elapsedTime, y: row.averageVelocity }));
  const regression = linearRegression(points);
  return {
    gravity: 2 * regression.slope, standardUncertainty: 2 * regression.slopeStandardError,
    initialVelocity: regression.intercept, unit: 'm/s²', observations, points, regression
  };
}

/** §2.4 已知物体由静止释放的位移和真实飞行时间（m、s）。 */
export function gravityFromRestDrop(distance, time) {
  positive(distance, '下落距离');
  positive(time, '飞行时间');
  return number(2 * (distance / time) / time, '重力加速度');
}

/** §2.4 球形近似下的引力与自转向心加速度，单位分别为 m、rad、rad/s 和 m³/s²。 */
export function gravityReferenceTerms({ radius, altitude = 0, latitudeRad, angularSpeed, gravitationalParameter }) {
  const distance = positive(positive(radius, '球体半径') + number(altitude, '海拔'), '到地心距离');
  const latitude = number(latitudeRad, '地理纬度');
  if (Math.abs(latitude) > Math.PI / 2) throw new RangeError('纬度须在 [-π/2, π/2]');
  const centrifugal = nonnegative(angularSpeed, '地球自转角速度') ** 2 * distance * Math.cos(latitude);
  const gravitation = positive(gravitationalParameter, 'GM') / distance / distance;
  return { gravitation, centripetal: centrifugal, unit: 'm/s²' };
}

/** §2.4 线性不确定度预算，独立分量按方和合成。未指定标准不确定度的项均分剩余预算。 */
export function uncertaintyBudget({ targetAbsolute, coverageFactor = 1, terms }) {
  const standardLimit = positive(targetAbsolute, '输出不确定度目标') / positive(coverageFactor, '覆盖因子');
  if (!Array.isArray(terms) || terms.length === 0) throw new RangeError('至少需要一个预算分量');
  const known = [];
  const adjustable = [];
  for (const { name, sensitivity, standardUncertainty } of terms) {
    number(sensitivity, '灵敏系数');
    if (standardUncertainty === undefined) {
      adjustable.push({ name, sensitivity });
    } else {
      const contribution = number(sensitivity * nonnegative(standardUncertainty, '输入标准不确定度'), '输出分量');
      known.push({ name, sensitivity, standardUncertainty, contribution });
    }
  }
  const knownCombined = Math.hypot(...known.map(term => term.contribution));
  const feasible = knownCombined <= standardLimit;
  const remaining = feasible ? Math.sqrt((1 - knownCombined / standardLimit) * (1 + knownCombined / standardLimit)) * standardLimit : null;
  const activeCount = adjustable.filter(term => term.sensitivity !== 0).length;
  const allocated = remaining === null || activeCount === 0 ? null : remaining / Math.sqrt(activeCount);
  const allocations = adjustable.map(term => ({ ...term,
    maxStandardUncertainty: allocated !== null && term.sensitivity !== 0 ? allocated / Math.abs(term.sensitivity) : null
  }));
  return { standardLimit, knownCombined, feasible, remaining, known, allocations };
}

/** §2.4 先确定摆长测量方案，再求手动累计计时所需的最少周期数。 */
export function planPendulumTiming({ length, period, lengthStandardUncertainty, timeStandardUncertainty,
  targetRelative, coverageFactor = 1 }) {
  positive(length, '摆长');
  positive(period, '预计周期');
  nonnegative(timeStandardUncertainty, '总计时标准不确定度');
  const budget = uncertaintyBudget({ targetAbsolute: targetRelative, coverageFactor, terms: [
    { name: '摆长', sensitivity: 1 / length, standardUncertainty: lengthStandardUncertainty },
    { name: '单周期', sensitivity: -2 / period }
  ] });
  if (lengthStandardUncertainty === undefined) throw new TypeError('指定摆长标准不确定度后才能规划计时');
  const available = budget.allocations[0].maxStandardUncertainty;
  const ratio = timeStandardUncertainty === 0 ? 0 : timeStandardUncertainty / available;
  const nearest = Math.round(ratio);
  const count = Math.abs(ratio - nearest) <= 2 * Number.EPSILON * ratio ? nearest : Math.ceil(ratio);
  const cycles = budget.feasible ? Math.max(1, count) : null;
  return { ...budget, feasible: Number.isSafeInteger(cycles) && cycles > 0,
    cycles: Number.isSafeInteger(cycles) ? cycles : null };
}

/** §2.4 大摆角理想单摆，以椭圆积分 K(sin(θ/2)) 计算 T。 */
export function finiteAmplitudePeriod(length, gravity, angleRad) {
  positive(length, '摆长');
  positive(gravity, '重力加速度');
  const angle = Math.abs(number(angleRad, '摆角'));
  if (angle >= Math.PI) throw new RangeError('往复摆动要求摆角绝对值小于 π');
  let arithmetic = 1;
  let geometric = Math.cos(angle / 2);
  while (arithmetic - geometric > 1e-14 * arithmetic) {
    const next = (arithmetic + geometric) / 2;
    geometric = Math.sqrt(arithmetic * geometric);
    arithmetic = next;
  }
  return 2 * Math.PI * (Math.sqrt(length) / Math.sqrt(gravity)) / arithmetic;
}

/** §2.4 对视频提取的各组振幅和周期拟合，用理想单摆模型反推 g。 */
export function fitPendulumPeriods(length, observations) {
  positive(length, '摆长');
  if (!Array.isArray(observations) || observations.length < 2) throw new RangeError('至少需要两组摆角与周期');
  const points = observations.map(({ angleRad, period }) => ({
    x: finiteAmplitudePeriod(length, 1, angleRad), y: positive(period, '实测周期')
  }));
  const regression = linearRegression(points, { throughOrigin: true });
  const gravity = 1 / regression.slope ** 2;
  return { gravity, standardUncertainty: 2 * gravity * regression.slopeStandardError / Math.abs(regression.slope),
    unit: 'm/s²', points, regression };
}

/** §2.4 从已标定的摆角轨迹提取同向过零周期和区间内离散采样的振幅。 */
export function pendulumPeriodsFromTrace(trace, { equilibriumAngle = 0, direction = 'rising' } = {}) {
  if (!Array.isArray(trace) || trace.length < 3) throw new RangeError('至少需要三个轨迹样本');
  number(equilibriumAngle, '平衡角');
  if (!['rising', 'falling'].includes(direction)) throw new RangeError('过零方向须为 rising 或 falling');
  const points = Array.from(trace, ({ time, angleRad }) => ({
    time: number(time, '样本时间'), angle: number(angleRad, '样本摆角') - equilibriumAngle
  }));
  const sign = direction === 'rising' ? 1 : -1;
  const crossings = [];
  let previousNonzero = points[0].angle === 0 ? null : 0;
  for (let i = 1; i < points.length; i += 1) {
    const right = points[i];
    if (right.time <= points[i - 1].time) throw new RangeError('轨迹时间须严格递增');
    if (right.angle === 0) continue;
    if (previousNonzero !== null) {
      const left = points[previousNonzero];
      if (left.angle * sign < 0 && right.angle * sign > 0) {
        const time = i > previousNonzero + 1
          ? (points[previousNonzero + 1].time / 2 + points[i - 1].time / 2)
          : left.time + (right.time - left.time) * (-left.angle / (right.angle - left.angle));
        crossings.push({ time, index: i });
      }
    }
    previousNonzero = i;
  }
  const observations = crossings.slice(1).map((end, i) => {
    const start = crossings[i];
    let amplitude = 0;
    for (let index = start.index; index < end.index; index += 1) {
      amplitude = Math.max(amplitude, Math.abs(points[index].angle));
    }
    return { startTime: start.time, endTime: end.time, period: end.time - start.time, angleRad: amplitude };
  });
  return { crossings, observations };
}

/** §2.4 圆锥摆。角度为摆线与竖直方向夹角，周期由轨迹提取。 */
export function gravityFromConicalPendulum(length, angleRad, period) {
  const angle = Math.abs(number(angleRad, '圆锥摆倾角'));
  if (!(angle > 0 && angle < Math.PI / 2)) throw new RangeError('圆锥摆的倾角绝对值须在 (0, π/2)');
  const height = positive(length, '摆长') * Math.cos(angle);
  const time = positive(period, '实测周期');
  return { gravity: 4 * Math.PI ** 2 * (height / time) / time, unit: 'm/s²',
    radius: length * Math.sin(angle), height };
}
