import * as lab from '../index.mjs';
import { airTrackRecords, cylinderReadings, thermometerPoints, thermistorPoints } from '../examples.mjs';

const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const group = {
  measurement: '测量与不确定度',
  plot: '图表与拟合',
  experiment: '校准与实验',
};

function number(value, label, { optional = false, min = -Infinity, max = Infinity, integer = false } = {}) {
  const input = String(value ?? '').trim().replaceAll('−', '-');
  if (!input && optional) return undefined;
  const parsed = Number(input);
  if (!numberPattern.test(input) || !Number.isFinite(parsed)) throw new TypeError(`请填写有效的${label}。`);
  if (parsed < min || parsed > max || (integer && !Number.isSafeInteger(parsed))) {
    throw new RangeError(`${label}超出允许范围。`);
  }
  return parsed;
}

function tokens(value) {
  return String(value ?? '').trim().split(/[\s,，;；]+/u).filter(Boolean);
}

function numberList(value, label, { optional = false } = {}) {
  const values = tokens(value);
  if (!values.length && !optional) throw new TypeError(`请填写${label}。`);
  if (values.length > 5000) throw new RangeError(`${label}最多可输入 5,000 个数值。`);
  return values.map((entry, i) => number(entry, `${label}第 ${i + 1} 项`));
}

function numericRows(value, label, { minimum = 2, maximum = 4, exactly, rowLimit = 2000 } = {}) {
  const rows = String(value ?? '').trim().split(/\r\n?|\n/u).filter(line => line.trim());
  if (!rows.length) throw new TypeError(`请填写${label}。`);
  if (rows.length > rowLimit) throw new RangeError(`${label}最多可输入 ${rowLimit} 行。`);
  return rows.map((line, i) => {
    const entries = tokens(line);
    if (exactly ? !exactly.includes(entries.length) : entries.length < minimum || entries.length > maximum) {
      const columnCount = exactly ? exactly.join(' 或 ') : `${minimum} 至 ${maximum}`;
      throw new RangeError(`${label}第 ${i + 1} 行应有 ${columnCount} 列。`);
    }
    return entries.map((entry, j) => number(entry, `第 ${i + 1} 行、第 ${j + 1} 列数值`));
  });
}

function points(value) {
  return numericRows(value, '坐标数据', { exactly: [2, 4] });
}

function text(name, label, attributes = {}) {
  return { name, label, type: 'text', ...attributes };
}

function input(name, label, attributes = {}) {
  return { name, label, type: 'number', step: 'any', ...attributes };
}

function textarea(name, label, hint, attributes = {}) {
  return { name, label, type: 'textarea', hint, ...attributes };
}

function select(name, label, options) {
  return { name, label, type: 'select', options: options.map(([value, label]) => ({ value, label })) };
}

function checkbox(name, label) {
  return { name, label, type: 'checkbox', required: false };
}

function metric(label, value, unit) {
  return { label, value: value ?? null, ...(unit ? { unit } : {}) };
}

function table(title, headers, rows) {
  return { title, headers, rows };
}

function nonemptyUnit(value) {
  return String(value ?? '').trim().slice(0, 32);
}

function lines(rows) {
  return rows.map(row => row.join(', ')).join('\n');
}

function fittedGraph(rawPoints, fitted, options) {
  const overlay = [...fitted].sort((a, b) => a.x - b.x).map(row => [row.x, row.predicted]);
  return lab.plotToSvg(lab.plotData(rawPoints, options), { overlays: [overlay] });
}

function straightGraph(rawPoints, slope, intercept, options) {
  const bounds = rawPoints.map(point => Array.isArray(point) ? point[0] : point.x);
  const overlay = [Math.min(...bounds), Math.max(...bounds)].map(x => [x, slope * x + intercept]);
  return lab.plotToSvg(lab.plotData(rawPoints, options), { overlays: [overlay] });
}

const distributionOptions = [
  ['uniform', '均匀分布'], ['triangular', '三角分布'], ['normal', '正态分布'],
  ['arcsine', '反正弦分布'], ['trapezoid', '梯形分布'], ['reported', '校准证书'],
];

const formulaOptions = [
  ['add', '和 x + y'], ['subtract', '差 x − y'], ['multiply', '积 x × y'], ['divide', '商 x ÷ y'],
  ['powerProduct', '幂函数乘积 ∏xᵢᵖⁱ'], ['scale', '常数倍 kx'], ['sqrt', '平方根 k√x'],
  ['sin', '正弦 sin x'], ['log', '自然对数 ln x'],
];

const fitOptions = [
  ['linear', '线性 y = a + bx'], ['power', '幂函数 y = axᵇ'], ['exponential', '指数 y = aeᵇˣ'],
  ['logarithmic', '对数 y = a + b ln x'], ['inverse', '反比 y = a/x'],
  ['kinematic', '运动位移 y = v₀x + ax²/2'], ['polynomial', '多项式'],
];

const standardPoints = [[1, 2.1, 0.02, 0.12], [2, 3.3, 0.02, 0.15], [3, 4.9, 0.02, 0.1], [4, 6.1, 0.02, 0.15], [5, 7.7, 0.02, 0.12]];
const pointField = textarea('points', '坐标数据', '每行填 x、y，或 x、y、横向误差半宽、纵向误差半宽。用逗号、空格或制表符分隔。');
const axisOptions = [['linear', '直线坐标'], ['log', '常用对数坐标'], ['ln', '自然对数坐标']];
const unitField = text('unit', '单位', { required: false, placeholder: '例如 mm 或 Ω' });

