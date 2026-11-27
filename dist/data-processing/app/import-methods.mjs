import { successiveDifferences } from '../index.mjs';

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;
const explicitUnit = /(?:\(([^()]+)\)|\[([^\[\]]+)\]|（([^（）]+)）)\s*$/u;

const units = {
  m: ['length', 1], cm: ['length', 0.01], mm: ['length', 0.001], 'μm': ['length', 1e-6],
  km: ['length', 1000], 米: ['length', 1], 厘米: ['length', 0.01], 毫米: ['length', 0.001], 微米: ['length', 1e-6],
  s: ['time', 1], ms: ['time', 0.001], 'μs': ['time', 1e-6], ns: ['time', 1e-9], min: ['time', 60],
  秒: ['time', 1], 毫秒: ['time', 0.001], 微秒: ['time', 1e-6], 分钟: ['time', 60],
  '℃': ['temperature', 1], '°C': ['temperature', 1], K: ['temperature', 1, -273.15],
  '°F': ['temperature', 5 / 9, -160 / 9], 摄氏度: ['temperature', 1], 开尔文: ['temperature', 1, -273.15],
  'Ω': ['resistance', 1], 'mΩ': ['resistance', 0.001], 'kΩ': ['resistance', 1000], 'MΩ': ['resistance', 1e6],
  ohm: ['resistance', 1], 欧姆: ['resistance', 1], 千欧: ['resistance', 1000], 千欧姆: ['resistance', 1000], 兆欧: ['resistance', 1e6],
};

function unitInfo(unit) {
  const canonical = String(unit ?? '').normalize('NFKC').replace(/\s+/gu, '');
  const aliases = { um: 'μm', us: 'μs', degC: '°C', degF: '°F', Ohm: 'ohm', kOhm: 'kΩ', kohm: 'kΩ', MOhm: 'MΩ', mOhm: 'mΩ' };
  const name = Object.hasOwn(aliases, canonical) ? aliases[canonical] : canonical;
  return Object.hasOwn(units, name) ? units[name] : null;
}

function parsedColumn(column, index) {
  const key = column?.key;
  if (typeof key !== 'string' || !key.trim()) throw new TypeError(`第 ${index + 1} 列缺少有效的列标识。`);
  const label = typeof column.label === 'string' && column.label.trim() ? column.label.trim() : key;
  if (column.unit != null && typeof column.unit !== 'string') throw new TypeError(`“${label}”列的单位须是文本。`);
  const bracket = label.match(explicitUnit);
  const suffix = bracket ? bracket[1] ?? bracket[2] ?? bracket[3] : label.split('/').at(-1);
  const labelUnit = (bracket || label.includes('/')) && unitInfo(suffix) ? suffix : '';
  const keySuffix = key.match(/(?:_|-)(cm|mm|µm|μm|um|ms|us|ns|s|m|[kM]?ohm|degC|degF|°C|℃|K)$/u)?.[1]
    ?? key.match(/(?<=[a-z])(Cm|Mm|Ms|Us|Ns|DegC|DegF|KOhm|MOhm|Ohm)$/u)?.[1]
    ?? key.match(/(?:(?:[Hh]eight|[Dd]istance|[Ll]ength|[Pp]osition|[Dd]isplacement)(M)|(?:[Tt]ime|[Dd]uration|[Pp]eriod)(S)|(?:[Tt]emperature|[Tt]emp)(K))$/u)?.slice(1).find(Boolean);
  const keyUnits = { Cm: 'cm', Mm: 'mm', Ms: 'ms', Us: 'us', Ns: 'ns', M: 'm', S: 's',
    DegC: 'degC', DegF: 'degF', KOhm: 'kΩ', MOhm: 'MΩ', kohm: 'kΩ', Mohm: 'MΩ' };
  const keyUnit = keySuffix ? keyUnits[keySuffix] ?? keySuffix : '';
  const declared = column.unit?.trim() ?? '';
  const unit = declared || labelUnit || (unitInfo(keyUnit) ? keyUnit : '');
  const info = unitInfo(unit);
  const other = unitInfo(labelUnit);
  const conflict = Boolean(declared && other && (!info || info[0] !== other[0] || info[1] !== other[1] || info[2] !== other[2]));
  if (conflict) throw new TypeError(`“${label}”列的表头单位与记录单位“${declared}”冲突。`);
  return { key, label, unit, info, index, labelHasUnit: Boolean(labelUnit) };
}

