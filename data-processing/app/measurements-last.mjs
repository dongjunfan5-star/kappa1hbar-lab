import { readNested } from './measurements-nested.mjs';

const column = (key, label, unit = '') => ({ key, label, unit });
const temperature = column('temperature', '示值温度', '℃');
const reference = column('referenceTemperature', '参考温度', '℃');
const voltage = column('voltage', '电压', 'V');
const current = column('current', '电流', 'mA');
const resistance = column('resistance', '负载电阻', 'Ω');
const frequency = column('frequency', '频率', 'Hz');
const wavelength = column('wavelength', '波长', 'nm');
const period = column('period', '周期', 's');
const distance = column('distance', '距离', 'mm');
const angle = column('angle', '角度', '°');
const phase = column('phase', '相位差', 'rad');
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function reading(value, suffix = '') {
  let text = String(value ?? '').trim().replace(/−/g, '-').replace(/＋/g, '+');
  if (suffix && text.endsWith(suffix)) text = text.slice(0, -suffix.length).trim();
  return decimal.test(text) && Number.isFinite(Number(text)) ? text : null;
}

function tableRows(doc, attribute, width) {
  const body = doc?.querySelector('.rig-host tbody[' + attribute + ']');
  if (!body) return [];
  return Array.from(body.rows).flatMap(row => {
    const cells = Array.from(row.cells);
    return cells.length === width && cells.every(cell => cell.colSpan === 1)
      ? [cells.map(cell => cell.textContent.trim())] : [];
  });
}

function record(id, label, columns, rows, kind) {
  return { id, label, columns, rows, ...(kind ? { kind } : {}) };
}

function selectedOption(doc, attribute) {
  const input = doc.querySelector('.rig-host [' + attribute + ']');
  return { key: input?.value ?? '', label: input?.selectedOptions?.[0]?.textContent.trim() ?? '' };
}