const measurementTool = {
  id: 'measurement', title: '直接测量', category: group.measurement, source: '教材 §2.1、§2.3 · 表 2-3-1',
  description: '输入重复读数，算出平均值、A 类和 B 类分量，得到可写进实验报告的结果。',
  fields: [
    textarea('readings', '原始读数', '同一单位的读数可用空格、逗号或换行分隔。'), unitField,
    input('correction', '示值修正', { required: false, hint: '加到平均值上的修正。留空按 0 处理。' }),
    input('halfWidth', 'B 类误差区间半宽', { required: false, min: 0, hint: '按读数单位填写。留空表示未提供这一分量。' }),
    select('distribution', 'B 类分布', distributionOptions),
    input('sourceFactor', 'B 类包含因子', { required: false, min: 0, hint: '仅正态分布或校准证书使用。' }),
    input('beta', '梯形顶底宽比 β', { required: false, min: 0, max: 1, hint: '仅梯形分布使用，留空取 0.5。' }),
    input('confidence', '扩展置信概率（%）', { required: false, min: 0, max: 100, hint: '留空时报告合成标准不确定度。' }),
  ],
  example: { readings: cylinderReadings.map(value => value.toFixed(3)).join('\n'), unit: 'mm', correction: '', halfWidth: '0.004', distribution: 'normal', sourceFactor: '3', beta: '', confidence: '' },
  run(values) {
    const readings = numberList(values.readings, '原始读数');
    const unit = nonemptyUnit(values.unit);
    const halfWidth = number(values.halfWidth, '误差区间半宽', { optional: true, min: 0 });
    const confidence = number(values.confidence, '置信概率', { optional: true, min: 0, max: 100 });
    const correction = number(values.correction, '示值修正', { optional: true }) ?? 0;
    const source = { distribution: values.distribution ?? 'uniform', halfWidth };
    if (source.distribution === 'normal' || source.distribution === 'reported') {
      source.coverageFactor = number(values.sourceFactor, 'B 类包含因子', { optional: true, min: 0 });
    }
    if (source.distribution === 'trapezoid') {
      source.beta = number(values.beta, '梯形顶底宽比', { optional: true, min: 0, max: 1 });
    }
    const raw = lab.directMeasurement({ readings, correction, unit,
      bSources: halfWidth === undefined ? [] : [source], confidence: confidence === undefined ? undefined : confidence / 100 });
    const { statistics: stats, typeA, typeB, combined, expanded, report } = raw;
    return {
      primary: [metric('测量报告', report?.text), metric('修正后估计值', raw.value, unit), metric('合成标准不确定度 u', combined?.standardUncertainty, unit), ...(expanded ? [metric('扩展不确定度 U', expanded.expandedUncertainty, unit)] : [])],
      tables: [table('评定分量', ['项目', '数值'], [
        ['观测次数', stats.count], ['算术平均值', stats.mean], ['样本标准差', stats.sampleStandardDeviation],
        ['A 类标准不确定度', typeA?.standardUncertainty ?? null], ['B 类标准不确定度', typeB[0]?.standardUncertainty ?? null],
        ['有效自由度', combined?.effectiveDegreesOfFreedom ?? null],
      ])],
      notes: readings.length === 1 ? ['只有一项读数时无法从当前样本估计 A 类分量。'] : [], raw,
    };
  },
};

const errorTool = {
  id: 'error', title: '误差与结果修约', category: group.measurement, source: '教材 §2.1',
  description: '比较测量值和参考值，保留测量原始末位并给出不确定度报告。',
  fields: [text('value', '测量值', { hint: '保留原始末位零以确定有效数字。' }), text('reference', '参考值'),
    text('uncertainty', '标准不确定度', { required: false }), unitField,
    input('digits', '不确定度有效位数', { required: false, min: 1, max: 10, step: 1 })],
  example: { value: '4.520', reference: '4.500', uncertainty: '0.01234', digits: '2', unit: 'mm' },
  run(values) {
    const value = number(values.value, '测量值');
    const reference = number(values.reference, '参考值');
    const uncertainty = number(values.uncertainty, '标准不确定度', { optional: true, min: 0 });
    const digits = number(values.digits, '有效位数', { optional: true, min: 1, max: 10, integer: true }) ?? 2;
    const unit = nonemptyUnit(values.unit);
    const originalValue = String(values.value).trim().replaceAll('−', '-');
    const originalUncertainty = String(values.uncertainty ?? '').trim().replaceAll('−', '-');
    const error = lab.measurementError(value, reference);
    const significantDigits = lab.significantDigits(originalValue);
    const report = uncertainty === undefined ? null : lab.formatMeasurement(originalValue, originalUncertainty, { unit, digits });
    return {
      primary: [metric('绝对误差', error.absoluteError, unit), metric('带符号相对误差', error.relativeError === null ? null : error.relativeError * 100, '%'), metric('测量值有效数字', significantDigits), ...(report ? [metric('修约后报告', report.text)] : [])],
      notes: reference === 0 ? ['参考值为 0 时相对误差无定义。'] : [], raw: { error, significantDigits, report },
    };
  },
};