function context(dataset, rowIndices) {
  if (!Array.isArray(dataset?.columns) || !dataset.columns.length || !Array.isArray(dataset.rows)) {
    throw new TypeError('数据集需要列定义和观测记录。');
  }
  const columns = dataset.columns.map(parsedColumn);
  if (new Set(columns.map(column => column.key)).size !== columns.length) throw new TypeError('数据集存在重复的列标识。');
  const indices = rowIndices === undefined ? dataset.rows.map((_, index) => index) : rowIndices;
  if (!Array.isArray(indices)) throw new TypeError('行选择须以索引数组提供。');
  if (!indices.length) throw new RangeError('请至少选择一条观测记录。');
  if (new Set(indices).size !== indices.length) throw new RangeError('同一条观测记录只可选一次。');
  const rows = indices.map(index => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= dataset.rows.length) throw new RangeError('所选观测索引越界。');
    const cells = dataset.rows[index];
    if (!Array.isArray(cells) || cells.length !== columns.length) throw new TypeError(`第 ${index + 1} 条观测与列定义不一致。`);
    for (const [j, value] of cells.entries()) {
      if (value !== null && typeof value !== 'string' && !Number.isFinite(value)) {
        throw new TypeError(`第 ${index + 1} 条观测的“${columns[j].label}”须是有限数值、文本或空值。`);
      }
    }
    return { index, cells };
  });
  return { dataset, columns, rows };
}

function numericText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const str = String(value).trim().replaceAll('−', '-');
  if (!decimal.test(str) || !Number.isFinite(Number(str))) return null;
  if (Number(str) === 0 && /[1-9]/u.test(str.split(/e/iu)[0])) return null;
  return str;
}

function cell(row, column) {
  const str = numericText(row.cells[column.index]);
  if (str === null) throw new TypeError(`第 ${row.index + 1} 条观测的“${column.label}”须有有效数值。请补齐记录或调整所选行。`);
  return str;
}

function hasNumber(rows, column) {
  return rows.some(row => numericText(row.cells[column.index]) !== null);
}

function nameOf(column) {
  return column.unit && !column.labelHasUnit ? `${column.label} (${column.unit})` : column.label;
}

function scientificName(column) {
  return `${column.key}\n${column.label}`.normalize('NFKC');
}

function convert(row, column, target, { delta = false } = {}) {
  const str = cell(row, column);
  const output = unitInfo(target);
  const source = column.info;
  if (!source || !output || source[0] !== output[0]) throw new TypeError(`“${column.label}”需要可换算至 ${target} 的已知单位。`);
  if (source[1] === output[1] && (delta || (source[2] ?? 0) === (output[2] ?? 0))) return str;
  const factor = source[1] / output[1];
  const offset = delta ? 0 : ((source[2] ?? 0) - (output[2] ?? 0)) / output[1];
  const exponent = Math.log10(factor);
  const [coefficient, sourceExponent = '0'] = str.split(/e/iu);
  const value = offset === 0 && Number.isInteger(exponent)
    ? Number(`${coefficient}e${Number(sourceExponent) + exponent}`)
    : Number(str) * factor + offset;
  if (!Number.isFinite(value)) throw new RangeError(`第 ${row.index + 1} 条观测的单位换算超出数值范围。`);
  return String(value);
}

function compatible(error, axis) {
  return error.unit === axis.unit || Boolean(error.info && axis.info && error.info[0] === axis.info[0]);
}

function field(name, label, columns, required = true) {
  return { name, label, required, options: columns.map(({ key, label, unit }) => ({ key, label, unit })) };
}

function method(id, title, description, fields, mapping, notes = []) {
  return { id, title, description, fields, mapping, notes };
}

const rowId = /(?:^(?:id|index|number|row|trial|serial)$|序号|录入时间|记录编号)/imu;
const inputAxis = /(?:^(?:x|t|time|temperature|distance|twiceDistance|voltage|current|radius|position|height|angle)$|自变量|门间时间|温度|距离|位置|角度)/imu;
const errorName = /(?:^(?:u[xyr]?|uncertainty|standardUncertainty|standardDeviation|err(?:or)?[xy]?)$|不确定度|标准差|误差半宽|误差限)/imu;
const xErrorName = /(?:^ux$|^x(?:Error|Uncertainty|Std)$|^u\(x\)$|横向|横轴)/imu;
const yErrorName = /(?:^uy$|^y(?:Error|Uncertainty|Std)$|^u\(y\)$|纵向|纵轴)/imu;

