import { tools, defaultToolId, advancedMethods, runAdvancedTool } from './tools.mjs';
import { mountExperimentImport } from './import-view.mjs';
import { createReportFile, downloadReport } from './report-download.mjs?v=report-info';
import { validExperimentSlug } from './experiment-readings.mjs';

const byId = id => document.getElementById(id);
const methods = new Map(tools.map(tool => [tool.id, tool]));
const drafts = new Map();
const methodList = byId('method-list');
const methodSelect = byId('method-select');
const form = byId('measurement-form');
const fields = byId('tool-fields');
const summary = byId('result-summary');
const detail = byId('result-detail');
const chart = byId('chart');
const error = byId('form-error');
const copy = byId('copy-result');
const copyStatus = byId('copy-status');
const exportButton = byId('export-report');
const exportStatus = byId('export-status');
const reportDialog = byId('report-dialog');
const reportForm = byId('report-form');
const reportFormStatus = byId('report-form-status');
const reportSubmit = byId('download-report');
const reportRemember = byId('remember-report-student');
const reportStudentKey = 'physlab:report-student:v1';
const reportStudentFields = ['name', 'studentId', 'className'];
const choices = new Map();
let selected;
let advancedExample;
let chartUrl;
let copyText;
let studyRequest;
let dataSource;
let reportSnapshot;
let reportRequest;
let importSelectionPending = false;

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function option({ value, label }) {
  const node = element('option', label);
  node.value = value;
  return node;
}

const advanced = {
  id: 'advanced', title: '全部方法（JSON）', category: '高级计算',
  description: '选择函数并提交 JSON 参数数组。示例会显示参数顺序和数据格式。',
  fields: [
    { name: 'method', label: '方法', type: 'select', full: true,
      options: advancedMethods.map(method => ({ value: method.id, label: method.title })) },
    { name: 'args', label: '参数数组', type: 'textarea', hint: '参数按函数签名的顺序排列。' }
  ],
  example: { method: advancedMethods[0].id, args: advancedMethods[0].example },
  run: ({ method, args }) => runAdvancedTool(method, args)
};
methods.set(advanced.id, advanced);

const groups = new Map();
for (const tool of methods.values()) {
  if (!groups.has(tool.category)) {
    const group = element('div', undefined, 'method-group');
    group.append(element('h3', tool.category));
    methodList.append(group);
    const mobile = element('optgroup');
    mobile.label = tool.category;
    methodSelect.append(mobile);
    groups.set(tool.category, { group, mobile });
  }
  const { group, mobile } = groups.get(tool.category);
  const button = element('button', tool.title, 'method-choice');
  button.type = 'button';
  button.addEventListener('click', () => choose(tool.id));
  group.append(button);
  choices.set(tool.id, button);
  mobile.append(option({ label: tool.title, value: tool.id }));
}
methodSelect.addEventListener('change', () => choose(methodSelect.value));

const back = byId('back-link');
const from = new URLSearchParams(location.search).get('from');
const experimentSlug = validExperimentSlug(from) ? from : null;
if (experimentSlug) {
  const destination = new URL('../unit.html', location.href);
  destination.searchParams.set('u', experimentSlug);
  back.href = destination.href;
  back.textContent = '返回实验';
}

function readFields() {
  return Object.fromEntries(selected.fields.map(({ name }) => {
    const control = form.elements.namedItem(name);
    return [name, control.type === 'checkbox' ? control.checked : control.value];
  }));
}

function writeFields(values) {
  for (const { name } of selected.fields) {
    const control = form.elements.namedItem(name);
    if (control.type === 'checkbox') control.checked = Boolean(values[name]);
    else control.value = values[name] ?? '';
  }
}

function useAdvancedExample(methodId) {
  const method = advancedMethods.find(item => item.id === methodId);
  const input = form.elements.namedItem('args');
  if (!method || !input) return;
  input.value = method.example;
  advancedExample.textContent = [method.hint, '参数按函数签名的顺序排列。'].filter(Boolean).join(' ');
}