const propagationTool = {
  id: 'propagation', title: '不确定度传播', category: group.measurement, source: '教材 §2.1 · 表 2-1-3',
  description: '选择测量关系，计算各输入量的灵敏系数和输出的合成标准不确定度。',
  fields: [select('formula', '测量关系', formulaOptions),
    textarea('inputs', '输入量', '每行填一个输入量的数值、标准不确定度，可附自由度。三角函数输入用弧度。'),
    input('coefficient', '系数 k', { required: false, hint: '仅常数倍和平方根使用，默认 1。' }),
    text('powers', '各输入量的幂指数', { required: false, hint: '仅幂函数乘积使用，按行顺序以空格分隔。' }),
    textarea('correlation', '相关系数矩阵', '输入量独立时留空。相关时每行填写相关矩阵的一行，主对角线为 1。', { required: false }),
    unitField,
  ],
  example: { formula: 'multiply', inputs: '20.01, 0.03, 5\n12.10, 0.02, 7', coefficient: '', powers: '', correlation: '', unit: 'mm²' },
  run(values) {
    const rows = numericRows(values.inputs, '输入量', { exactly: [2, 3], rowLimit: 30 });
    const inputs = rows.map(([value, standardUncertainty, degreesOfFreedom]) => ({ value, standardUncertainty, degreesOfFreedom }));
    const correlation = String(values.correlation ?? '').trim() ? numericRows(values.correlation, '相关系数矩阵', { exactly: [inputs.length], rowLimit: 30 }) : undefined;
    const options = { correlation };
    if (values.formula === 'scale' || values.formula === 'sqrt') options.coefficient = number(values.coefficient, '系数 k', { optional: true });
    if (values.formula === 'powerProduct') options.exponents = numberList(values.powers, '幂指数');
    const raw = lab.propagateFormula(values.formula, inputs, options);
    const unit = nonemptyUnit(values.unit);
    return {
      primary: [metric('输出估计值', raw.value, unit), metric('合成标准不确定度', raw.standardUncertainty, unit), metric('有效自由度', raw.effectiveDegreesOfFreedom)],
      tables: [table('传播分量', ['输入量', '估计值', '标准不确定度', '灵敏系数', '对输出的带符号贡献'], raw.components.map((part, i) => [i + 1, part.value, part.inputStandardUncertainty, part.sensitivity, part.signedContribution]))],
      notes: ['按一阶传播计算。'], raw,
    };
  },
};

const tableTool = {
  id: 'table', title: '数据表与统计', category: group.plot, source: '教材 §2.2 · 列表法',
  description: '整理多列观测，保留原始数值的末位零，并计算每列的基本统计量。',
  fields: [text('title', '表名'), text('columns', '列名与单位', { hint: '用逗号分隔各列，用斜杠分隔名称与单位。' }),
    textarea('records', '观测记录', '每行记录一次观测。用逗号或制表符分列，缺测可留空。')],
  example: { title: '圆柱直径', columns: '直径/mm', records: cylinderReadings.map(value => value.toFixed(3)).join('\n') },
  run(values) {
    const names = String(values.columns ?? '').split(/[,，]/u).map(column => column.trim());
    if (names.length > 12 || names.some(name => !name)) throw new RangeError('请填写 1 至 12 个有效列名。');
    const columns = names.map((name, i) => {
      const [label, ...unit] = name.split('/');
      return { key: String(i), label: label.trim(), unit: unit.join('/').trim() };
    });
    const records = String(values.records ?? '').split(/\r\n?|\n/u).filter(line => line.trim() || line.includes('\t'));
    if (!records.length || records.length > 2000) throw new RangeError('请填写 1 至 2,000 行观测记录。');
    const rows = records.map((line, i) => {
      const cells = line.split(/[,，\t]/u);
      if (cells.length !== columns.length) throw new RangeError(`第 ${i + 1} 行的观测值应包含 ${columns.length} 列。`);
      return cells.map((cell, j) => {
        const value = cell.trim().replaceAll('−', '-');
        if (!value) return null;
        number(value, `第 ${i + 1} 行、第 ${j + 1} 列读数`);
        return value;
      });
    });
    const raw = lab.dataTable({ title: String(values.title ?? '').trim(), columns, rows });
    const headings = raw.columns.map(column => column.heading);
    return {
      primary: [metric('观测记录', raw.rows.length), metric('数据列', headings.length)],
      tables: [table(raw.title, ['序号', ...headings], raw.rows.map(row => [row.number, ...row.values])),
        table('分列统计', ['数据列', '有效数目', '平均值', '样本标准差', 'A 类标准不确定度'],
          raw.summaries.map((row, i) => [headings[i], row.count, row.mean, row.sampleStandardDeviation, row.typeAStandardUncertainty]))], raw,
    };
  },
};

const plotTool = {
  id: 'plot', title: '绘图与误差杆', category: group.plot, source: '教材 §2.2 · 作图法',
  description: '把原始坐标和误差半宽绘成散点图，可切换对数或极坐标。',
  fields: [pointField, text('xLabel', '横轴名称', { required: false }), text('yLabel', '纵轴名称', { required: false }),
    select('coordinates', '坐标类型', [['cartesian', '直角坐标'], ['radians', '极坐标（弧度、半径）'], ['degrees', '极坐标（角度、半径）']]),
    select('xScale', '横轴刻度', axisOptions), select('yScale', '纵轴刻度', axisOptions),
    select('errorStyle', '误差表示', [['bars', '误差杆'], ['box', '误差矩形']]), checkbox('connect', '按录入顺序连接数据点')],
  example: { points: lines(standardPoints), xLabel: 'x', yLabel: 'y', coordinates: 'cartesian', xScale: 'linear', yScale: 'linear', errorStyle: 'bars', connect: false },
  run(values) {
    const rows = points(values.points);
    const polar = values.coordinates === 'radians' || values.coordinates === 'degrees';
    const raw = lab.plotData(rows, { title: '观测数据', xLabel: values.xLabel || (polar ? '角' : 'x'),
      yLabel: values.yLabel || (polar ? '半径' : 'y'), coordinateSystem: polar ? 'polar' : 'cartesian',
      angleUnit: values.coordinates === 'degrees' ? 'deg' : 'rad', xScale: polar ? 'linear' : values.xScale,
      yScale: polar ? 'linear' : values.yScale, connect: values.connect === true });
    return { primary: [metric('观测点数', rows.length)], svg: lab.plotToSvg(raw, { errorStyle: values.errorStyle }),
      tables: [table('作图数据', [raw.xAxis.label, raw.yAxis.label, '横向误差半宽', '纵向误差半宽'], raw.points.map(point => [point.x, point.y, point.ux, point.uy]))], raw };
  },
};