function equalSpacing(rows, column) {
  if (rows.length < 3) return false;
  try {
    successiveDifferences(rows.map(row => [Number(cell(row, column)), 0]));
    return true;
  } catch {
    return false;
  }
}

function numericTable(ctx) {
  const { columns, rows } = ctx;
  return columns.length <= 12 && columns.every(column => !/[,，/\t\r\n]/u.test(column.label) && !/[,，\t\r\n]/u.test(column.unit)) &&
    rows.every(row => (columns.length > 1 || numericText(row.cells[0]) !== null) && row.cells.every(value => value == null || value === '' || numericText(value) !== null));
}

function generalMethods(ctx, numericColumns) {
  const { rows } = ctx;
  const mainColumns = numericColumns.filter(column => !rowId.test(scientificName(column)) && !errorName.test(scientificName(column)));
  const sensible = [...mainColumns, ...numericColumns.filter(column => !mainColumns.includes(column))];
  const tableId = numericTable(ctx) ? 'table' : 'advanced';
  const options = [method(tableId, '数据表与统计', '保留已选择的行和原有列。', [], {},
    tableId === 'advanced' ? ['使用全部方法的数据表模式保留文字和缺测。'] : [])];
  if (sensible.length) {
    const direct = method('measurement', '直接测量', '选择一列重复读数，计算均值和 A 类不确定度。',
      [field('value', '测量值', numericColumns)], { value: sensible[0].key });
    if (mainColumns.length === 1) options.unshift(direct);
    else options.push(direct);
  }
  if (sensible.length < 2) return options;
  const varying = sensible.filter(column => {
    const values = rows.map(row => numericText(row.cells[column.index])).filter(value => value !== null);
    return new Set(values.map(Number)).size > 1;
  });
  const x = varying.find(column => inputAxis.test(scientificName(column))) ?? varying[0] ?? sensible[0];
  const y = sensible.find(column => column !== x);
  const catchErrorColumn = (predicate, axis) => numericColumns.find(column => column !== x && column !== y &&
    predicate.test(scientificName(column)) && compatible(column, axis))?.key;
  const fields = [field('x', '横坐标 x', numericColumns), field('y', '纵坐标 y', numericColumns),
    field('ux', '横向误差半宽', numericColumns, false), field('uy', '纵向误差半宽', numericColumns, false)];
  const mapping = { x: x.key, y: y.key, ux: catchErrorColumn(xErrorName, x) ?? '', uy: catchErrorColumn(yErrorName, y) ?? '' };
  const errorNotes = ['误差列可留空。只选一个方向时，另一个方向不画误差杆。'];
  options.push(method('plot', '绘图与误差杆', '选择两列配对数据，可附误差半宽。', fields, mapping, errorNotes));
  if (varying.length) {
    const fit = method('fit', '最小二乘拟合', '选择两列配对数据并拟合关系。可在表单中切换拟合模型。', fields, mapping, errorNotes);
    if (/^acceleration-/u.test(ctx.dataset.id ?? '')) options.unshift(fit);
    else options.push(fit);
  }
  const equal = sensible.filter(column => equalSpacing(rows, column));
  if (equal.length) {
    const independent = equal.includes(x) ? x : equal[0];
    options.push(method('differences', '逐差法', '选中的观测含可用的等间距自变量列。',
      [field('x', '等间距横坐标 x', equal), field('y', '纵坐标 y', numericColumns)],
      { x: independent.key, y: sensible.find(column => column !== independent).key }));
  }
  return options;
}

const temperature = /(?:temperature|^(?:temp|tempC|tC)$|温度)/imu;
const temperatureCorrection = /(?:correction|offset|修正)/iu;
const referenceTemperature = /(?:reference|standard|refTemp|标准温度|参考温度|标准示值)/iu;
const resistance = /(?:resistance|^R(?:Ohm)?$|\bntc\b|电阻|阻值)/imu;
const gateDistance = /(?:heightDifference|gateDistance|gateHeight|heightGap|deltaH|门间.{0,4}(?:距离|高度)|高度差|光电门间距)/iu;
const gateTime = /(?:elapsedTime|gateTime|flightTime|timeDifference|deltaT|门间.{0,4}时间|飞行时间|经过时间|时间差|时差)/iu;