function makeField(field) {
  const label = element('label', undefined, 'field');
  const type = field.type;
  if (type === 'textarea' || field.full) label.classList.add('full');
  if (type === 'checkbox') label.classList.add('check', 'full');
  const caption = element('span', field.label);
  const control = element(type === 'select' || type === 'textarea' ? type : 'input');
  control.name = field.name;
  control.id = 'field-' + field.name;
  label.htmlFor = control.id;
  if (control instanceof HTMLInputElement) control.type = type || 'text';
  if (type === 'select') control.append(...field.options.map(option));
  if (type !== 'checkbox') control.required = field.required !== false;
  if (type === 'number') {
    control.step = field.step ?? 'any';
    if (field.min !== undefined) control.min = field.min;
    if (field.max !== undefined) control.max = field.max;
  }
  if (field.placeholder) control.placeholder = field.placeholder;
  if (type === 'textarea') control.spellcheck = false;
  label.append(caption, control);
  if (field.hint) {
    const hint = element('small', field.hint);
    hint.id = control.id + '-hint';
    label.append(hint);
    control.setAttribute('aria-describedby', hint.id);
    if (selected === advanced && field.name === 'args') advancedExample = hint;
  }
  if (selected === advanced && field.name === 'method') {
    control.addEventListener('change', () => {
      useAdvancedExample(control.value);
      setSource({ kind: 'example', label: '示例数据' });
      calculate();
    });
  }
  return label;
}

function setSource(source) {
  dataSource = source;
  byId('data-origin').textContent = source.label;
}

function choose(id, imported) {
  if (selected?.id === id && !imported) return;
  if (selected) drafts.set(selected.id, { values: readFields(), source: dataSource });
  selected = methods.get(id);
  byId('tool-title').textContent = selected.title;
  byId('tool-description').textContent = selected.description;
  const source = byId('tool-source');
  source.hidden = !selected.source;
  if (selected.source) {
    source.textContent = selected.source;
    const reference = selected.source.match(/[12]\.[1-4]/)?.[0];
    source.href = reference ? '#section-' + reference.replace('.', '-') : '#textbook';
  }
  for (const [methodId, node] of choices) {
    if (methodId === id) node.setAttribute('aria-current', 'true');
    else node.removeAttribute('aria-current');
  }
  methodSelect.value = id;
  fields.replaceChildren(...selected.fields.map(makeField));
  const draft = imported ?? drafts.get(id);
  const values = draft?.values ?? selected.example;
  writeFields(values);
  setSource(draft?.source ?? { kind: 'example', label: '示例数据' });
  if (selected === advanced) {
    const hint = advancedMethods.find(method => method.id === values.method)?.hint;
    if (hint) advancedExample.textContent = hint;
  }
  calculate();
}

function display(value) {
  if (value === null || value === undefined) return '—';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '−∞';
  if (typeof value === 'number') return Number(value.toPrecision(9)).toString();
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

function resetResult() {
  copy.hidden = true;
  copyText = '';
  copyStatus.hidden = true;
  reportSnapshot = undefined;
  exportButton.hidden = true;
  exportStatus.hidden = true;
  error.hidden = true;
  chart.hidden = true;
  chart.replaceChildren();
  if (chartUrl) URL.revokeObjectURL(chartUrl);
  chartUrl = undefined;
  summary.replaceChildren();
  detail.replaceChildren();
}

function reportMessage(message) {
  exportStatus.textContent = message;
  exportStatus.hidden = false;
}

function restoreReportStudent() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(reportStudentKey));
  } catch {
    // A missing, corrupt, or unavailable record leaves the fields blank.
  }
  for (const field of reportStudentFields) {
    const value = saved?.[field];
    reportForm.elements.namedItem(field).value = typeof value === 'string' ? value : '';
  }
  reportForm.elements.namedItem('experimentDate').value = '';
  reportRemember.checked = reportRemember.defaultChecked;
}

function saveReportStudent(student, remember) {
  const saved = Object.fromEntries(reportStudentFields.map(field => [field, student[field]]));
  try {
    if (remember && Object.values(saved).some(Boolean)) localStorage.setItem(reportStudentKey, JSON.stringify(saved));
    else localStorage.removeItem(reportStudentKey);
  } catch {
    // The report download can still succeed when browser storage is unavailable.
  }
}

function invalidateReport(message) {
  if (!reportSnapshot) return;
  reportSnapshot = undefined;
  exportButton.disabled = true;
  reportMessage(message);
}