const fitTool = {
  id: 'fit', title: '最小二乘拟合', category: group.plot, source: '教材 §2.2 直线最小二乘法 · §2.3 曲线拟合',
  description: '求拟合参数、标准误差、决定系数和逐行残差。观测的误差杆随散点图保留。',
  fields: [pointField, select('model', '拟合模型', fitOptions),
    input('degree', '多项式次数', { required: false, min: 0, max: 12, step: 1, hint: '仅多项式模型使用，留空取 2。' }),
    checkbox('throughOrigin', '线性模型约束过原点'), text('xLabel', '横轴名称', { required: false }),
    text('yLabel', '纵轴名称', { required: false })],
  example: { points: lines(standardPoints), model: 'linear', degree: '', throughOrigin: false, xLabel: '', yLabel: '' },
  run(values) {
    const rows = points(values.points);
    const model = values.model ?? 'linear';
    const options = {};
    if (model === 'linear') options.throughOrigin = values.throughOrigin === true;
    if (model === 'polynomial') options.degree = number(values.degree, '多项式次数', { optional: true, min: 0, max: 12, integer: true });
    const raw = lab.fitCurve(rows, model, options);
    const fit = raw.fit ?? raw;
    const parameterNames = { slope: '斜率 b', intercept: '截距 a', initialVelocity: '初速度 v₀', acceleration: '加速度 a', base: '对数底' };
    const parameters = model === 'polynomial'
      ? raw.powers.map((power, i) => [`x^${power} 系数`, raw.coefficients[i], raw.standardErrors?.[i] ?? null])
      : Object.entries(raw.parameters).map(([key, value]) => [parameterNames[key] ?? key, value, raw.parameterStandardErrors?.[key] ?? null]);
    return {
      primary: [...parameters.slice(0, 2).map(([label, value]) => metric(label, value)), metric(model === 'linear' || model === 'polynomial' ? '决定系数 R²' : '改直后的 R²', fit.rSquared)],
      svg: fittedGraph(rows, raw.fitted, { title: '数据与拟合结果', xLabel: values.xLabel || 'x', yLabel: values.yLabel || 'y' }),
      tables: [table('模型参数', ['参数', '估计值', '标准误差'], parameters),
        table('拟合残差', [values.xLabel || 'x', values.yLabel || '观测值', '预测值', '残差'], raw.fitted.map(({ x, y, predicted, residual }) => [x, y, predicted, residual]))],
      notes: ['误差杆用于作图。拟合按教材的普通最小二乘法计算。'], raw,
    };
  },
};

const differencesTool = {
  id: 'differences', title: '逐差法', category: group.plot, source: '教材 §2.2 · 逐差法',
  description: '对等间距观测点配对作差，由各对的斜率估计线性关系。',
  fields: [pointField, input('stride', '配对跨距', { required: false, min: 1, step: 1, hint: '留空时按前后两组配对，奇数点跳过中点。' }),
    text('xLabel', '横轴名称', { required: false }), text('yLabel', '纵轴名称', { required: false })],
  example: { points: lines(standardPoints), stride: '', xLabel: '', yLabel: '' },
  run(values) {
    const rows = points(values.points);
    const stride = number(values.stride, '配对跨距', { optional: true, min: 1, integer: true });
    const raw = lab.successiveDifferences(rows, { stride });
    return {
      primary: [metric('斜率', raw.slope), metric('截距', raw.intercept), metric('平均纵向差值', raw.meanDifference)],
      svg: straightGraph(rows, raw.slope, raw.intercept, { title: '逐差法估计', xLabel: values.xLabel || 'x', yLabel: values.yLabel || 'y' }),
      tables: [table('观测点配对', ['x₁', 'x₂', 'Δx', 'Δy', 'Δy / Δx'], raw.pairs.map(({ a, b, dx, dy, slope }) => [a.x, b.x, dx, dy, slope]))], raw,
    };
  },
};

const calibrationPoints = [[10, 10.15], [20, 20.22], [30, 30.31], [40, 40.27]];
const calibrationTool = {
  id: 'calibration', title: '仪器校准曲线', category: group.experiment, source: '教材 §2.2 · 校准曲线',
  description: '逐点比较被校仪和参考仪，在已校准的范围内插值得到示值修正。',
  fields: [textarea('points', '被校示值与参考示值', '每行先填被校示值，再填参考示值，可附两者误差半宽。'),
    input('reading', '待修正示值', { required: false }), unitField],
  example: { points: lines(calibrationPoints), reading: '25', unit: 'V' },
  run(values) {
    const reading = number(values.reading, '待修正示值', { optional: true });
    const unit = nonemptyUnit(values.unit);
    const raw = lab.calibrationCurve(points(values.points), { reading, title: '仪器校准曲线',
      xLabel: '被校仪示值', yLabel: '修正量', xUnit: unit, yUnit: unit });
    const { prediction } = raw;
    return {
      primary: prediction ? [metric('修正量', prediction.correction, unit), metric('修正后示值', prediction.correctedValue, unit)] : [metric('校准点数', raw.corrections.length)],
      svg: lab.plotToSvg(raw),
      tables: [table('校准观测', ['被校示值', '参考示值', '修正量', '修正误差半宽'], raw.corrections.map(point => [point.x, point.reference, point.y, point.uy]))],
      notes: prediction && !prediction.withinRange ? ['待修正读数超出校准范围。请补充校准点后再插值。'] : [], raw,
    };
  },
};

