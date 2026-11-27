import { checkThreeSigma, combineUncertainties, sampleStatistics, typeB } from './measurement.mjs';

function number(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name}必须是有限数值`);
  return value;
}

function nonnegative(value, name) {
  if (number(value, name) < 0) throw new RangeError(`${name}必须大于或等于零`);
  return value;
}

function list(values, minimum, name) {
  if (!Array.isArray(values) || values.length < minimum) {
    throw new RangeError(`${name}至少要有${minimum}项`);
  }
  return values;
}

function readPoints(points, minimum = 1) {
  return Array.from(list(points, minimum, '数据点'), (point, index) => {
    const label = `第${index + 1}个点的`;
    if (point == null || typeof point !== 'object') throw new TypeError(label + '格式无效');
    const { x, y, ux, uy } = Array.isArray(point)
      ? { x: point[0], y: point[1], ux: point[2], uy: point[3] }
      : point;
    return {
      x: number(x, label + 'x'),
      y: number(y, label + 'y'),
      ux: nonnegative(ux ?? 0, label + 'x 误差限'),
      uy: nonnegative(uy ?? 0, label + 'y 误差限'),
    };
  });
}

function mean(values) {
  const origin = values[0];
  return origin + values.reduce((sum, value) => sum + (value - origin) / values.length, 0);
}

function sumSquares(values) {
  return values.reduce((sum, value) => sum + value * value, 0);
}

/**
 * 表 2-2-1 的记录结构。数值字符串保留原始写法（例如 20.0）。
 * 列定义：{key, label, unit?, role?}。每行可按键名或数组下标提供原始值。
 */
export function dataTable({ title, columns, rows }) {
  if (typeof title !== 'string' || !title.trim()) throw new TypeError('请填写表名');
  const keys = new Set();
  const headings = Array.from(list(columns, 1, '列定义'), (column) => {
    const { key, label, unit = '', role = 'observation' } = column ?? {};
    if (typeof key !== 'string' || !key.trim() || keys.has(key)
      || typeof label !== 'string' || !label.trim() || typeof unit !== 'string') {
      throw new TypeError('列名和列键必须有效，列键应唯一，单位应为文本');
    }
    if (!['independent', 'dependent', 'observation', 'derived'].includes(role)) {
      throw new RangeError('列的类型无效');
    }
    keys.add(key);
    return { key, label, unit, role, heading: unit ? `${label}/${unit}` : label };
  });
  const cells = Array.from(list(rows, 1, '各次观测'), (row, index) => {
    const array = Array.isArray(row);
    if (row == null || typeof row !== 'object' || (array && row.length !== headings.length)) {
      throw new TypeError(`第${index + 1}行与列定义不一致`);
    }
    const values = headings.map(({ key }, column) => {
      const cellKey = array ? column : key;
      const value = Object.hasOwn(row, cellKey) ? row[cellKey] : null;
      if (value !== null && typeof value !== 'string' && !Number.isFinite(value)) {
        throw new TypeError(`第${index + 1}行的${key}单元格无效`);
      }
      return value;
    });
    return { number: index + 1, values };
  });
  const numericPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  const summaries = headings.map(({ key, role }, column) => {
    const values = cells.map(({ values }) => values[column])
      .filter((value) => Number.isFinite(value)
        || (typeof value === 'string' && numericPattern.test(value.trim()) && Number.isFinite(Number(value))))
      .map(Number);
    const statistics = values.length ? sampleStatistics(values) : null;
    return {
      key,
      count: values.length,
      mean: statistics?.mean ?? null,
      sampleStandardDeviation: statistics?.sampleStandardDeviation ?? null,
      typeAStandardUncertainty: role === 'observation' ? statistics?.standardError ?? null : null,
    };
  });
  return { title, columns: headings, rows: cells, summaries };
}

function plottingAxis(scale) {
  if (scale === 'linear') return (value) => value;
  if (scale === 'log' || scale === 'ln') {
    return (value) => {
      if (value <= 0) throw new RangeError('对数坐标值必须大于零');
      return scale === 'log' ? Math.log10(value) : Math.log(value);
    };
  }
  throw new RangeError('坐标尺度须为 linear、log 或 ln');
}

/**
 * 为绘图库准备原始点、坐标变换及误差杆/矩形两端。对数轴若误差下界跨零，
 * 以 null 标注该下界。极坐标使用 x=角、y=半径，并返回中心和误差角点的平面坐标。
 */
export function plotData(points, {
  title = '', xLabel = 'x', yLabel = 'y', xUnit = '', yUnit = '',
  xScale = 'linear', yScale = 'linear', coordinateSystem = 'cartesian',
  angleUnit = 'rad', connect = false,
} = {}) {
  const data = readPoints(points);
  if (!['cartesian', 'polar'].includes(coordinateSystem)) throw new RangeError('未知坐标系');
  const xMap = plottingAxis(xScale);
  const yMap = plottingAxis(yScale);
  const xAxis = { label: xLabel, unit: xUnit, scale: xScale };
  const yAxis = { label: yLabel, unit: yUnit, scale: yScale };
  const polar = coordinateSystem === 'polar';
  if (polar && (xScale !== 'linear' || yScale !== 'linear' || !['rad', 'deg'].includes(angleUnit))) {
    throw new RangeError('极坐标要求线性尺度和 rad 或 deg 角度单位');
  }
  const display = data.map((point) => {
    const { x, y, ux, uy } = point;
    const bounds = {
      xLow: number(x - ux, '横坐标误差下界'),
      xHigh: number(x + ux, '横坐标误差上界'),
      yLow: number(y - uy, '纵坐标误差下界'),
      yHigh: number(y + uy, '纵坐标误差上界'),
    };
    if (polar) {
      nonnegative(y, '极坐标半径');
      const toRadians = angleUnit === 'deg' ? Math.PI / 180 : 1;
      const project = (angle, radius) => ({
        x: radius * Math.cos(angle * toRadians),
        y: radius * Math.sin(angle * toRadians),
      });
      const low = bounds.yLow < 0 ? null : bounds.yLow;
      return {
        ...point,
        plot: project(x, y),
        bounds,
        radialBar: [low === null ? null : project(x, low), project(x, bounds.yHigh)],
        angularBar: [project(bounds.xLow, y), project(bounds.xHigh, y)],
        corners: [
          low === null ? null : project(bounds.xLow, low),
          project(bounds.xLow, bounds.yHigh),
          project(bounds.xHigh, bounds.yHigh),
          low === null ? null : project(bounds.xHigh, low),
        ],
      };
    }
    return {
      ...point,
      plot: { x: xMap(x), y: yMap(y) },
      bounds,
      plotBounds: {
        xLow: xScale !== 'linear' && bounds.xLow <= 0 ? null : xMap(bounds.xLow),
        xHigh: xMap(bounds.xHigh),
        yLow: yScale !== 'linear' && bounds.yLow <= 0 ? null : yMap(bounds.yLow),
        yHigh: yMap(bounds.yHigh),
      },
    };
  });
  return { title, coordinateSystem, xAxis, yAxis, angleUnit, connect, points: display };
}

/** 点的 x 为被校仪读数，y 为参考仪读数。 */
export function calibrationCurve(points, { reading, ...plotOptions } = {}) {
  const readings = readPoints(points, 2).sort((a, b) => a.x - b.x);
  if (readings.some((point, index) => index && point.x === readings[index - 1].x)) {
    throw new RangeError('校准曲线的被校仪读数必须互不相同');
  }
  const corrections = readings.map(({ x, y, ux, uy }) => ({
    x, y: y - x, ux, uy: Math.hypot(ux, uy), reference: y,
  }));
  let prediction = null;
  if (reading !== undefined) {
    number(reading, '待修正读数');
    const rightIndex = corrections.findIndex((point) => point.x >= reading);
    const right = corrections[rightIndex];
    const left = corrections[rightIndex - 1];
    const exact = right?.x === reading;
    const withinRange = exact || Boolean(left && right);
    let correction = null;
    if (exact) {
      correction = right.y;
    } else if (withinRange) {
      const fraction = (reading - left.x) / (right.x - left.x);
      correction = left.y + fraction * (right.y - left.y);
    }
    prediction = { reading, withinRange, correction, correctedValue: correction === null ? null : reading + correction };
  }
  return {
    corrections,
    prediction,
    ...plotData(corrections, { ...plotOptions, connect: true }),
  };
}

/** 在画出的趋势线上选 a、b 两点，并可提交全部观测点进行仪器不确定度估计。 */
export function lineFromPoints(a, b, { points } = {}) {
  const [left, right] = readPoints([a, b]);
  const { x: x1, y: y1 } = left;
  const dx = right.x - x1;
  const dy = right.y - y1;
  if (dx === 0) throw new RangeError('两点横坐标必须不同');
  const slope = dy / dx;
  const intercept = y1 - slope * x1;
  if (points === undefined) return { slope, intercept, points: [left, right] };
  const observations = readPoints(points, 2).sort((first, second) => first.x - second.x);
  const endpoints = [observations[0], observations.at(-1)];
  const xSpan = endpoints[1].x - endpoints[0].x;
  const ySpan = endpoints[1].y - endpoints[0].y;
  if (xSpan === 0) throw new RangeError('观测值须覆盖不同的横坐标');
  const meanUxSquared = sumSquares(observations.map(({ ux }) => ux)) / observations.length;
  const meanUySquared = sumSquares(observations.map(({ uy }) => uy)) / observations.length;
  const relativeSlopeUncertainty = ySpan === 0 || slope === 0
    ? null : Math.hypot(Math.sqrt(2 * meanUxSquared) / xSpan, Math.sqrt(2 * meanUySquared) / ySpan);
  const slopeUncertainty = relativeSlopeUncertainty === null
    ? null : Math.abs(slope) * relativeSlopeUncertainty;
  const interceptUncertainty = slopeUncertainty === null
    ? null : slopeUncertainty * Math.hypot(endpoints[0].x, endpoints[1].x) / Math.SQRT2;
  return {
    slope, intercept, points: [left, right], endpoints, xSpan, ySpan, meanUxSquared, meanUySquared,
    relativeSlopeUncertainty, slopeUncertainty, interceptUncertainty,
  };
}

export function linearRegression(points, { throughOrigin = false } = {}) {
  const data = readPoints(points, throughOrigin ? 1 : 2);
  const n = data.length;
  const meanX = mean(data.map(({ x }) => x));
  const meanY = mean(data.map(({ y }) => y));
  const lxx = sumSquares(data.map(({ x }) => x - meanX));
  const lyy = sumSquares(data.map(({ y }) => y - meanY));
  const lxy = data.reduce((sum, { x, y }) => sum + (x - meanX) * (y - meanY), 0);
  const fitX2 = throughOrigin ? sumSquares(data.map(({ x }) => x)) : lxx;
  const fitXY = throughOrigin ? data.reduce((sum, { x, y }) => sum + x * y, 0) : lxy;
  if (fitX2 === 0) throw new RangeError('该组横坐标无法识别斜率');
  const slope = number(fitXY / fitX2, '拟合斜率');
  const intercept = throughOrigin ? 0 : number(meanY - slope * meanX, '拟合截距');
  const predict = (x) => throughOrigin ? slope * x : meanY + slope * (x - meanX);
  const fitted = data.map(({ x, y }) => ({ x, y, predicted: predict(x), residual: y - predict(x) }));
  const residualSumSquares = number(sumSquares(fitted.map(({ residual }) => residual)), '残差平方和');
  const degreesOfFreedom = n - (throughOrigin ? 1 : 2);
  const residualVariance = degreesOfFreedom > 0 ? residualSumSquares / degreesOfFreedom : null;
  const slopeVariance = residualVariance === null ? null : residualVariance / fitX2;
  const interceptVariance = slopeVariance === null
    ? null : throughOrigin ? 0 : residualVariance / n + meanX * meanX * slopeVariance;
  const slopeInterceptCovariance = slopeVariance === null
    ? null : throughOrigin ? 0 : -meanX * slopeVariance;
  const correlation = lxx === 0 || lyy === 0
    ? null : Math.max(-1, Math.min(1, lxy / Math.sqrt(lxx) / Math.sqrt(lyy)));
  const rSquared = lyy === 0 ? null : 1 - residualSumSquares / lyy;
  const adjustedRSquared = lyy === 0 || degreesOfFreedom <= 0
    ? null : 1 - (residualSumSquares / lyy) * (n - 1) / degreesOfFreedom;
  return {
    n, meanX, meanY, lxx, lxy, lyy, slope, intercept, correlation, degreesOfFreedom,
    rSquared, adjustedRSquared,
    residualSumSquares, residualVariance, fitted, slopeVariance, interceptVariance,
    residualStandardDeviation: residualVariance === null ? null : Math.sqrt(residualVariance),
    slopeStandardError: slopeVariance === null ? null : Math.sqrt(slopeVariance),
    interceptStandardError: interceptVariance === null ? null : Math.sqrt(interceptVariance),
    slopeInterceptCovariance,
  };
}

/**
 * x、y 是原关系的自变量和因变量。y 的预期物理关系用于生成直线形式。
 * 误差通过一阶传播（独立 x、y）换算；变换后各轴可能相关。
 */
export function linearize(points, model, { base = model === 'power' ? 10 : Math.E } = {}) {
  if (!['linear', 'power', 'exponential', 'logarithmic', 'inverse', 'kinematic'].includes(model)) {
    throw new RangeError('未知曲线改直模型');
  }
  if (['power', 'exponential', 'logarithmic'].includes(model) && number(base, '对数底') <= 1) {
    throw new RangeError('对数底必须大于 1');
  }
  const logBase = Math.log(base);
  function logged(value) {
    if (value <= 0) throw new RangeError('对数变换的输入必须大于零');
    return Math.log(value) / logBase;
  }
  const transformed = readPoints(points).map(({ x, y, ux, uy }) => {
    switch (model) {
      case 'power':
        return { x: logged(x), y: logged(y), ux: ux / (x * logBase), uy: uy / (y * logBase) };
      case 'exponential':
        return { x, y: logged(y), ux, uy: uy / (y * logBase) };
      case 'logarithmic':
        return { x: logged(x), y, ux: ux / (x * logBase), uy };
      case 'inverse':
        if (x === 0) throw new RangeError('倒数变换要求 x 非零');
        return { x: 1 / x, y, ux: ux / Math.abs(x) / Math.abs(x), uy };
      case 'kinematic':
        if (x === 0) throw new RangeError('匀加速改直要求 t 非零');
        return { x, y: y / x, ux, uy: Math.hypot(uy / x, (y / x) * (ux / x)) };
      default:
        return { x, y, ux, uy };
    }
  });
  return { model, base, points: readPoints(transformed) };
}

function solveUpper(matrix, right) {
  const result = Array(right.length).fill(0);
  for (let row = right.length - 1; row >= 0; row -= 1) {
    let value = right[row];
    for (let column = row + 1; column < right.length; column += 1) {
      value -= matrix[row][column] * result[column];
    }
    result[row] = value / matrix[row][row];
  }
  return result;
}

function polynomialFit(data, degree, requestedPowers) {
  const powers = requestedPowers === undefined
    ? Array.from({ length: degree + 1 }, (_, power) => power)
    : Array.from(list(requestedPowers, 1, '多项式幂次')).sort((a, b) => a - b);
  if (powers.some((power, index) => !Number.isInteger(power) || power < 0 || power > 12
    || power === powers[index - 1])) {
    throw new RangeError('多项式幂次必须是不重复的 0 至 12 的整数');
  }
  if (data.length < powers.length) throw new RangeError('数据点个数不得少于待估参数数目');
  const scale = data.reduce((largest, { x }) => Math.max(largest, Math.abs(x)), 0) || 1;
  const design = data.map(({ x }) => powers.map((power) => (x / scale) ** power));
  const result = data.map(({ y }) => y);
  const rankTolerance = 16 * Number.EPSILON * Math.sqrt(data.length);

  // Householder QR 避免用正规方程把设计矩阵的条件数平方。
  for (let column = 0; column < powers.length; column += 1) {
    const vector = design.slice(column).map((row) => row[column]);
    const norm = vector.reduce((length, value) => Math.hypot(length, value), 0);
    if (norm <= rankTolerance) throw new RangeError('多项式设计矩阵退化，请检查数据或降低次数');
    vector[0] += vector[0] >= 0 ? norm : -norm;
    const denominator = sumSquares(vector);
    for (let j = column; j < powers.length; j += 1) {
      const factor = 2 * vector.reduce((sum, value, i) => sum + value * design[column + i][j], 0)
        / denominator;
      vector.forEach((value, i) => { design[column + i][j] -= factor * value; });
    }
    const rightFactor = 2 * vector.reduce((sum, value, i) => sum + value * result[column + i], 0)
      / denominator;
    vector.forEach((value, i) => { result[column + i] -= rightFactor * value; });
  }

  const scaled = solveUpper(design, result.slice(0, powers.length));
  const coefficients = scaled.map((value, i) => number(value / scale ** powers[i], '多项式系数'));
  const predict = (x) => scaled.reduce((sum, coefficient, i) =>
    sum + coefficient * (x / scale) ** powers[i], 0);
  const fitted = data.map(({ x, y }) => ({ x, y, predicted: predict(x), residual: y - predict(x) }));
  const residualSumSquares = number(sumSquares(fitted.map(({ residual }) => residual)), '残差平方和');
  const degreesOfFreedom = data.length - powers.length;
  const meanY = mean(data.map(({ y }) => y));
  const total = sumSquares(data.map(({ y }) => y - meanY));
  const rSquared = total === 0 ? null : 1 - residualSumSquares / total;
  const adjustedRSquared = total === 0 || degreesOfFreedom <= 0
    ? null : 1 - (residualSumSquares / total) * (data.length - 1) / degreesOfFreedom;
  let parameterCovariance = null;
  let standardErrors = null;
  if (degreesOfFreedom > 0) {
    const inverses = powers.map((_, column) =>
      solveUpper(design, powers.map((__, row) => (row === column ? 1 : 0))));
    const variance = residualSumSquares / degreesOfFreedom;
    parameterCovariance = powers.map((power1, i) => powers.map((power2, j) => {
      const innerProduct = inverses.reduce((sum, inverse) => sum + inverse[i] * inverse[j], 0);
      return variance * innerProduct / scale ** power1 / scale ** power2;
    }));
    standardErrors = parameterCovariance.map((row, i) => Math.sqrt(row[i]));
  }
  return {
    model: 'polynomial', powers, coefficients, standardErrors, parameterCovariance, fitted,
    residualSumSquares, degreesOfFreedom, rSquared, adjustedRSquared,
  };
}

function regressionParameterUncertainty(fit, derivatives) {
  const { interceptVariance, slopeVariance, slopeInterceptCovariance } = fit;
  const parameterOrder = Object.keys(derivatives);
  if (slopeVariance === null) return { parameterOrder, parameterCovariance: null, parameterStandardErrors: null };
  const sensitivity = Object.values(derivatives);
  const parameterCovariance = sensitivity.map(([db1, dm1]) =>
    sensitivity.map(([db2, dm2]) => db1 * db2 * interceptVariance + dm1 * dm2 * slopeVariance
      + (db1 * dm2 + dm1 * db2) * slopeInterceptCovariance));
  const parameterStandardErrors = Object.fromEntries(parameterOrder.map((key, i) =>
    [key, Math.sqrt(Math.max(0, parameterCovariance[i][i]))]));
  return { parameterOrder, parameterCovariance, parameterStandardErrors };
}

/**
 * 教材改直后的线性最小二乘，或直接在原坐标做多项式最小二乘。
 * powers=[2] 即教材把 Parabola 中常数项和一次项固定为零的做法。
 */
export function fitCurve(points, model, { base, degree = 2, powers, throughOrigin = model === 'inverse' } = {}) {
  const data = readPoints(points);
  if (model === 'polynomial') {
    if (!Number.isInteger(degree) || degree < 0 || degree > 12) {
      throw new RangeError('多项式次数须为 0 至 12 的整数');
    }
    return polynomialFit(data, degree, powers);
  }
  const transformed = linearize(data, model, { base });
  const fit = linearRegression(transformed.points, { throughOrigin });
  const { slope, intercept } = fit;
  const logBase = Math.log(transformed.base);
  let parameters = { slope, intercept };
  let derivatives = { slope: [0, 1], intercept: [1, 0] };
  let predict = (x) => slope * x + intercept;
  switch (model) {
    case 'power': {
      const a = number(transformed.base ** intercept, '幂函数系数');
      parameters = { a, b: slope };
      derivatives = { a: [a * logBase, 0], b: [0, 1] };
      predict = (x) => a * x ** slope;
      break;
    }
    case 'exponential': {
      const a = number(transformed.base ** intercept, '指数函数系数');
      const b = slope * logBase;
      parameters = { a, b };
      derivatives = { a: [a * logBase, 0], b: [0, logBase] };
      predict = (x) => a * Math.exp(b * x);
      break;
    }
    case 'logarithmic':
      parameters = { a: intercept, b: slope, base: transformed.base };
      derivatives = { a: [1, 0], b: [0, 1] };
      predict = (x) => intercept + slope * Math.log(x) / logBase;
      break;
    case 'inverse':
      parameters = { a: slope, b: intercept };
      derivatives = { a: [0, 1], b: [1, 0] };
      predict = (x) => intercept + slope / x;
      break;
    case 'kinematic':
      parameters = { initialVelocity: intercept, acceleration: 2 * slope };
      derivatives = { initialVelocity: [1, 0], acceleration: [0, 2] };
      predict = (x) => x * (intercept + slope * x);
      break;
    default:
      break;
  }
  const fitted = data.map(({ x, y }) => {
    const predicted = number(predict(x), '原坐标预测值');
    return { x, y, predicted, residual: y - predicted };
  });
  return { model, parameters, transformed, fit, fitted, ...regressionParameterUncertainty(fit, derivatives) };
}

/** 表 2-2-1，输入 x=摄氏温度、y=电阻（Ω）。 */
export function thermistorAnalysis(points, { kelvinOffset = 273.15 } = {}) {
  number(kelvinOffset, '开尔文零点偏移');
  const rows = readPoints(points, 2).map(({ x, y, ux, uy }) => {
    const temperatureK = x + kelvinOffset;
    if (temperatureK <= 0 || y <= 0) throw new RangeError('热力学温度和电阻均须大于零');
    return {
      temperatureC: x, resistanceOhm: y, temperatureK, reciprocalTemperature: 1 / temperatureK,
      logResistance: Math.log(y), uTemperature: ux, uResistance: uy,
    };
  });
  const transformed = rows.map(({ temperatureK, resistanceOhm, uTemperature, uResistance }) =>
    ({ x: 1 / temperatureK, y: resistanceOhm, ux: uTemperature / temperatureK ** 2, uy: uResistance }));
  const regression = fitCurve(transformed, 'exponential');
  return {
    rows, resistanceAtInfiniteTemperatureOhm: regression.parameters.a,
    temperatureCoefficientK: regression.parameters.b, regression,
  };
}

/** 表 2-2-4，输入 x=温度、y=长度，L=L0(1+αt)。 */
export function thermalExpansionFit(points, { linePoints } = {}) {
  const fit = linearRegression(points);
  if (fit.intercept === 0) throw new RangeError('零度外推长度必须非零');
  const { slope, intercept } = fit;
  const regression = regressionParameterUncertainty(fit,
    { expansionCoefficient: [-slope / intercept ** 2, 1 / intercept], initialLength: [1, 0] });
  let graphical = null;
  if (linePoints !== undefined) {
    const [p1, p2] = readPoints(linePoints, 2);
    const line = lineFromPoints(p1, p2, { points });
    const numerator = p2.y - p1.y;
    const denominator = p1.y * p2.x - p2.y * p1.x;
    if (denominator === 0) throw new RangeError('作图法的零度外推长度必须非零');
    const dX1 = numerator * p2.y / denominator ** 2;
    const dX2 = -numerator * p1.y / denominator ** 2;
    const dY1 = -1 / denominator - numerator * p2.x / denominator ** 2;
    const dY2 = 1 / denominator + numerator * p1.x / denominator ** 2;
    const standardUncertainty = Math.sqrt(line.meanUxSquared * (dX1 ** 2 + dX2 ** 2)
      + line.meanUySquared * (dY1 ** 2 + dY2 ** 2));
    graphical = { expansionCoefficient: numerator / denominator, standardUncertainty, line };
  }
  return { expansionCoefficient: slope / intercept, initialLength: intercept, fit, regression, graphical };
}

/** 第49页物理摆（套管与可移杆），输入 x=距离 m、y=周期 s。 */
export function physicalPendulumFit(points, { rodMass, coefficient } = {}) {
  if (number(rodMass, '金属杆质量') <= 0 || number(coefficient, '物理摆常量 k') <= 0) {
    throw new RangeError('金属杆质量和常量 k 须为正值');
  }
  const timeFactor = coefficient / (4 * Math.PI ** 2);
  const transformed = readPoints(points, 2).map(({ x, y, ux, uy }) => {
    if (y <= 0) throw new RangeError('物理摆周期须为正值');
    return { x, y: timeFactor * y ** 2 - rodMass * x ** 2, ux,
      uy: Math.hypot(2 * timeFactor * y * uy, 2 * rodMass * x * ux) };
  });
  const fit = linearRegression(transformed);
  const length = -fit.slope / rodMass;
  const inertia = fit.intercept - rodMass * length ** 2 / 3;
  const uncertainty = regressionParameterUncertainty(fit, { length: [0, -1 / rodMass],
    inertia: [1, 2 * length / 3] });
  return { length, inertia, transformed, fit, ...uncertainty };
}

/** 等间隔样本分成长度相同的两组，默认跳过奇数样本的中点。 */
export function successiveDifferences(points, { stride, tolerance = 1e-8 } = {}) {
  const data = readPoints(points, 2).sort((a, b) => a.x - b.x);
  nonnegative(tolerance, '相对间隔容差');
  const step = data[1].x - data[0].x;
  if (step === 0 || data.some((point, i) => i && (
    point.x <= data[i - 1].x || Math.abs((point.x - data[i - 1].x) - step) > tolerance * step
  ))) throw new RangeError('逐差的横坐标须互不相同并且等间隔');
  const offset = stride ?? Math.ceil(data.length / 2);
  if (!Number.isInteger(offset) || offset < 1 || offset >= data.length) {
    throw new RangeError('逐差跨度须为小于点数的正整数');
  }
  const pairs = data.slice(0, data.length - offset).map((a, i) => {
    const b = data[i + offset];
    return { a, b, dx: b.x - a.x, dy: b.y - a.y, slope: (b.y - a.y) / (b.x - a.x) };
  });
  const meanDifference = mean(pairs.map(({ dy }) => dy));
  const slope = mean(pairs.map((pair) => pair.slope));
  const intercept = mean(data.map(({ x, y }) => y - slope * x));
  return { step, stride: offset, pairs, meanDifference, slope, intercept };
}

/** 评估纵向残差，报告可疑点。默认用其余点拟合直线，predict 可提供已确定的曲线。 */
export function graphicalOutliers(points, predict, { multiplier = 3 } = {}) {
  const data = readPoints(points, predict === undefined ? 3 : 1);
  if (predict !== undefined && typeof predict !== 'function') throw new TypeError('预测应为函数');
  if (number(multiplier, '判别倍数') <= 0) throw new RangeError('判别倍数须为正值');
  return data.map(({ x, y, uy }, index) => {
    let predicted;
    if (predict === undefined) {
      const { slope, intercept } = linearRegression(data.filter((_, i) => i !== index));
      predicted = slope * x + intercept;
    } else {
      predicted = number(predict(x, index), '曲线预测值');
    }
    const assessment = checkThreeSigma(y, predicted, uy, multiplier);
    return {
      index, x, y, predicted, residual: assessment.difference,
      threshold: uy === 0 ? null : assessment.threshold,
      flagged: uy !== 0 && assessment.exceeds,
    };
  });
}

/** 表 2-2-6。x 为仪器读数，y 是修正值（参考读数减仪器读数）。 */
export function thermometerCalibration(points, { referenceTemperature = 20, temperature } = {}) {
  const data = readPoints(points, 3);
  number(referenceTemperature, '参考温度');
  const fit = linearRegression(data.map(({ x, y }) => ({ x: x - referenceTemperature, y })));
  const { interceptVariance, slopeVariance, slopeInterceptCovariance, meanX, intercept, slope } = fit;
  const parameterCorrelation = slopeVariance && interceptVariance
    ? slopeInterceptCovariance / Math.sqrt(interceptVariance * slopeVariance) : null;
  const minimumVarianceTemperature = referenceTemperature + meanX;
  const readMin = data.reduce((lowest, { x }) => Math.min(x, lowest), Infinity);
  const readMax = data.reduce((highest, { x }) => Math.max(x, highest), -Infinity);
  let prediction = null;
  if (temperature !== undefined) {
    const x = number(temperature, '待校准温度') - referenceTemperature;
    const correction = intercept + slope * x;
    const variance = fit.residualVariance / fit.n + (x - meanX) ** 2 * slopeVariance;
    prediction = {
      temperature, correction, correctedTemperature: temperature + correction, variance,
      standardUncertainty: Math.sqrt(variance), extrapolated: temperature < readMin || temperature > readMax,
    };
  }
  return { referenceTemperature, minTemperature: readMin, maxTemperature: readMax, fit,
    parameterCorrelation, minimumVarianceTemperature, prediction };
}

/** 表 2-2-5。长度单位由字段名指明，热膨胀系数以 1/℃ 表示。 */
export function gaugeBlockCalibration({
  referenceLengthMm = 50.000623, differenceNm = 215, differenceReadingsNm,
  referenceExpandedNm = 75, referenceCoverage = 3, referenceDegreesOfFreedom = 18,
  pooledStandardDeviationNm = 13, pooledDegreesOfFreedom = 24, repeatCount = 5,
  randomExpandedNm = 10, randomCoverage = 2.57, randomDegreesOfFreedom = 5,
  systematicExpandedNm = 20, systematicCoverage = 3, systematicDegreesOfFreedom = 8,
  expansionCoefficient = 11.5e-6, expansionHalfWidth = 2e-6,
  expansionDifference = 0, expansionDifferenceHalfWidth = 1e-6, expansionDifferenceDegreesOfFreedom = 50,
  benchTemperatureC = 19.9, referenceTemperatureC = 20, benchMeanStandardC = 0.2, benchAmplitudeC = 0.5,
  temperatureDifferenceC = 0, temperatureDifferenceHalfWidthC = 0.05, temperatureDifferenceDegreesOfFreedom = 2,
} = {}) {
  const coverage = (value, name) => {
    if (number(value, name) <= 0) throw new RangeError(`${name}必须大于零`);
    return value;
  };
  const degrees = (value) => value === Infinity ? Infinity : coverage(value, '自由度');
  const uReference = nonnegative(referenceExpandedNm, '标准量块的扩展不确定度')
    / coverage(referenceCoverage, '标准量块的包含因子');
  const uRandom = nonnegative(randomExpandedNm, '比较仪的随机扩展不确定度')
    / coverage(randomCoverage, '随机影响的包含因子');
  const uSystematic = nonnegative(systematicExpandedNm, '比较仪的系统扩展不确定度')
    / coverage(systematicCoverage, '系统影响的包含因子');
  let count = repeatCount;
  let difference = number(differenceNm, '长度差');
  if (differenceReadingsNm !== undefined) {
    const observations = Array.from(list(differenceReadingsNm, 1, '实测长度差'),
      (value) => number(value, '实测长度差'));
    difference = mean(observations);
    count = observations.length;
  }
  if (!Number.isInteger(count) || count < 1) throw new RangeError('重复观测次数必须为正整数');
  const uRepeat = nonnegative(pooledStandardDeviationNm, '合并实验标准差') / Math.sqrt(count);
  const uExpansion = nonnegative(expansionHalfWidth, '热膨胀系数半宽') / Math.sqrt(3);
  const uExpansionDiff = nonnegative(expansionDifferenceHalfWidth, '热膨胀系数差半宽') / Math.sqrt(3);
  const uTemperatureDiff = nonnegative(temperatureDifferenceHalfWidthC, '温差半宽') / Math.sqrt(3);
  const benchCycle = typeB({ distribution: 'arcsine', halfWidth: benchAmplitudeC }).standardUncertainty;
  const uTemperature = Math.hypot(nonnegative(benchMeanStandardC, '台温均值标准不确定度'), benchCycle);
  const theta = number(benchTemperatureC, '测试台温度') - number(referenceTemperatureC, '参考温度');
  const alpha = number(expansionCoefficient, '标准量块热膨胀系数');
  const deltaAlpha = number(expansionDifference, '热膨胀系数差');
  const deltaTheta = number(temperatureDifferenceC, '量块温度差');
  const lengthReferenceNm = coverage(referenceLengthMm, '标准量块长度') * 1e6;
  const thermalFactor = 1 - deltaAlpha * theta - alpha * deltaTheta;
  const lengthNm = lengthReferenceNm * thermalFactor + difference;
  const components = [
    ['reference', uReference, thermalFactor, referenceDegreesOfFreedom],
    ['differenceRepeat', uRepeat, 1, pooledDegreesOfFreedom],
    ['differenceRandom', uRandom, 1, randomDegreesOfFreedom],
    ['differenceSystematic', uSystematic, 1, systematicDegreesOfFreedom],
    ['expansionCoefficient', uExpansion, -lengthReferenceNm * deltaTheta, Infinity],
    ['benchTemperature', uTemperature, -lengthReferenceNm * deltaAlpha, Infinity],
    ['expansionDifference', uExpansionDiff, -lengthReferenceNm * theta, expansionDifferenceDegreesOfFreedom],
    ['temperatureDifference', uTemperatureDiff, -lengthReferenceNm * alpha, temperatureDifferenceDegreesOfFreedom],
  ].map(([name, standardUncertainty, sensitivity, df]) => ({
    name, standardUncertainty, sensitivity, contributionNm: Math.abs(sensitivity) * standardUncertainty,
    degreesOfFreedom: degrees(df),
  }));
  const contributions = components.map(({ contributionNm, degreesOfFreedom }) =>
    ({ standardUncertainty: contributionNm, degreesOfFreedom }));
  const differenceBudget = combineUncertainties(contributions.slice(1, 4));
  const { standardUncertainty: combinedStandardUncertaintyNm, variance: varianceNm2, effectiveDegreesOfFreedom }
    = combineUncertainties(contributions);
  const firstOrderThermalVariance = sumSquares(components.slice(4).map(({ contributionNm }) => contributionNm))
    / lengthReferenceNm ** 2;
  const additionalThermalVariance = (uExpansionDiff * uTemperature) ** 2 + (uExpansion * uTemperatureDiff) ** 2;
  const additionalVarianceNm2 = lengthReferenceNm ** 2 * additionalThermalVariance
    + uReference ** 2 * (firstOrderThermalVariance + additionalThermalVariance);
  return {
    lengthMm: lengthNm / 1e6, differenceNm: difference, repeatCount: count, components,
    differenceStandardUncertaintyNm: differenceBudget.standardUncertainty,
    differenceDegreesOfFreedom: differenceBudget.effectiveDegreesOfFreedom,
    combinedStandardUncertaintyNm, varianceNm2,
    relativeStandardUncertainty: lengthNm === 0 ? null : combinedStandardUncertaintyNm / Math.abs(lengthNm),
    effectiveDegreesOfFreedom,
    additionalVarianceNm2, exactProductStandardUncertaintyNm: Math.sqrt(varianceNm2 + additionalVarianceNm2),
  };
}

/** 表 2-3-2。各档输入 {distanceM, timesMs}，挡光片间距以 mm 指定。 */
export function airTrackAnalysis(records, { flagWidthMm = 10 } = {}) {
  if (number(flagWidthMm, '挡光片宽度') <= 0) throw new RangeError('挡光片宽度须为正值');
  const rows = Array.from(list(records, 2, '气垫导轨观测'), (record) => {
    const distanceM = nonnegative(record?.distanceM, '滑行距离');
    const timesMs = Array.from(list(record.timesMs, 1, '挡光计时'), (time) => {
      if (number(time, '挡光时间') <= 0) throw new RangeError('挡光时间须为正值');
      return time;
    });
    const meanTimeMs = mean(timesMs);
    const velocityMps = flagWidthMm / meanTimeMs;
    return { distanceM, timesMs, meanTimeMs, velocityMps, velocitySquared: velocityMps ** 2 };
  });
  const linear = linearRegression(rows.map(({ distanceM, velocitySquared }) => [2 * distanceM, velocitySquared]));
  const quadratic = fitCurve(rows.map(({ distanceM, velocityMps }) => [velocityMps, distanceM]),
    'polynomial', { powers: [2] });
  const coefficient = quadratic.coefficients[0];
  const coefficientStandardError = quadratic.standardErrors?.[0] ?? null;
  return {
    rows, linear, quadratic, linearAcceleration: linear.slope,
    linearAccelerationStandardError: linear.slopeStandardError,
    quadraticAcceleration: coefficient === 0 ? null : 1 / (2 * coefficient),
    quadraticAccelerationStandardError: coefficient === 0 || coefficientStandardError === null
      ? null : coefficientStandardError / (2 * coefficient ** 2),
  };
}

/** 已追踪的位置转为位移和速度。输入帧号（指定 fps）或时间秒数，以及 x、可选 y。 */
export function motionFromPositions(positions, { scale = 1, fps } = {}) {
  if (number(scale, '长度标定系数') <= 0) throw new RangeError('长度标定系数须为正值');
  if (fps !== undefined && number(fps, '帧率') <= 0) throw new RangeError('帧率须为正值');
  const points = Array.from(list(positions, 2, '追踪位置'), (point) => {
    if (point == null || typeof point !== 'object') throw new TypeError('追踪点格式无效');
    let time = point.time;
    if (time === undefined) {
      if (fps === undefined || !Number.isSafeInteger(point.frame) || point.frame < 0) {
        throw new RangeError('请提供每点的时间，或提供帧率和非负整数帧号');
      }
      time = point.frame / fps;
    }
    return { time: number(time, '样本时间'), x: number(point.x, '横坐标') * scale,
      y: number(point.y ?? 0, '纵坐标') * scale };
  });
  const intervals = points.slice(1).map((end, index) => {
    const start = points[index];
    const dt = end.time - start.time;
    if (dt <= 0) throw new RangeError('追踪时间须严格递增');
    const vx = (end.x - start.x) / dt;
    const vy = (end.y - start.y) / dt;
    return { start, end, dt, time: start.time + dt / 2, vx, vy, speed: Math.hypot(vx, vy) };
  });
  return { points, intervals };
}
