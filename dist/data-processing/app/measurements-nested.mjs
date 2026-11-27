// The two sandboxed instruments already save their widget state through a
// MessageChannel owned by their same-origin wrapper. Read only that wrapper's
// exact state key and the fields produced by its explicit recording controls.
const statePrefix = 'codex:visualization-widget-state-v2:';

function widgetState(slug, document) {
  const wrapper = document?.querySelector('iframe#codex-visualization');
  if (!wrapper?.sandbox.contains('allow-scripts')) return null;
  try {
    const { location, localStorage } = document.defaultView;
    const path = '/units/' + slug + '/';
    if (!(location.pathname.endsWith(path) || location.pathname.endsWith(path + 'index.html'))) return null;
    return JSON.parse(localStorage.getItem(statePrefix + JSON.stringify([location.pathname, location.search])));
  } catch {
    return null;
  }
}

function column(key, label, unit = '') {
  return { key, label, unit };
}

function dataset(id, label, columns, rows) {
  return { id, label, columns, rows, kind: 'native' };
}

function entries(value, limit) {
  return Array.isArray(value) ? value.slice(-limit) : [];
}

function scopeRecords(state) {
  if (state?.modelContent?.kind !== 'scope-course-v2') return [];
  const digital = state.privateContent?.digital;
  if (!digital || state.modelContent.digital?.kind !== 'digital-scope-v2') return [];
  const points = (key) => entries(digital.labpoints?.[key], 30)
    .filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map(point => [point.x, point.y]);
  return [
    dataset('scope-frequency', '数字示波器频率记录',
      [column('x', '信号源频率', 'Hz'), column('y', '示波器实测频率', 'Hz')], points('frequency')),
    dataset('scope-voltage', '数字示波器峰峰值记录',
      [column('x', '信号源峰峰值 Vpp', 'V'), column('y', '示波器实测峰峰值 Vpp', 'V')], points('voltage')),
  ];
}

function spectrometerRecords(state) {
  if (state?.modelContent?.kind !== 'spectrometer-v1') return [];
  const saved = entries(state.modelContent.settings?.records, 24);
  const angles = type => saved
    .filter(record => record?.type === type && typeof record.text === 'string')
    .flatMap(({ text }) => {
      const match = text.trim().match(/^(\d+(?:\.\d+)?)°(?:（须确认转折点）)?$/u);
      return match ? [[match[1]]] : [];
    });
  const verniers = (key) => entries(state.privateContent?.captured?.[key], 4)
    .filter(point => typeof point?.label === 'string' &&
      Number.isFinite(point.reading?.v1?.reading) && Number.isFinite(point.reading?.v2?.reading))
    .map(point => [point.label, point.reading.v1.reading, point.reading.v2.reading]);
  const grating = saved.filter(record => record?.type === '光栅常量' && typeof record.text === 'string')
    .flatMap(({ text }) => {
      const match = text.trim().match(/^(\d+(?:\.\d+)?)\s*μm；左(\d+)°(\d{1,2})′，右(\d+)°(\d{1,2})′$/u);
      if (!match) return [];
      const [, spacing, leftDegree, leftMinute, rightDegree, rightMinute] = match;
      if (Number(leftMinute) >= 60 || Number(rightMinute) >= 60) return [];
      return [[spacing, Number(leftDegree) + Number(leftMinute) / 60, Number(rightDegree) + Number(rightMinute) / 60]];
    });
  const readingColumns = [column('direction', '读数位置'), column('vernier1', '游标一', '°'), column('vernier2', '游标二', '°')];
  return [
    dataset('spectrometer-rotation', '双游标转角', [column('rotation', '转角', '°')], angles('双游标转角')),
    dataset('spectrometer-apex', '自准直顶角', [column('apex', '顶角', '°')], angles('自准直顶角')),
    dataset('spectrometer-deflection', '两方向偏角（须确认转折点）',
      [column('deflection', '两方向偏角', '°')], angles('两方向偏角')),
    dataset('spectrometer-grating', '光栅常量与左右读数',
      [column('spacing', '光栅常量', 'μm'), column('leftAngle', '左谱线角度', '°'), column('rightAngle', '右谱线角度', '°')], grating),
    dataset('spectrometer-apex-verniers', '棱镜反射面的双游标记录', readingColumns, verniers('apex')),
    dataset('spectrometer-minimum-verniers', '偏向测量的双游标记录', readingColumns, verniers('minimum')),
  ];
}

export function readNested(slug, document) {
  if (slug === 'oscilloscope-hardware') return scopeRecords(widgetState(slug, document));
  if (slug === 'spectrometer') return spectrometerRecords(widgetState(slug, document));
  return [];
}