const thermometerTool = {
  id: 'thermometer', title: '温度计校准', category: group.experiment, source: '教材 §2.2 · 表 2-2-6',
  description: '拟合温度计的线性修正关系，估计指定温度的修正与标准不确定度。',
  fields: [textarea('points', '温度与修正量（℃）', '每行填写温度计示值、参考温度减去温度计示值得到的修正量。'),
    input('reference', '基准温度 t₀（℃）', { required: false, hint: '留空取教材默认值 20 ℃。' }),
    input('temperature', '待校温度（℃）', { required: false })],
  example: { points: lines(thermometerPoints), reference: '20', temperature: '30' },
  run(values) {
    const rows = numericRows(values.points, '温度与修正量', { exactly: [2] });
    const referenceTemperature = number(values.reference, '基准温度', { optional: true });
    const temperature = number(values.temperature, '待校温度', { optional: true });
    const raw = lab.thermometerCalibration(rows, { referenceTemperature, temperature });
    const { fit, prediction } = raw;
    const reference = raw.referenceTemperature;
    const primary = prediction ? [metric('修正量', prediction.correction, '℃'), metric('修正后温度', prediction.correctedTemperature, '℃'),
      metric('修正量的标准不确定度', prediction.standardUncertainty, '℃')] : [metric('校准截距', fit.intercept, '℃'), metric('校准斜率', fit.slope)];
    return {
      primary, svg: straightGraph(rows, fit.slope, fit.intercept - reference * fit.slope, { title: '温度计校准', xLabel: '温度计示值', xUnit: '℃', yLabel: '修正量', yUnit: '℃' }),
      tables: [table('校准残差', ['温度计示值 (℃)', '修正观测值 (℃)', '修正拟合值 (℃)', '残差 (℃)'],
        fit.fitted.map(row => [row.x + reference, row.y, row.predicted, row.residual]))],
      notes: prediction?.extrapolated ? ['待校温度位于校准数据范围外，当前结果采用线性外推。'] : [], raw,
    };
  },
};

const gaugeFields = [
  ['referenceLengthMm', '标准量块长度（mm）', '50.000623'], ['differenceNm', '示值平均差（nm）', '215'],
  ['referenceExpandedNm', '标准量块扩展不确定度（nm）', '75'], ['referenceCoverage', '标准量块包含因子', '3'],
  ['repeatCount', '重复测量次数', '5'], ['pooledStandardDeviationNm', '合并标准差（nm）', '13'],
  ['temperatureDifferenceC', '两量块温度差（℃）', '0'], ['benchTemperatureC', '工作台温度（℃）', '19.9'],
];
const gaugeLabels = {
  reference: '标准量块', differenceRepeat: '比较仪重复性', differenceRandom: '比较仪随机分量',
  differenceSystematic: '比较仪系统分量', expansionCoefficient: '标准量块热膨胀系数',
  benchTemperature: '工作台温度', expansionDifference: '热膨胀系数差', temperatureDifference: '两量块温度差',
};
const gaugeTool = {
  id: 'gauge-block', title: '量块校准', category: group.experiment, source: '教材 §2.2 · 表 2-2-5',
  description: '根据标准量块、比较仪读数和热膨胀分量求待校长度及不确定度。',
  fields: gaugeFields.map(([name, label, example]) => input(name, label, { required: false, placeholder: example })),
  example: Object.fromEntries(gaugeFields.map(([name, , value]) => [name, value])),
  run(values) {
    const options = Object.fromEntries(gaugeFields.map(([name, label]) => [name, number(values[name], label, { optional: true })]));
    const raw = lab.gaugeBlockCalibration(options);
    return {
      primary: [metric('待校量块长度', raw.lengthMm, 'mm'), metric('合成标准不确定度', raw.combinedStandardUncertaintyNm, 'nm'), metric('有效自由度', raw.effectiveDegreesOfFreedom)],
      tables: [table('不确定度分量', ['来源', '对长度的贡献 (nm)', '自由度'], raw.components.map(part => [gaugeLabels[part.name], part.contributionNm, part.degreesOfFreedom]))],
      notes: ['空项及其余输入采用表 2-2-5 的默认值。可在全部方法中编辑完整参数。'], raw,
    };
  },
};

const thermistorTool = {
  id: 'thermistor', title: '热敏电阻', category: group.experiment, source: '教材 §2.2 · 表 2-2-1',
  description: '用温度与电阻拟合热敏电阻模型 R = R₀ exp(B/T)。',
  fields: [textarea('points', '温度与电阻', '每行填写温度（℃）、电阻（Ω）。')],
  example: { points: lines(thermistorPoints) },
  run(values) {
    const rows = numericRows(values.points, '温度与电阻', { exactly: [2] });
    const raw = lab.thermistorAnalysis(rows);
    const transformed = raw.rows.map(row => [row.reciprocalTemperature, row.logResistance]);
    const fit = raw.regression.fit;
    return {
      primary: [metric('热敏常量 B', raw.temperatureCoefficientK, 'K'), metric('电阻系数 R₀', raw.resistanceAtInfiniteTemperatureOhm, 'Ω'), metric('改直后的 R²', fit.rSquared)],
      svg: straightGraph(transformed, fit.slope, fit.intercept, { title: '热敏电阻线性化', xLabel: '1/T', xUnit: 'K⁻¹', yLabel: 'ln(R/Ω)' }),
      tables: [table('数据变换', ['温度 (℃)', '温度 (K)', '电阻 (Ω)', '1/T (K⁻¹)', 'ln(R/Ω)'], raw.rows.map(row => [row.temperatureC, row.temperatureK, row.resistanceOhm, row.reciprocalTemperature, row.logResistance]))], raw,
    };
  },
};

