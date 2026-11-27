import { loadExperimentReadings, validExperimentSlug } from './experiment-readings.mjs';
import { importedMethods, applyImportedMethod } from './import-methods.mjs';

function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function selectOption(value, label) {
  const option = node('option', label);
  option.value = value;
  return option;
}

function labelledControl(caption, control) {
  const label = node('label', caption);
  label.append(control);
  return label;
}

function button(label) {
  const control = node('button', label, 'btn btn-ghost');
  control.type = 'button';
  return control;
}

export function mountExperimentImport(root, slug, onApply) {
  if (!validExperimentSlug(slug)) return false;
  const snapshot = loadExperimentReadings(slug);
  const dataSets = [...(snapshot?.native ?? []), ...(snapshot?.manual ?? [])];
  if (dataSets.length === 0) {
    root.append(node('p', '本实验还没有可导入的记录。可返回实验记录读数，或在下方手动录入。', 'reading-hint'));
    return true;
  }

  const details = node('details');
  const summary = node('summary', '导入实验记录' + (snapshot.title ? ' · ' + snapshot.title : ''));
  const count = dataSets.reduce((total, data) => total + data.rows.length, 0);
  summary.append(node('span', count + ' 组可选', 'reading-count'));
  const body = node('div', undefined, 'import-body');
  const selector = node('select');
  selector.append(...dataSets.map((data, index) => selectOption(index, data.label + '（' + data.rows.length + ' 组）')));
  const rowActions = node('div', undefined, 'import-row-actions');
  const selectAll = button('全选');
  const clear = button('取消全选');
  const selectedCount = node('span', '');
  selectedCount.setAttribute('aria-live', 'polite');
  rowActions.append(selectAll, clear, selectedCount);

  const readout = node('div', undefined, 'reading-table-scroll');
  readout.tabIndex = 0;
  readout.setAttribute('aria-label', '实验记录列表');
  const method = node('select');
  method.name = 'import-method';
  const methodDescription = node('p', '', 'reading-hint');
  const note = node('p', '', 'reading-hint');
  const mapping = node('div', undefined, 'import-mapping');
  const form = node('form', undefined, 'import-options');
  const submit = node('button', '导入并计算', 'btn calculate');
  submit.type = 'submit';
  const status = node('p', '', 'message');
  status.setAttribute('role', 'status');

  form.append(labelledControl('处理方法', method), methodDescription, mapping, note, submit, status);
  body.append(labelledControl('数据组', selector), rowActions, readout, form);
  details.append(summary, body);
  root.append(details);

  let current;
  let checks = [];
  let methodList = [];
  const selectedRows = () => checks.flatMap((check, index) => check.checked ? [index] : []);

  function renderMapping(keep) {
    const selectedMethod = methodList.find(item => item.id === method.value);
    mapping.replaceChildren();
    methodDescription.textContent = selectedMethod?.description ?? '';
    note.textContent = selectedMethod?.notes?.join(' ') ?? '';
    submit.disabled = !selectedMethod || selectedRows().length === 0;
    if (!selectedMethod) return;
    for (const field of selectedMethod.fields) {
      const control = node('select');
      control.name = field.name;
      if (!field.required) control.append(selectOption('', '不使用'));
      control.append(...field.options.map(entry => selectOption(entry.key, entry.label + (entry.unit ? '（' + entry.unit + '）' : ''))));
      const candidate = keep?.[field.name] ?? selectedMethod.mapping[field.name];
      if ([...control.options].some(option => option.value === candidate)) control.value = candidate;
      control.required = field.required;
      mapping.append(labelledControl(field.label, control));
    }
  }

  function currentMapping() {
    return Object.fromEntries([...mapping.querySelectorAll('select')].map(control => [control.name, control.value]));
  }

  function updateChoices(keepMapping = true) {
    const indices = selectedRows();
    selectedCount.textContent = '已选 ' + indices.length + ' 组';
    status.textContent = '';
    status.classList.remove('error');
    const previous = method.value;
    const columns = keepMapping ? currentMapping() : undefined;
    try {
      methodList = indices.length ? importedMethods(current, indices) : [];
    } catch (error) {
      methodList = [];
      status.textContent = error.message;
      status.classList.add('error');
    }
    method.replaceChildren(...methodList.map(item => selectOption(item.id, item.title)));
    if (methodList.some(item => item.id === previous)) method.value = previous;
    method.disabled = !methodList.length;
    renderMapping(method.value === previous ? columns : undefined);
    if (!indices.length) methodDescription.textContent = '请至少选择一组记录。';
  }

  function renderRows() {
    current = dataSets[Number(selector.value)];
    const table = node('table');
    table.setAttribute('aria-label', current.label);
    const header = table.createTHead().insertRow();
    for (const caption of ['选取', '组', ...current.columns.map(column => column.label + (column.unit ? ' / ' + column.unit : ''))]) {
      const th = node('th', caption);
      th.scope = 'col';
      header.append(th);
    }
    const rows = table.createTBody();
    checks = current.rows.map((values, index) => {
      const row = rows.insertRow();
      const check = node('input');
      check.type = 'checkbox';
      check.checked = true;
      check.setAttribute('aria-label', '选择第 ' + (index + 1) + ' 组');
      check.addEventListener('change', () => updateChoices());
      row.insertCell().append(check);
      row.insertCell().textContent = index + 1;
      for (const value of values) row.insertCell().textContent = value ?? '—';
      return check;
    });
    readout.replaceChildren(table);
    updateChoices(false);
  }

  selector.addEventListener('change', renderRows);
  method.addEventListener('change', () => renderMapping());
  for (const [control, checked] of [[selectAll, true], [clear, false]]) {
    control.addEventListener('click', () => {
      for (const check of checks) check.checked = checked;
      updateChoices();
    });
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const indices = selectedRows();
    try {
      const values = applyImportedMethod(current, indices, method.value, currentMapping());
      onApply(method.value, values, current.label, indices.length);
      status.textContent = '已导入 ' + indices.length + ' 组。';
      status.classList.remove('error');
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('error');
    }
  });
  renderRows();
  return true;
}
