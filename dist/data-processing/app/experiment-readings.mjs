const version = 1;
const prefix = 'physlab:experiment-readings:v1:';

export function validExperimentSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9-]{1,100}$/.test(slug);
}

function cleanDataSets(dataSets) {
  if (!Array.isArray(dataSets)) return [];
  return dataSets.flatMap(data => {
    if (!data || typeof data.id !== 'string' || typeof data.label !== 'string'
        || !Array.isArray(data.columns) || !data.columns.length || !Array.isArray(data.rows)) return [];
    const columns = data.columns.map(column => ({
      key: typeof column?.key === 'string' ? column.key : '',
      label: typeof column?.label === 'string' ? column.label : '',
      unit: typeof column?.unit === 'string' ? column.unit : ''
    }));
    if (columns.some(column => !column.key || !column.label)
        || new Set(columns.map(column => column.key)).size !== columns.length) return [];
    const rows = data.rows.flatMap(row => {
      if (!Array.isArray(row) || row.length !== columns.length) return [];
      const values = row.map(value => {
        if (typeof value === 'string') return value.trim() || null;
        return Number.isFinite(value) ? value : null;
      });
      return values.some(value => value !== null) ? [values] : [];
    });
    return rows.length ? [{
      id: data.id, label: data.label, columns, rows,
      ...(typeof data.kind === 'string' ? { kind: data.kind } : {})
    }] : [];
  });
}

export function loadExperimentReadings(slug) {
  if (!validExperimentSlug(slug)) return null;
  try {
    const state = JSON.parse(sessionStorage.getItem(prefix + slug));
    if (state?.version !== version || state.slug !== slug) return null;
    return {
      title: typeof state.title === 'string' ? state.title : '',
      native: cleanDataSets(state.native),
      manual: cleanDataSets(state.manual),
      updated: Number.isFinite(state.updated) ? state.updated : 0
    };
  } catch {
    return null;
  }
}

export function saveExperimentReadings(slug, { title, native, manual }) {
  if (!validExperimentSlug(slug)) throw new TypeError('无效的实验编号。');
  sessionStorage.setItem(prefix + slug, JSON.stringify({
    version, slug, title, native: cleanDataSets(native), manual: cleanDataSets(manual), updated: Date.now()
  }));
}