const airTrackTool = {
  id: 'air-track', title: '气垫导轨', category: group.experiment, source: '教材 §2.3 · 表 2-3-2',
  description: '由挡光时间求滑块速度，再拟合直线与约束抛物线以估计加速度。',
  fields: [textarea('observations', '导轨观测', '每行开启于滑行距离（m），其后填写一次或多次挡光时间（ms）。用逗号或制表符分隔。'),
    input('flagWidth', '挡光片间距（mm）', { min: 0 })],
  example: { observations: lines(airTrackRecords.map(row => [row.distanceM, ...row.timesMs])), flagWidth: '10' },
  run(values) {
    const rows = numericRows(values.observations, '导轨观测', { minimum: 2, maximum: 30 });
    const flagWidthMm = number(values.flagWidth, '挡光片间距', { min: 0 });
    const raw = lab.airTrackAnalysis(rows.map(([distanceM, ...timesMs]) => ({ distanceM, timesMs })), { flagWidthMm });
    const graph = raw.rows.map(row => [2 * row.distanceM, row.velocitySquared]);
    return {
      primary: [metric('线性拟合加速度', raw.linearAcceleration, 'm/s²'), metric('线性拟合标准误差', raw.linearAccelerationStandardError, 'm/s²'), metric('抛物线拟合加速度', raw.quadraticAcceleration, 'm/s²')],
      svg: straightGraph(graph, raw.linear.slope, raw.linear.intercept, { title: '气垫导轨测量', xLabel: '2s', xUnit: 'm', yLabel: 'v²', yUnit: 'm²/s²' }),
      tables: [table('导轨数据处理', ['滑行距离 (m)', '平均挡光时间 (ms)', '速度 (m/s)', '速度平方 (m²/s²)'], raw.rows.map(row => [row.distanceM, row.meanTimeMs, row.velocityMps, row.velocitySquared]))], raw,
    };
  },
};

const pendulumExample = { lengths: [0.7999, 0.8, 0.8001], elapsedTimes: [35.88, 35.91, 35.89], cycles: 20, lengthStandardB: 0.0003, timeStandardB: 0.02 };
const pendulumTool = {
  id: 'pendulum', title: '单摆测重力加速度', category: group.experiment, source: '教材 §2.4 · 单摆法',
  description: '用摆长和多周期累计时间估计 g，并传播长度及时间的不确定度。',
  fields: [textarea('lengths', '摆长（m）', '从悬点到摆球中心，多次读数用换行或逗号分隔。'),
    textarea('elapsedTimes', '累计计时读数（s）', '每项读数对应相同的完整周期数。'),
    input('cycles', '每次累计周期数', { min: 1, step: 1 }),
    input('lengthStandardB', '摆长 B 类标准不确定度（m）', { required: false, min: 0 }),
    input('timeStandardB', '总计时 B 类标准不确定度（s）', { required: false, min: 0 })],
  example: { lengths: pendulumExample.lengths.join(', '), elapsedTimes: pendulumExample.elapsedTimes.join(', '), cycles: '20', lengthStandardB: '0.0003', timeStandardB: '0.02' },
  run(values) {
    const lengths = numberList(values.lengths, '摆长');
    const elapsedTimes = numberList(values.elapsedTimes, '累计计时读数');
    const cycles = number(values.cycles, '累计周期数', { min: 1, integer: true });
    const lengthStandardB = number(values.lengthStandardB, '摆长 B 类标准不确定度', { optional: true, min: 0 });
    const timeStandardB = number(values.timeStandardB, '总计时 B 类标准不确定度', { optional: true, min: 0 });
    const raw = lab.gravityFromPendulum({ lengths, elapsedTimes, cycles, lengthStandardB, timeStandardB });
    const { length, elapsed, period, uncertainty } = raw;
    return {
      primary: [metric('重力加速度 g', raw.gravity, raw.unit), metric('合成标准不确定度', uncertainty?.standardUncertainty, raw.unit), metric('单周期', period.value, 's')],
      tables: [table('输入量评定', ['量', '平均值', 'A 类', 'B 类', '合成标准不确定度'], [
        ['摆长 (m)', length.mean, length.standardA, length.standardB, length.standardUncertainty],
        ['累计时间 (s)', elapsed.mean, elapsed.standardA, elapsed.standardB, elapsed.standardUncertainty],
      ])],
      notes: ['示例为合成读数，使用小摆角模型。'], raw,
    };
  },
};

const photogateExample = [0.102, 0.132, 0.170, 0.218, 0.258, 0.299].map((elapsedTime, index) => ({
  heightDifference: Number((0.55 * elapsedTime + 4.9 * elapsedTime ** 2 + (index % 2 - 0.5) * 0.0002).toFixed(5)), elapsedTime,
}));
const photogateTool = {
  id: 'photogates', title: '双光电门测重力加速度', category: group.experiment, source: '教材 §2.4 · 双光电门法',
  description: '以门间时间为横轴、门间平均速度为纵轴拟合斜率，再换算重力加速度。',
  fields: [textarea('observations', '光电门观测', '每行写门间高度差（m）、门间经过时间（s）。至少输入三组。')],
  example: { observations: lines(photogateExample.map(row => [row.heightDifference, row.elapsedTime])) },
  run(values) {
    const rows = numericRows(values.observations, '光电门观测', { exactly: [2] });
    const raw = lab.gravityFromPhotogates(rows.map(([heightDifference, elapsedTime]) => ({ heightDifference, elapsedTime })));
    return {
      primary: [metric('重力加速度 g', raw.gravity, raw.unit), metric('拟合标准误差', raw.standardUncertainty, raw.unit), metric('上门处速度', raw.initialVelocity, 'm/s')],
      svg: straightGraph(raw.points, raw.regression.slope, raw.regression.intercept, { title: '双光电门线性拟合', xLabel: 't', xUnit: 's', yLabel: 'h/t', yUnit: 'm/s' }),
      tables: [table('门间观测', ['高度差 (m)', '经过时间 (s)', '平均速度 (m/s)'], raw.observations.map(row => [row.heightDifference, row.elapsedTime, row.averageVelocity]))],
      notes: ['示例为合成读数。测量时请记录两门之间的时间差。'], raw,
    };
  },
};

export const defaultToolId = 'measurement';
export const tools = [measurementTool, errorTool, propagationTool, tableTool, plotTool, fitTool, differencesTool, calibrationTool,
  thermometerTool, gaugeTool, thermistorTool, airTrackTool, pendulumTool, photogateTool];