function specialMethods(ctx, columns) {
  const signature = String(ctx.dataset.kind ?? '') + ' ' + String(ctx.dataset.label ?? '');
  const identify = (family, expression, qualifier) => columns.filter(column => {
    const name = scientificName(column);
    return column.info?.[0] === family && expression.test(name) && (!qualifier || qualifier(name));
  });
  const forPhotogates = /(?:dual.?photogate|free.?fall|双光电门|自由落体)/iu.test(signature);
  const distance = identify('length', forPhotogates ? /(?:height|distance|^h$|高度|距离)/imu : gateDistance);
  const time = identify('time', forPhotogates ? /(?:time|^t$|时间)/imu : gateTime);
  const temperatures = identify('temperature', temperature, name => !temperatureCorrection.test(name) && !referenceTemperature.test(name));
  const corrections = identify('temperature', temperatureCorrection);
  const references = identify('temperature', referenceTemperature);
  const resistances = identify('resistance', resistance, name => !errorName.test(name) && !/\bptc\b|正温度系数/iu.test(name));
  const options = [];
  const size = ctx.rows.length;
  if (size >= 3 && distance.length && time.length) {
    options.push(method('photogates', '双光电门测重力加速度', '用两门高度差和门间经过时间拟合重力加速度。',
      [field('distance', '两门高度差', distance), field('time', '门间经过时间', time)],
      { distance: distance[0].key, time: time[0].key }, ['写入计算表单时将距离换算为 m，时间换算为 s。']));
  }
  if (size >= 3 && temperatures.length && (corrections.length || references.length)) {
    options.push(method('thermometer', '温度计校准', '使用待校温度计示值与已知修正量，或从参考示值计算修正。',
      [field('temperature', '待校温度计示值', temperatures), field('correction', '已知修正量', corrections, false), field('reference', '参考温度计示值', references, false)],
      { temperature: temperatures[0].key, correction: corrections[0]?.key ?? '', reference: corrections.length ? '' : references[0].key },
      ['写入计算表单时将温度换算为 ℃。计算修正量时用参考示值减待校示值。']));
  }
  if (size >= 2 && temperatures.length && resistances.length && /热敏|\bntc\b|thermistor/iu.test(signature + ' ' + resistances.map(scientificName).join(' '))) {
    options.push(method('thermistor', '热敏电阻', '对热敏电阻的温度与电阻关系估计 B 和 R₀。',
      [field('temperature', '观测温度', temperatures), field('resistance', '热敏电阻阻值', resistances)],
      { temperature: temperatures[0].key, resistance: resistances[0].key }, ['写入计算表单时将温度换算为 ℃，阻值换算为 Ω。']));
  }
  return options;
}

function list(ctx) {
  const numericColumns = ctx.columns.filter(column => hasNumber(ctx.rows, column));
  return [...specialMethods(ctx, numericColumns), ...generalMethods(ctx, numericColumns)];
}

export function importedMethods(dataset, rowIndices) {
  return list(context(dataset, rowIndices));
}

function selectedColumns(ctx, config, mapping) {
  const merged = { ...config.mapping, ...mapping };
  if (!Object.hasOwn(mapping, 'ux') && Object.hasOwn(mapping, 'x') && mapping.x !== config.mapping.x) merged.ux = '';
  if (!Object.hasOwn(mapping, 'uy') && Object.hasOwn(mapping, 'y') && mapping.y !== config.mapping.y) merged.uy = '';
  const chosen = {};
  for (const spec of config.fields) {
    const key = merged[spec.name];
    if (!key && !spec.required) continue;
    if (!spec.options.some(column => column.key === key)) throw new RangeError(`请为“${spec.label}”选择合适的数据列。`);
    chosen[spec.name] = ctx.columns.find(column => column.key === key);
  }
  const keys = Object.values(chosen).map(column => column.key);
  if (new Set(keys).size !== keys.length) throw new RangeError('每个输入量须选择不同的数据列。');
  return chosen;
}

