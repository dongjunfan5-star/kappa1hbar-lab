// 只读取仿真实验台内由实验本身记录的表体，教材表格和即时仪表示值不参与导入。
const column = (key, label, unit) => (unit ? { key, label, unit } : { key, label });
const phase = column('phase', '阶段');
const condition = column('condition', '读数条件');
const time = column('time', '计时', 's');
const temperature = column('temperature', '温度', '℃');
const resistance = column('resistance', '电阻', 'Ω');
const voltage = column('voltage', '电压', 'V');
const mass = column('mass', '质量', 'g');
const distance = column('distance', '距离', 'm');
const pressure = (key, label) => column(key, label, 'kPa');
const numericText = '[-+]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][-+]?[0-9]+)?';
const decimal = new RegExp(`^${numericText}$`);
const normalize = input => String(input ?? '').replace(/−/g, '-').trim();

function number(input) {
  const value = normalize(input);
  if (!decimal.test(value)) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function captures(input, pattern) {
  const match = normalize(input).match(pattern);
  return match ? match.slice(1) : [];
}

function recordedRows(document, selector, width) {
  const body = document?.querySelector(`.rig-host ${selector}`);
  if (!body) return [];
  return Array.from(body.rows, row => Array.from(row.cells))
    .filter(cells => cells.length === width && cells.every(cell => cell.colSpan === 1))
    .map(cells => cells.map(cell => cell.textContent.trim()));
}

function numericRows(rows) {
  return rows.map(row => row.map(normalize)).filter(row => row.every(value => number(value) !== null));
}

function dataset(id, label, columns, rows) {
  return { id, label, columns, rows };
}

const fields = {
  'mass-measurement': [mass, column('buoyancy', '浸没后天平增量', 'g')],
  'air-track': [column('height', '导轨垫高', 'mm'), distance, column('gateTime', '遮光时间', 'ms')],
  'youngs-modulus': [column('mass', '净加质量', 'kg'), column('reading', '标尺读数', 'mm')],
  'shear-modulus': [column('cycles', '完整周期数'), column('bareTime', '裸盘总时长', 's'), column('ringTime', '加环总时长', 's')],
  'liquid-viscosity': [column('diameter', '球径', 'mm'), column('interval', '标线间距', 'cm'), time],
  'surface-tension': [column('upper', '上杆增量', 'mm'), column('force', '附加拉力 ΔF', 'mN')],
  'standing-wave': [column('mass', '悬挂总质量', 'g'), column('length', '有效弦长', 'cm'), column('antinodes', '波腹数'), column('frequency', '频率', 'Hz')],
  'sound-speed': [column('position', '位置或棒长', 'mm'), column('frequency', '频率', 'kHz'), column('delay', '到达时刻', 'μs')],
  'solid-specific-heat': [column('time', '时间', 'min'), column('temperature', '水温', '℃')],
  'heat-capacity-ratio': [pressure('p0', '大气压 p₀'), pressure('p1', '初态压强 p₁'), pressure('p2', '终态压强 p₂')],
  'water-vaporization-heat': [column('theta1', '初温 θ₁', '℃'), column('theta2', '终温 θ₂', '℃'), column('theta3', '蒸汽温度 θ₃', '℃'), column('delta', '增重 Δm', 'g')],
  'dc-power-characteristics': [column('current', '负载电流', 'mA'), voltage, column('resistance', '负载电阻', 'Ω')],
  'thermistor-characteristics': [column('temperature', '浴温', '℃'), column('ntc', 'NTC 阻值', 'Ω'), column('ptc', 'PTC 阻值', 'Ω')],
};

function massRecords(document) {
  const readings = recordedRows(document, '[data-records]', 3);
  const masses = readings.filter(([mode]) => mode === '基础称量').map(([, value]) => [value]);
  const buoyancy = readings.filter(([mode]) => mode === '静力称衡').map(([, value, note]) => [number(value), note]);
  return [
    dataset('sample-mass', '空气中样品质量', [mass], numericRows(masses)),
    dataset('buoyancy', '静力称衡读数', [fields['mass-measurement'][1], condition], buoyancy.filter(([value]) => value !== null)),
  ];
}

const accelerationConditions = new RegExp(`^h=(${numericText}) mm；s=(${numericText}) m$`);
const accelerationResults = new RegExp(`^2s=(${numericText}) m；v²=(${numericText}) m²/s²$`);
const collisionVelocities = new RegExp(`^u₁=(${numericText})；v₁=(${numericText})；v₂=(${numericText})$`);
const collisionBalances = new RegExp(`^p：(${numericText}) → (${numericText}) kg·m/s；E：(${numericText}) → (${numericText}) J$`);

function airTrackRecords(document) {
  const acceleration = new Map();
  const collision = [];
  for (const [mode, setup, gate, velocity, result] of recordedRows(document, '[data-records]', 5)) {
    if (mode === '匀加速') {
      const [height, length] = captures(setup, accelerationConditions).map(number);
      const [twiceDistance, speedSquared] = captures(result, accelerationResults).map(number);
      const row = [twiceDistance, speedSquared, height, length, number(gate), number(velocity)];
      if (row.every(value => value != null)) {
        if (!acceleration.has(height)) acceleration.set(height, []);
        acceleration.get(height).push(row);
      }
    } else if (mode === '碰撞') {
      const velocities = captures(velocity, collisionVelocities).map(number);
      const balances = captures(result, collisionBalances).map(number);
      if (velocities.length === 3 && balances.length === 4 && [...velocities, ...balances].every(value => value !== null)) {
        collision.push([setup, ...velocities, ...balances, gate]);
      }
    }
  }
  return [
    ...Array.from(acceleration, ([height, rows]) => dataset(`acceleration-${height}`, `气垫导轨匀加速观测（垫高 ${height} mm）`,
      [column('twiceDistance', '2s', 'm'), column('speedSquared', 'v²', 'm²/s²'),
        ...fields['air-track'], column('speed', '速度', 'm/s')], rows)),
    dataset('collision', '气垫导轨碰撞观测', [column('coupling', '碰撞头'), column('u1', '碰前速度 u₁', 'm/s'),
      column('v1', '碰后速度 v₁', 'm/s'), column('v2', '碰后速度 v₂', 'm/s'), column('p0', '碰前动量', 'kg·m/s'),
      column('p1', '碰后动量', 'kg·m/s'), column('e0', '碰前动能', 'J'), column('e1', '碰后动能', 'J'),
      column('pulses', '分次遮光时间', 'ms')], collision),
  ];
}

function youngsRecords(document) {
  const rows = recordedRows(document, '[data-b-records]', 3)
    .map(([direction, load, reading]) => [number(load), number(reading), direction])
    .filter(([load, reading]) => load !== null && reading !== null);
  return [dataset('loading', '加荷与卸荷标尺记录', [...fields['youngs-modulus'], column('direction', '过程')], rows)];
}

function shearRecords(document) {
  const rows = recordedRows(document, '[data-b4-records]', 4)
    .map(([setup, cycles, elapsed, period]) => [setup, number(cycles), number(elapsed), number(period)])
    .filter(([, cycles, elapsed, period]) => cycles !== null && elapsed !== null && period !== null);
  return [dataset('torsion', '裸盘与加环扭摆计时', [column('setup', '装配'), column('cycles', '完整周期数'),
    column('elapsed', '总时长', 's'), column('period', '单周期', 's')], rows)];
}

function viscosityRecords(document) {
  const rows = recordedRows(document, '[data-frows]', 5).flatMap(([diameter, length, elapsed, viscosity, status]) =>
    numericRows([[diameter, length, elapsed, viscosity]]).map(row => [...row, status]));
  return [dataset('falling-ball', '落球计时记录', [...fields['liquid-viscosity'], column('viscosity', '动力黏度', 'Pa·s'), condition], rows)];
}

function tensionRecords(document) {
  const rows = recordedRows(document, '[data-prows]', 5).flatMap(([liquid, upper, force, coefficient, status]) =>
    numericRows([[upper, force, coefficient]]).map(row => [...row, liquid, status]));
  return [dataset('film', '液膜拉脱读数', [...fields['surface-tension'], column('coefficient', '表面张力系数', 'mN/m'),
    column('liquid', '液体'), condition], rows)];
}

function standingRecords(document) {
  return [dataset('string-resonance', '弦线共振读数', [...fields['standing-wave'].slice(0, 3),
    column('speed', '波速', 'm/s'), column('density', '线密度', 'g/m')],
  numericRows(recordedRows(document, '[data-log-body]', 5)))];
}

const amplitudeReading = new RegExp(`^相对幅度 (${numericText})$`);
const delayReading = new RegExp(`^(${numericText}) μs$`);

function soundRecords(document) {
  const groups = { amplitude: [], phase: [], pulse: [] };
  for (const [label, positionText, reading] of recordedRows(document, '[data-log-body]', 3)) {
    const position = number(positionText);
    if (position === null) continue;
    if (label.endsWith('驻波幅度')) {
      const amplitude = number(captures(reading, amplitudeReading)[0]);
      if (amplitude !== null) groups.amplitude.push([position, amplitude]);
    } else if (label.endsWith('相位') && ['正斜率', '负斜率'].includes(reading)) {
      groups.phase.push([position, reading]);
    } else if (label.endsWith('固体时差')) {
      const delay = number(captures(reading, delayReading)[0]);
      if (delay !== null) groups.pulse.push([position, delay]);
    }
  }
  const position = column('position', '接收端位置', 'mm');
  return [
    dataset('standing-amplitude', '声速实验驻波幅度', [position, column('amplitude', '相对幅度')], groups.amplitude),
    dataset('phase', '声速实验相位观测', [position, column('orientation', '示波器直线方向')], groups.phase),
    dataset('pulse', '固体声速传播时差', [column('length', '棒长', 'mm'), column('time', '到达时刻', 'μs')], groups.pulse),
  ];
}

function calorimetryRecords(document) {
  const rows = recordedRows(document, '[data-t9-rows]', 3).flatMap(([stage, t, reading]) =>
    numericRows([[t, reading]]).map(row => [...row, stage]));
  return [dataset('calorimetry', '混合前后水温记录', [...fields['solid-specific-heat'], phase], rows)];
}

function adiabaticRecords(document) {
  const rows = recordedRows(document, '[data-g-rows]', 8).flatMap(([index, valve, p0, p1, closing, temp, p2, gamma]) =>
    numericRows([[index, p0, p1, closing, temp, p2, gamma]]).map(row => [...row, valve]));
  return [dataset('gas-runs', '空气比热容比试次', [column('trial', '试次'), pressure('p0', '大气压 p₀'),
    pressure('p1', '初态压强 p₁'), pressure('closing', '关阀压强'), column('temp', '关阀温度', '℃'),
    pressure('p2', '终态压强 p₂'), column('gamma', '比热容比 γ'), column('valve', '关阀时机')], rows)];
}

const vaporRows = new Map([
  ['空内筒 m₁', [column('cup', '内筒质量 m₁', 'g'), 'g']],
  ['搅拌器 m₂', [column('stirrer', '搅拌器质量 m₂', 'g'), 'g']],
  ['通汽前总质量 m₀', [column('initial', '通汽前总质量 m₀', 'g'), 'g']],
  ['通汽后总质量 m总', [column('final', '通汽后总质量', 'g'), 'g']],
  ['冷水初温 θ₁', [column('cold', '冷水初温 θ₁', '℃'), '℃']],
  ['平衡终温 θ₂', [column('equilibrium', '平衡终温 θ₂', '℃'), '℃']],
  ['蒸汽温度 θ₃', [column('steam', '蒸汽温度 θ₃', '℃'), '℃']],
]);

function vaporRecords(document) {
  const current = [];
  const currentColumns = [];
  for (const [label, input] of recordedRows(document, '[data-vh-current]', 2)) {
    if (!vaporRows.has(label)) continue;
    const [heading, suffix] = vaporRows.get(label);
    const value = input.endsWith(suffix) ? number(input.slice(0, -suffix.length)) : null;
    if (value !== null) {
      currentColumns.push(heading);
      current.push(value);
    }
  }
  const runs = recordedRows(document, '[data-vh-runs]', 5).flatMap(([insulation, initial, final, gain, result]) =>
    numericRows([[initial, final, gain, result]]).map(row => [...row, insulation]));
  const calibration = recordedRows(document, '[data-vh-cal-rows]', 3)
    .map(row => row.map(number)).filter(([t, u]) => t !== null && u !== null);
  return [
    dataset('vapor-current', '本组称量与温度', currentColumns, current.length ? [current] : []),
    dataset('vapor-runs', '水的汽化热试次', [fields['water-vaporization-heat'][0], fields['water-vaporization-heat'][1],
      fields['water-vaporization-heat'][3], column('latent', '比汽化热', 'MJ/kg'), column('insulation', '隔热材料')], runs),
    dataset('ad590-calibration', 'AD590 电流温度计标定', [temperature, column('voltage', '电压', 'mV'),
      column('residual', '拟合残差', 'mV')], calibration),
  ];
}

const loadPattern = new RegExp(`^(${numericText}) V；(${numericText}) mA$`);
const calibrationPattern = new RegExp(`^(${numericText}) V 标准；(${numericText}) V 指示$`);

function dcRecords(document) {
  const groups = { load: [], calibration: [], meter: [], bridge: [] };
  for (const [mode, r, reading] of recordedRows(document, '[data-dc-rows]', 3)) {
    const resistance = number(r);
    if (resistance === null) continue;
    if (mode === '负载') {
      const [u, i] = captures(reading, loadPattern).map(number);
      if (u != null && i != null) groups.load.push([i, u, resistance]);
    } else if (mode === '校准') {
      const [reference, indicated] = captures(reading, calibrationPattern).map(number);
      if (reference != null && indicated != null) groups.calibration.push([reference, indicated, resistance]);
    } else if (mode === '表头内阻' && reading === '示零') {
      groups.meter.push([resistance]);
    } else if (['标准支路', '待测支路'].includes(mode) && reading === '示零') {
      groups.bridge.push([resistance, mode]);
    }
  }
  return [
    dataset('load', '直流电源负载特性读数', fields['dc-power-characteristics'], groups.load),
    dataset('voltmeter-calibration', '电压表的校准读数', [column('reference', '标准值', 'V'),
      column('indicated', '指示值', 'V'), column('series', '串联电阻', 'Ω')], groups.calibration),
    dataset('meter-resistance', '表头内阻', [resistance], groups.meter),
    dataset('compensation', '补偿法示零电阻', [resistance, column('branch', '支路')], groups.bridge),
  ];
}

function thermistorRecords(document) {
  return [dataset('thermistor-bath', '热敏电阻恒温水浴读数', fields['thermistor-characteristics'],
    numericRows(recordedRows(document, '[data-t13-rows]', 3)))];
}

const readers = {
  'mass-measurement': massRecords,
  'air-track': airTrackRecords,
  'youngs-modulus': youngsRecords,
  'shear-modulus': shearRecords,
  'liquid-viscosity': viscosityRecords,
  'surface-tension': tensionRecords,
  'standing-wave': standingRecords,
  'sound-speed': soundRecords,
  'solid-specific-heat': calorimetryRecords,
  'heat-capacity-ratio': adiabaticRecords,
  'water-vaporization-heat': vaporRecords,
  'dc-power-characteristics': dcRecords,
  'thermistor-characteristics': thermistorRecords,
};

export function readFirst(slug, document) {
  return Object.hasOwn(readers, slug) ? readers[slug](document).filter(set => set.rows.length > 0) : [];
}

export function firstFields(slug) {
  return Object.hasOwn(fields, slug) ? fields[slug].map(field => ({ ...field })) : [];
}