const propagationInputs = [
  { value: 20.01, standardUncertainty: 0.03, degreesOfFreedom: 5 },
  { value: 12.10, standardUncertainty: 0.02, degreesOfFreedom: 7 },
];
const uncertaintyComponents = [{ standardUncertainty: 0.02, degreesOfFreedom: 5 }, { standardUncertainty: 0.01 }];
const directArguments = { readings: cylinderReadings, unit: 'mm', bSources: [{ halfWidth: 0.004, distribution: 'normal', coverageFactor: 3 }] };
const motion = [{ time: 0, x: 0 }, { time: 0.1, x: 0.123 }, { time: 0.2, x: 0.271 }];
const pendulumTrace = [{ time: 0, angleRad: -0.1 }, { time: 0.5, angleRad: 0.1 }, { time: 1, angleRad: -0.1 }, { time: 1.5, angleRad: 0.1 }];
const lengthsAndTemperatures = [[20, 500], [40, 500.2], [60, 500.42], [80, 500.61]];

const methodRows = [
  ['rankCorrections', '数量级与修正排序', [[{ name: '第一项修正', relative: 0.001 }, { name: '第二项修正', relative: -0.0003 }], 0.002]],
  ['dimensionalAnalysis', '量纲分析', [{ T: 1 }, [{ name: 'l', dimensions: { L: 1 } }, { name: 'g', dimensions: { L: 1, T: -2 } }]]],
  ['compareWithStandard', '标准量比较', [1.02, 1.4]],
  ['potentiometerEmf', '补偿法测电动势', [1.018, 5, 4]],
  ['solveLinearBalance', '线性平衡', [[{ coefficient: 1, value: 1.02 }], 2, 3]],
  ['accumulatedReading', '累积放大', [37.2, 20, { errorLimit: 0.1, standardUncertainty: 0.03 }]],
  ['vernierResolution', '游标分度', [1, 50]],
  ['screwAmplification', '螺旋放大', [15, 0.5]],
  ['opticalLever', '光杠杆', [0.002, 1, 0.05]],
  ['signalGain', '信号增益与信噪比', [0.2, 10, { signalPower: 7, noisePower: 0.3 }]],
  ['buoyancyDensity', '浮力称衡', [78.4, 68.4, 1]],
  ['affineConversion', '线性标定换算', [25, 1.8, { offset: 32 }]],
  ['fringeDisplacement', '干涉条纹位移', [5, 6.328e-7, 2]],
  ['singleSlitWidth', '单缝衍射宽度', [1, 6.328e-7, 0.003]],
  ['measurementError', '实验误差', [4.52, 4.5]],
  ['instrumentError', '仪器允许误差', [{ kind: 'digital', reading: 4.52, readingPercent: 0.2, digits: 2, resolution: 0.01 }]],
  ['significantDigits', '识别有效数字', ['4.5200']],
  ['roundToPlace', '按指定数位修约', ['2.345', -2]],
  ['roundSignificant', '按有效数字修约', ['2.345', 3]],
  ['formatMeasurement', '格式化测量报告', ['4.520', '0.01234', { digits: 2, unit: 'mm' }]],
  ['sampleStatistics', '样本统计', [cylinderReadings]],
  ['pooledStandardDeviation', '合并历史标准差', [[[10.51, 10.48, 10.54], [10.49, 10.50, 10.48]]]],
  ['typeA', 'A 类评定', [cylinderReadings]],
  ['typeB', 'B 类评定', [{ halfWidth: 0.004, distribution: 'normal', coverageFactor: 3 }]],
  ['distributionDensity', '分布概率密度', [0.25, { distribution: 'triangular', halfWidth: 1 }]],
  ['distributionCoverage', '分布覆盖概率', [0.25, { distribution: 'uniform', halfWidth: 1 }]],
  ['sampleCovariance', '样本协方差', [[1, 2, 3], [3.2, 5.1, 6.8]]],
  ['propagateFormula', '常用关系的不确定度传播', ['multiply', propagationInputs]],
  ['propagateUncertainty', '自定义线性模型传播', [{ coefficients: [2, -1], constant: 0 }, propagationInputs]],
  ['combineUncertainties', '标准不确定度合成', [uncertaintyComponents]],
  ['effectiveDegreesOfFreedom', '有效自由度', [uncertaintyComponents]],
  ['coverageFactor', '计算包含因子', [0.95, 6]],
  ['expandUncertainty', '计算扩展不确定度', [0.02, { confidence: 0.95, degreesOfFreedom: 6 }]],
  ['checkThreeSigma', '3σ 核查', [4.52, 4.49, 0.008]],
  ['dataTable', '组织数据表', [{ title: '圆柱直径', columns: [{ key: 'd', label: '直径', unit: 'mm' }], rows: cylinderReadings.map(value => [value.toFixed(3)]) }]],
  ['plotData', '坐标与误差杆计算', [standardPoints, { title: '观测数据' }]],
  ['plotToSvg', '绘制 SVG 图', [lab.plotData(standardPoints, { title: '观测数据' })]],
  ['calibrationCurve', '校准曲线', [calibrationPoints, { reading: 25 }]],
  ['graphicalOutliers', '由拟合残差核查可疑点', [standardPoints, null, { multiplier: 3 }]],
  ['lineFromPoints', '两点作图法', [[1, 2.1], [4, 6.1], { points: standardPoints }]],
  ['linearRegression', '线性回归', [standardPoints]],
  ['linearize', '非线性曲线改直', [[[1, 2], [2, 8], [3, 18]], 'power']],
  ['fitCurve', '曲线拟合', [standardPoints, 'polynomial', { degree: 2 }]],
  ['successiveDifferences', '逐差计算', [standardPoints]],
  ['thermistorAnalysis', '热敏电阻分析', [thermistorPoints]],
  ['gaugeBlockCalibration', '量块校准', [Object.fromEntries(gaugeFields.map(([name, , value]) => [name, Number(value)]))]],
  ['thermometerCalibration', '温度计校准', [thermometerPoints, { temperature: 30 }]],
  ['thermalExpansionFit', '金属丝线膨胀', [lengthsAndTemperatures]],
  ['physicalPendulumFit', '物理摆参数', [[[0.10, 1.60], [0.20, 1.55], [0.30, 1.57]], { rodMass: 0.11, coefficient: 0.96 }]],
  ['directMeasurement', '直接测量综合评定', [directArguments]],
  ['airTrackAnalysis', '气垫导轨分析', [airTrackRecords]],
  ['motionFromPositions', '位置记录的速度', [motion]],
  ['pendulumCorrection', '单摆周期修正', [{ length: 0.8, diameter: 0.02, stringMass: 0.0001, bobMass: 0.033, airDensity: 1.3, bobDensity: 7800, angleRad: 0.08 }]],
  ['gravityFromPendulum', '单摆测重力加速度', [pendulumExample]],
  ['gravityFromRestDrop', '自由落体测重力加速度', [0.8, 0.404]],
  ['gravityFromPhotogates', '双光电门测重力加速度', [photogateExample]],
  ['gravityReferenceTerms', '球形地球引力近似', [{ radius: 6371000, altitude: 0, latitudeRad: 0.54, angularSpeed: 0.00007292, gravitationalParameter: 3.986e14 }]],
  ['uncertaintyBudget', '设计不确定度预算', [{ targetAbsolute: 0.005, coverageFactor: 3, terms: [{ name: '直径', sensitivity: 0.25, standardUncertainty: 0.0013 }, { name: '高度', sensitivity: 1 / 32 }] }]],
  ['planPendulumTiming', '规划单摆周期数', [{ length: 0.8, period: 1.8, lengthStandardUncertainty: 0.0003, timeStandardUncertainty: 0.02, targetRelative: 0.002 }]],
  ['finiteAmplitudePeriod', '大摆角周期', [0.8, 9.8, 0.5]],
  ['pendulumPeriodsFromTrace', '摆角轨迹提取周期', [pendulumTrace]],
  ['fitPendulumPeriods', '大摆角数据拟合', [0.8, [{ angleRad: 0.1, period: 1.80 }, { angleRad: 0.3, period: 1.81 }, { angleRad: 0.5, period: 1.82 }]]],
  ['gravityFromConicalPendulum', '圆锥摆测重力加速度', [0.8, 0.1, 1.791]],
  ['vernierReading', '游标卡尺读数', [{ mainReading: 12, alignedDivision: 16, zeroError: 0.02 }]],
  ['screwScaleReading', '螺旋测微器与显微镜读数', [{ mainReading: 2.5, drumReading: 23.4, zeroError: 0.003 }]],
  ['readingDifference', '两读数之差', [2.29, 2.74]],
  ['intervalFromClock', '钟表时间换算', [{ minutes: 1, seconds: 35, milliseconds: 70 }]],
];