function tableValues(ctx, id) {
  const title = String(ctx.dataset.label ?? ctx.dataset.id ?? '').trim() || '实验观测';
  if (ctx.rows.length > 2000) throw new RangeError('单次数据表最多处理 2,000 条观测。请缩小所选范围。');
  if (id === 'advanced') {
    const columns = ctx.columns.map(({ key, label, unit, labelHasUnit }) => ({ key, label, unit: labelHasUnit ? '' : unit }));
    const rows = ctx.rows.map(row => row.cells);
    const args = JSON.stringify([{ title, columns, rows }], null, 2);
    if (args.length > 100000) throw new RangeError('所选记录超出单次高级列表容量。请缩小所选范围。');
    return { method: 'dataTable', args };
  }
  return { title, columns: ctx.columns.map(({ label, unit, labelHasUnit }) => `${label}${unit && !labelHasUnit ? '/' + unit : ''}`).join(', '),
    records: ctx.rows.map(row => row.cells.map(value => numericText(value) ?? '').join('\t')).join('\n') };
}

function axisError(row, error, axis) {
  if (!error) return '0';
  if (!compatible(error, axis)) throw new TypeError(`“${error.label}”与“${axis.label}”的单位不一致。`);
  const value = error.unit === axis.unit ? cell(row, error) : convert(row, error, axis.unit, { delta: true });
  if (Number(value) < 0) throw new RangeError(`第 ${row.index + 1} 条观测的“${error.label}”须为非负值。`);
  return value;
}

function pairValues(ctx, id, { x, y, ux, uy }) {
  if (ctx.rows.length > 2000) throw new RangeError('单次作图或拟合最多处理 2,000 条观测。请缩小所选范围。');
  const pairs = ctx.rows.map(row => {
    const pair = [cell(row, x), cell(row, y)];
    if (ux || uy) pair.push(axisError(row, ux, x), axisError(row, uy, y));
    return pair;
  });
  const points = pairs.map(pair => pair.join(', ')).join('\n');
  const labels = { xLabel: nameOf(x), yLabel: nameOf(y) };
  if (id === 'plot') return { points, ...labels, coordinates: 'cartesian', xScale: 'linear', yScale: 'linear', errorStyle: 'bars', connect: false };
  if (id === 'differences') return { points, ...labels, stride: '' };
  if (new Set(pairs.map(pair => Number(pair[0]))).size < 2) throw new RangeError('横坐标至少需要两个不同的值。');
  return { points, ...labels, model: 'linear', degree: '', throughOrigin: false };
}

function specializedValues(ctx, id, selections) {
  if (ctx.rows.length > 2000) throw new RangeError('单次计算最多处理 2,000 条观测。请缩小所选范围。');
  if (id === 'photogates') {
    const observations = ctx.rows.map(row => [convert(row, selections.distance, 'm'), convert(row, selections.time, 's')].join(', '));
    return { observations: observations.join('\n') };
  }
  if (id === 'thermistor') {
    const points = ctx.rows.map(row => [convert(row, selections.temperature, '℃'), convert(row, selections.resistance, 'Ω')].join(', '));
    return { points: points.join('\n') };
  }
  const { temperature, correction, reference } = selections;
  if (Boolean(correction) === Boolean(reference)) throw new RangeError('请选择已知修正量或参考温度示值中的一列。');
  const points = ctx.rows.map(row => {
    const observed = convert(row, temperature, '℃');
    const adjustment = correction ? convert(row, correction, '℃', { delta: true }) :
      Number(convert(row, reference, '℃')) - Number(observed);
    return `${observed}, ${adjustment}`;
  });
  return { points: points.join('\n'), reference: '', temperature: '' };
}

export function applyImportedMethod(dataset, rowIndices, id, mapping = {}) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new TypeError('列映射须是对象。');
  const ctx = context(dataset, rowIndices);
  const config = list(ctx).find(candidate => candidate.id === id);
  if (!config) throw new RangeError('所选数据暂不适用于这一方法。');
  const selections = selectedColumns(ctx, config, mapping);
  if (id === 'table' || id === 'advanced') return tableValues(ctx, id);
  if (id === 'measurement') {
    if (ctx.rows.length > 5000) throw new RangeError('单次直接测量最多处理 5,000 条观测。请缩小所选范围。');
    const readings = ctx.rows.map(row => cell(row, selections.value)).join('\n');
    return { readings, unit: selections.value.unit, correction: '', halfWidth: '', distribution: 'uniform',
      sourceFactor: '', beta: '', confidence: '' };
  }
  if (id === 'plot' || id === 'fit' || id === 'differences') return pairValues(ctx, id, selections);
  return specializedValues(ctx, id, selections);
}