function groupBy(rows, select, id, label, columns, map) {
  const groups = new Map();
  for (const row of rows) {
    const key = select(row);
    const values = map(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(values);
  }
  return Array.from(groups, ([key, items]) => record(id + '-' + encodeURIComponent(key), label + ' · ' + key, columns, items));
}

const magnet = {
  earth: [current, column('time5', '5 周期用时', 's'), period, column('inversePeriodSquared', '1/T²', 's⁻²'), column('assessment', '计入拟合')],
  field: [current, column('position', '探头位置', 'cm'), column('field', '磁场读数', 'mT'), column('netField', '扣底磁场', 'mT')],
  inertia: [column('weight', '配重'), column('time5', '5 周期用时', 's'), period],
  coupled: [column('spacing', '针距', 'cm'), column('condition', '初态'), column('sameRate', '同相角频率', 'rad/s'), column('oppositeRate', '反相角频率', 'rad/s'), column('beat', '拍频', 'Hz')],
  angle: [angle, column('damping', '阻尼比'), period, column('behavior', '摆动特征')],
};

const lightSpeed = [column('position', '反射镜位置 x', 'm'), column('opticalLength', '光程 2D', 'm'), column('division', '刻度 r', '格'), phase];
const geometric = [column('object', '测量对象'), column('start', '起点或左侧坐标', 'mm'), column('end', '终点或右侧坐标', 'mm'), column('difference', '差值', 'mm')];
const stopVoltage = [wavelength, column('frequency', '频率', '10¹⁴ Hz'),
  column('zeroVoltage', '零电流遏止电压', 'V'), column('compensationVoltage', '补偿法遏止电压', 'V'), column('kneeVoltage', '拐点遏止电压', 'V')];
const photoCurrent = [column('aperture', '光阑直径', 'mm'), column('distance', '距离', 'cm'), column('apertureSquared', '光阑直径平方', 'mm²'),
  column('inverseDistanceSquared', '距离平方倒数', '10⁻³ cm⁻²'), column('photoCurrent', '饱和光电流', 'pA')];
const oil = [column('drop', '油滴'), voltage, column('fallTime', '下落时间', 's'), column('riseTime', '上升时间', 's'), column('charge', '电荷绝对值', '10⁻¹⁹ C')];

function thermometerRecords(doc) {
  const observed = tableRows(doc, 'data-t14-rows', 4).map(([actual, shown, error, relative]) =>
    [reading(actual), reading(shown), reading(error), reading(relative, '%')]);
  const calibrated = tableRows(doc, 'data-t14-curve-rows', 3).map(row => row.map(value => reading(value)));
  const alarms = tableRows(doc, 'data-t14-alarm-rows', 3).map(([value, red, blue]) => [reading(value), red, blue]);
  return [
    record('thermometer-observations', '水浴温度测量', [reference, temperature, column('error', '示值减参考值', '℃'), column('relativeError', '相对差', '%')], observed, 'thermometer'),
    record('thermometer-scale', '电阻箱刻度标定', [reference, column('resistance', '电阻箱', 'Ω'), column('microammeter', '微安表', 'μA')], calibrated),
    record('thermometer-alarm', '报警灯状态', [reference, column('red', '红灯'), column('blue', '蓝灯')], alarms),
  ];
}

function magnetRecords(doc) {
  const { key, label } = selectedOption(doc, 'data-m17-mode');
  if (!Object.hasOwn(magnet, key)) return [];
  const columns = magnet[key];
  const rows = tableRows(doc, 'data-m17-log', key === 'earth' ? 4 : columns.length).map(row => {
    if (key === 'earth') return [...row.slice(0, 3).map(value => reading(value)),
      reading(row[3], '（排除）'), row[3].includes('（排除）') ? '排除' : '计入'];
    return row.map((value, index) => columns[index].unit ? reading(value, key === 'angle' && index === 0 ? '°' : '') : value);
  });
  if (key === 'earth') return [
    record('magnet-earth', label + '记录', columns, rows.filter(row => row.at(-1) === '计入')),
    record('magnet-earth-excluded', label + '记录（超出线性拟合条件）', columns, rows.filter(row => row.at(-1) === '排除')),
  ];
  return [record('magnet-' + key, label + '记录', columns, rows)];
}

function lensRecords(doc) {
  const { key, label } = selectedOption(doc, 'data-lens-mode');
  return [record('lens-' + key, (label || '透镜') + '读数',
    [column('observation', '观察'), column('position', '记录位置', 'mm'), column('reading', '补充读数')],
    tableRows(doc, 'data-lens-rows', 3).map(([observation, position, note]) => [observation, reading(position, 'mm'), note]))];
}

function geometricRecords(doc) {
  const { key, label } = selectedOption(doc, 'data-m22-mode');
  const rows = tableRows(doc, 'data-m22-table', 4).map(([name, ...values]) => [name, ...values.map(value => reading(value, 'mm'))]);
  const source = label || '微小几何量测量';
  if (key === 'diffract') return groupBy(rows, row => row[0].split(' · ')[0], 'micro-diffract', source, geometric, row => row);
  return [record('micro-' + key, source, geometric, rows)];
}

function photoRecords(doc) {
  // 谱线波长和频率是给定条件，存在至少一项实测电压才计作读数。
  const voltageRows = tableRows(doc, 'data-ph-rows', 5).map(row => row.map(value => reading(value)))
    .filter(row => row.slice(2).some(value => value !== null));
  const currentRows = tableRows(doc, 'data-ph-intensity-rows', 5).map(row => row.map(value => reading(value)));
  return [record('photo-stop', '遏止电压', stopVoltage, voltageRows), record('photo-current', '饱和光电流', photoCurrent, currentRows)];
}

function spectraRecords(doc) {
  const optic = selectedOption(doc, 'data-hs-optic');
  const density = selectedOption(doc, 'data-hs-density');
  const suffix = optic.key === 'prism' ? '' : '-' + density.key;
  const label = (optic.label || '光谱') + (suffix && density.label ? ' · ' + density.label : '');
  const columns = [column('observation', '谱线及组次'), column('rawAngles', '原始双游标角'), angle,
    wavelength, column('gratingPeriod', '光栅周期', 'nm'), column('indexOfRefraction', '折射率'), column('result', '换算结果')];
  const rows = tableRows(doc, 'data-hs-rows', 4).map(([line, raw, position, note]) => [
    line, raw, reading(position, '°'), reading(note.match(/λ\s*≈\s*([0-9.]+)\s*nm/u)?.[1]),
    reading(note.match(/d\s*[＝=]\s*([0-9.]+)\s*nm/u)?.[1]), reading(note.match(/n\s*[＝=]\s*([0-9.]+)/u)?.[1]), note,
  ]);
  return [record('spectra-' + optic.key + suffix, label, columns, rows)];
}

const readers = {
  'semiconductor-thermometer': thermometerRecords,
  'rectifier-filter': doc => groupBy(tableRows(doc, 'data-rf-rows', 6), row => row[0], 'rectifier', '整流滤波',
    [resistance, column('dcVoltage', '直流电压', 'V'), column('acVoltage', '交流电压', 'V'),
      column('ripple', '纹波', '%'), column('power', '功率', 'mW')], row => row.slice(1).map(value => reading(value))),
  'magnetic-needle-oscillation': magnetRecords,
  'silicon-photocell': doc => groupBy(tableRows(doc, 'data-pv-rows', 6), row => row[0], 'photocell', '硅光电池',
    [column('lux', '照度', 'lx'), resistance, voltage, current, column('power', '功率', 'mW')],
    row => row.slice(1).map(value => reading(value))),
  'colour-design': doc => groupBy(tableRows(doc, 'data-cc-rows', 8), row => row[0], 'colour', '色彩设计',
    [column('channel', '测量通道'), column('distance', '屏距', 'cm'), column('filter', '滤片'),
      column('redCurrent', '红光电流', 'mA'), column('greenCurrent', '绿光电流', 'mA'), column('blueCurrent', '蓝光电流', 'mA'),
      voltage, column('relative', '相对光强'), column('colour', '白屏颜色')],
    ([, channel, dist, filter, amps, v, relative, colour]) => {
      const currents = [0, 1, 2].map(index => reading(amps.split('/')[index]));
      return [channel, reading(dist), filter, ...currents, reading(v), reading(relative), colour];
    }),
  'lens-parameters': lensRecords,
  'optical-microgeometry': geometricRecords,
  'light-speed': doc => [record('light-time', '光程与相位', lightSpeed,
    tableRows(doc, 'data-c-rows', 4).map(row => row.map(value => reading(value))))],
  'photoelectric-effect': photoRecords,
  'millikan-oil-drop': doc => groupBy(tableRows(doc, 'data-od-rows', 6), row => row[1], 'drop', '密立根油滴',
    oil, ([label,, ...values]) => [label, ...values.map(value => reading(value))]),
  'atomic-spectra': spectraRecords,
};

const manual = {
  'semiconductor-thermometer': [reference, temperature],
  'oscilloscope-hardware': [frequency, column('peakToPeak', '峰峰值', 'V'), period],
  'rectifier-filter': [resistance, column('dcVoltage', '直流电压', 'V'), column('acVoltage', '交流电压', 'V')],
  'magnetic-needle-oscillation': [current, period, column('field', '磁场读数', 'mT')],
  'silicon-photocell': [column('lux', '照度', 'lx'), resistance, voltage, current],
  'colour-design': [column('redCurrent', '红光电流', 'mA'), column('greenCurrent', '绿光电流', 'mA'),
    column('blueCurrent', '蓝光电流', 'mA'), voltage],
  'spectrometer': [angle, wavelength],
  'lens-parameters': [column('objectDistance', '物距', 'mm'), column('imageDistance', '像距', 'mm')],
  'optical-microgeometry': [column('order', '环序或级次'), ...geometric.slice(1, 3)],
  'light-speed': [lightSpeed[1], phase],
  'photoelectric-effect': [wavelength, column('stoppingPotential', '遏止电压', 'V'), photoCurrent[4]],
  'millikan-oil-drop': oil.slice(1, 4),
  'atomic-spectra': [wavelength, angle, column('order', '级次')],
};

export function readLast(slug, document) {
  if (slug === 'oscilloscope-hardware' || slug === 'spectrometer') return readNested(slug, document);
  return Object.hasOwn(readers, slug) ? readers[slug](document).filter(table => table.rows.length > 0) : [];
}

export function lastFields(slug) {
  return Object.hasOwn(manual, slug) ? manual[slug].map(field => ({ ...field })) : [];
}