function prepareReport(result, values) {
  const selectedRecords = dataSource.selection;
  const advancedTitle = selected === advanced ? advancedMethods.find(method => method.id === values.method)?.title : null;
  const inputs = [...(selectedRecords?.columnSettings ?? [])];
  for (const field of selected.fields) {
    const value = values[field.name];
    if (value === '' || value === null || value === undefined) continue;
    const recordedField = field.type === 'textarea' || (selectedRecords?.columnSettings?.length && ['xLabel', 'yLabel'].includes(field.name));
    if (recordedField && selectedRecords && dataSource.importValues[field.name] === value) continue;
    const option = field.options?.find(option => option.value === value);
    inputs.push({ label: field.label, value: option?.label ?? (field.type === 'textarea' ? value : display(value)) });
  }
  const primary = (result.primary ?? []).map(metric => ({ ...metric, value: display(metric.value) }));
  const tables = result.tables ?? [];
  const calculationDetails = !primary.length && !tables.length && !result.svg && result.raw !== undefined
    ? JSON.stringify(result.raw, (_, value) => typeof value === 'number' && !Number.isFinite(value) ? display(value) : value, 2)
    : undefined;
  return {
    content: {
      experiment: selectedRecords?.experiment,
      method: advancedTitle ?? selected.title, source: dataSource.label,
      columns: selectedRecords?.columns ?? [], rows: selectedRecords?.rows ?? [], inputs,
      primary, tables, notes: result.notes ?? [], calculationDetails
    },
    svg: result.svg
  };
}

function addTable({ title, headers, rows }, open) {
  const section = element('details');
  section.open = open;
  section.append(element('summary', title));
  const scroll = element('div', undefined, 'table-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('aria-label', title);
  const table = element('table');
  const head = table.createTHead().insertRow();
  for (const label of headers) {
    const cell = element('th', label);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const line = body.insertRow();
    for (const value of row) line.insertCell().textContent = display(value);
  }
  scroll.append(table);
  section.append(scroll);
  detail.append(section);
}

function renderResult(result) {
  const values = element('dl', undefined, 'primary-values');
  for (const { label, value, unit } of result.primary ?? []) {
    const entry = element('div', undefined, 'primary-entry');
    const formatted = display(value) + (unit ? ' ' + unit : '');
    entry.append(element('dt', label), element('dd', formatted));
    values.append(entry);
    copyText += label + '  ' + formatted + '\n';
  }
  summary.append(values);
  copy.hidden = !copyText;
  if (result.svg) {
    chartUrl = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
    const img = element('img');
    img.src = chartUrl;
    img.alt = selected.title + '结果图';
    const download = element('a', '下载 SVG', 'btn btn-ghost');
    download.href = chartUrl;
    download.download = selected.id + '.svg';
    chart.append(img, download);
    chart.hidden = false;
  }
  if (result.notes?.length) {
    const notes = element('ul');
    notes.append(...result.notes.map(note => element('li', note)));
    detail.append(notes);
  }
  result.tables?.forEach((table, index) => addTable(table, index === 0));
  if (result.raw !== undefined) {
    const formatted = JSON.stringify(result.raw, (_, value) => Number.isFinite(value) ? value :
      typeof value === 'number' ? String(value) : value, 2);
    const raw = element('details');
    raw.open = selected === advanced && !copyText;
    raw.append(element('summary', '查看完整计算数据'), element('pre', formatted));
    detail.append(raw);
    if (raw.open && formatted) {
      copyText = formatted;
      copy.hidden = false;
    }
  }
}

function calculate() {
  resetResult();
  try {
    const values = readFields();
    const result = selected.run(values);
    renderResult(result);
    const pending = dataSource.kind === 'imported' && importSelectionPending;
    if (!pending) reportSnapshot = prepareReport(result, values);
    exportButton.hidden = false;
    exportButton.disabled = pending;
    if (pending) reportMessage('实验记录选择已修改，重新导入并计算后可导出报告。');
    return true;
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
    summary.append(element('p', '请检查实验读数后重新计算。', 'message'));
    return false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (calculate() && matchMedia('(max-width: 860px)').matches) byId('result-title').focus();
});
byId('example').addEventListener('click', () => {
  if (selected === advanced) useAdvancedExample(form.elements.namedItem('method').value);
  else writeFields(selected.example);
  setSource({ kind: 'example', label: '示例数据' });
  calculate();
});
form.addEventListener('input', () => {
  invalidateReport('输入已修改，重新计算后可导出报告。');
  if (dataSource.kind === 'example') setSource({ kind: 'manual', label: '手动输入' });
  else if (dataSource.kind === 'imported' && !dataSource.edited) {
    setSource({ ...dataSource, edited: true, label: dataSource.label + '（已编辑）' });
  }
});
exportButton.addEventListener('click', () => {
  if (!reportSnapshot) return;
  reportRequest = undefined;
  reportFormStatus.hidden = true;
  reportSubmit.disabled = false;
  restoreReportStudent();
  reportDialog.showModal();
});
byId('cancel-report').addEventListener('click', () => reportDialog.close());
reportForm.addEventListener('submit', async event => {
  event.preventDefault();
  const requested = reportSnapshot;
  if (!requested || reportRequest) return;

  const request = {};
  reportRequest = request;
  const isCurrent = () => reportDialog.open && reportRequest === request;
  const student = Object.fromEntries([...new FormData(reportForm)].map(([key, value]) => [key, value.trim()]));
  const remember = reportRemember.checked;
  reportSubmit.disabled = true;
  reportFormStatus.textContent = '正在生成 Word 报告…';
  reportFormStatus.classList.remove('error');
  reportFormStatus.hidden = false;
  try {
    const report = { ...requested.content, student, createdAt: new Date() };
    const { file, name } = await createReportFile(report, requested.svg, experimentSlug);
    if (!isCurrent()) return;
    if (reportSnapshot !== requested) {
      reportDialog.close();
      return;
    }
    downloadReport(file, name);
    saveReportStudent(student, remember);
    reportDialog.close();
    reportMessage('Word 报告已生成。');
  } catch (failure) {
    if (isCurrent()) {
      reportFormStatus.textContent = failure.message || '生成报告失败，请重试。';
      reportFormStatus.classList.add('error');
    }
  } finally {
    if (reportRequest === request) {
      reportRequest = undefined;
      reportSubmit.disabled = false;
    }
  }
});
copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(copyText.trim());
    copyStatus.textContent = '已复制计算结果。';
  } catch {
    copyStatus.textContent = '当前浏览器无法访问剪贴板，可选中结果后手动复制。';
  }
  copyStatus.hidden = false;
});