const methodById = new Map(methodRows.map(([id, title]) => [id, title]));
const advancedNotes = {
  propagateUncertainty: '第一个参数用 coefficients 和 constant 定义线性关系。非线性常用关系可选“常用关系的不确定度传播”。',
  graphicalOutliers: '第二个参数用 null 可逐点留一拟合，也可提供 {slope, intercept} 作为已知直线。',
};

export const advancedMethods = methodRows.map(([id, title, args]) => ({ id, title,
  example: JSON.stringify(args, null, 2), hint: advancedNotes[id] }));

function readArguments(source) {
  const input = String(source ?? '');
  if (input.length > 100000) throw new RangeError('参数 JSON 最多接受 100,000 个字符。');
  let args;
  try {
    args = JSON.parse(input);
  } catch {
    throw new TypeError('参数需要有效的 JSON。字符串和对象属性名使用双引号。');
  }
  if (!Array.isArray(args)) throw new TypeError('请使用 JSON 数组，按顺序放入方法的各项参数。');
  if (args.length > 10) throw new RangeError('参数数组最多接受十项。');
  return args;
}

function fromLinearModel({ coefficients, constant = 0 } = {}, inputs, { correlation } = {}) {
  if (!Array.isArray(coefficients) || !inputs || coefficients.length !== inputs.length ||
    !coefficients.length || !coefficients.every(Number.isFinite) || !Number.isFinite(constant)) {
    throw new TypeError('请为每个输入量提供一个有限线性系数，常数项也须为有限数字。');
  }
  return lab.propagateUncertainty(
    values => values.reduce((sum, value, i) => sum + coefficients[i] * value, constant),
    inputs, { gradient: () => coefficients, correlation },
  );
}

function fromGraphicalOutliers(samples, model = null, options) {
  if (!Array.isArray(samples) || samples.length > 500) throw new RangeError('残差核查需要数据点数组，最多接受 500 个点。');
  if (model === null) return lab.graphicalOutliers(samples, undefined, options);
  const { slope, intercept } = model;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) throw new TypeError('已知直线需要有限的 slope 和 intercept。');
  return lab.graphicalOutliers(samples, x => slope * x + intercept, options);
}

export function runAdvancedTool(id, jsonText) {
  if (!methodById.has(id)) throw new RangeError('请选择一种数据处理方法。');
  const args = readArguments(jsonText);
  const run = id === 'propagateUncertainty' ? fromLinearModel : id === 'graphicalOutliers' ? fromGraphicalOutliers : lab[id];
  const raw = run(...args);
  const scalar = raw === null || ['string', 'boolean', 'number'].includes(typeof raw);
  return { primary: scalar && id !== 'plotToSvg' ? [metric('结果', raw)] : [],
    ...(id === 'plotToSvg' ? { svg: raw } : {}), raw };
}