const textbook = byId('textbook');
const studyStatus = byId('study-status');
const studyRetry = byId('study-retry');
const importPanel = byId('experiment-import');
const hasExperiment = mountExperimentImport(importPanel, experimentSlug, (methodId, values, dataLabel, total, selection) => {
  if (!methods.has(methodId)) throw new Error('此方法暂时无法接收实验数据。');
  importSelectionPending = false;
  choose(methodId, { values, source: { kind: 'imported', label: dataLabel + ' · 已导入 ' + total + ' 组', selection, importValues: values } });
  byId('input-title').focus();
}, () => {
  if (dataSource?.kind === 'imported') {
    importSelectionPending = true;
    invalidateReport('实验记录选择已修改，重新导入并计算后可导出报告。');
  }
});
function loadStudy() {
  if (!studyRequest) {
    textbook.setAttribute('aria-busy', 'true');
    studyRetry.hidden = true;
    studyStatus.hidden = false;
    studyStatus.textContent = '正在加载教材详解…';
    studyRequest = fetch('./study.html').then(response => {
      if (!response.ok) throw new Error('教材读取失败');
      return response.text();
    }).then(html => {
      byId('study-content').innerHTML = html;
      studyStatus.hidden = true;
    }).catch(() => {
      studyRequest = undefined;
      studyStatus.textContent = '教材暂时无法加载。';
      studyRetry.hidden = false;
    }).finally(() => textbook.setAttribute('aria-busy', 'false'));
  }
  return studyRequest;
}

async function updateView() {
  const hash = location.hash.slice(1);
  const study = hash === 'textbook' || hash === 'method-index' || /^section-[12]-[1-4]$/.test(hash);
  textbook.hidden = !study;
  byId('calculator').hidden = study;
  importPanel.hidden = study || !hasExperiment;
  const active = byId(study ? 'study-tab' : 'calculator-tab');
  const idle = byId(study ? 'calculator-tab' : 'study-tab');
  active.setAttribute('aria-current', 'page');
  idle.removeAttribute('aria-current');
  if (study) {
    await loadStudy();
    if (hash !== 'textbook' && location.hash === '#' + hash) byId(hash)?.scrollIntoView();
  }
}
studyRetry.addEventListener('click', loadStudy);
window.addEventListener('hashchange', updateView);
choose(defaultToolId);
updateView();
