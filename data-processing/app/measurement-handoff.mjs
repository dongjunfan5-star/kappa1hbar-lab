import { loadExperimentReadings, saveExperimentReadings, validExperimentSlug } from './experiment-readings.mjs';
import { firstFields, readFirst } from './measurements-first.mjs';
import { lastFields, readLast } from './measurements-last.mjs';

const slug = new URLSearchParams(location.search).get('u');
const frame = document.getElementById('frame');
const processing = document.getElementById('data-processing');
const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

if (validExperimentSlug(slug) && frame && processing) initialize();

function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function initialize() {
  const state = loadExperimentReadings(slug) ?? { title: '', native: [], manual: [] };
  const fields = [...firstFields(slug), ...lastFields(slug)];
  const columns = fields.length ? fields : [{ key: 'reading', label: '读数', unit: '' }];
  const manual = state.manual.find(data => data.id === 'manual') ?? {
    id: 'manual', label: '手动记录的读数', columns, rows: [], kind: 'manual'
  };
  const native = new Map(state.native.map(data => [data.id, data]));
  let observedDocument;
  function collectNative() {
    const visible = new Set();
    try {
      const doc = frame.contentDocument;
      if (!doc) return visible;
      for (const data of [...readFirst(slug, doc), ...readLast(slug, doc)]) {
        if (data.rows.length) {
          visible.add(data.id);
          native.set(data.id, data);
        } else native.delete(data.id);
      }
    } catch (error) {
      console.warn('读取实验记录失败', error);
    }
    return visible;
  }
  function watchExperiment() {
    const doc = frame.contentDocument;
    if (!doc || doc === observedDocument || doc.URL === 'about:blank') return;
    observedDocument = doc;
    const readAroundChange = event => {
      const before = collectNative();
      const control = event.target.closest?.('button, input[type="button"], [role="button"]');
      const clear = control && (control.hasAttribute('data-clear') || /清(?:空|除).{0,10}(记录|数据|表格)|撤销/.test(control.textContent));
      setTimeout(() => {
        const after = collectNative();
        if (clear) for (const id of before) if (!after.has(id)) native.delete(id);
      }, 0);
    };
    doc.addEventListener('click', readAroundChange, true);
    doc.addEventListener('change', readAroundChange, true);
    doc.addEventListener('physlab-measurements-change', collectNative);
    collectNative();
  }
  const capture = () => {
    collectNative();
    state.native = [...native.values()];
    const heading = document.getElementById('title');
    if (heading?.textContent && !heading.textContent.includes('加载')) state.title = heading.textContent;
    state.manual = manual.rows.length ? [manual] : [];
    saveExperimentReadings(slug, state);
  };

  processing.addEventListener('click', () => {
    try { capture(); } catch (error) { console.warn('保存实验记录失败', error); }
  });
  frame.addEventListener('load', watchExperiment);
  watchExperiment();

  const button = node('button', '记读数', 'btn btn-ghost reading-trigger');
  button.type = 'button';
  button.title = '手动记录实验读数';
  button.setAttribute('aria-haspopup', 'dialog');
  const toolGroup = document.querySelector('.topbar-unit .topbar-tools');
  if (!toolGroup) return;
  toolGroup.insertBefore(button, toolGroup.firstChild);
  button.hidden = !processing.search.includes('from=');
  frame.addEventListener('load', () => { button.hidden = !processing.search.includes('from='); });

  const dialog = node('dialog', '', 'reading-dialog');
  const header = node('header', '', 'reading-dialog-heading');
  const heading = node('h2', '记录实验读数');
  heading.id = 'reading-dialog-heading';
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') event.stopPropagation();
  });
  const close = node('button', '关闭', 'btn btn-ghost');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);

  const hint = node('p', '每次输入一组实际读数。已记录的数据可在「数据处理」中勾选导入。', 'reading-hint');
  const form = node('form');
  const fieldGrid = node('div', '', 'reading-field-grid');
  const controls = manual.columns.map(column => {
    const label = node('label', column.label + (column.unit ? '（' + column.unit + '）' : ''));
    const input = node('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    label.append(input);
    fieldGrid.append(label);
    return input;
  });
  const save = node('button', '添加这一组', 'btn reading-action');
  save.type = 'submit';
  const status = node('p', '', 'reading-hint');
  status.setAttribute('role', 'status');
  form.append(fieldGrid, save, status);

  const rows = node('div', '', 'reading-table-scroll');
  const displayRows = () => {
    rows.replaceChildren();
    if (!manual.rows.length) return;
    const table = node('table');
    table.setAttribute('aria-label', '手动记录');
    const header = table.createTHead().insertRow();
    for (const caption of ['组', ...manual.columns.map(column => column.label + (column.unit ? ' / ' + column.unit : '')), '操作']) {
      const cell = node('th', caption);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = table.createTBody();
    manual.rows.forEach((group, index) => {
      const row = body.insertRow();
      for (const item of [index + 1, ...group]) row.insertCell().textContent = item ?? '—';
      const remove = node('button', '移除', 'btn btn-ghost reading-remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', '移除第 ' + (index + 1) + ' 组记录');
      remove.addEventListener('click', () => {
        const [previous] = manual.rows.splice(index, 1);
        try {
          capture();
          status.textContent = '已移除该组读数。';
          displayRows();
          save.focus();
        } catch {
          manual.rows.splice(index, 0, previous);
          status.textContent = '无法保存变更。请检查浏览器的本地存储设置。';
        }
      });
      row.insertCell().append(remove);
    });
    rows.append(table);
  };

  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = controls.map(input => input.value.trim().replace(/−/g, '-'));
    const invalid = values.findIndex(value => value && (!numberPattern.test(value) || !Number.isFinite(Number(value))));
    if (invalid !== -1) {
      status.textContent = '请输入有效数值，例如 1.20 或 2.3e-4。';
      controls[invalid].focus();
      return;
    }
    if (!values.some(Boolean)) {
      status.textContent = '请填写至少一个实际读数。';
      controls[0].focus();
      return;
    }
    manual.rows.push(values.map(value => value || null));
    try {
      capture();
      displayRows();
      form.reset();
      controls[0].focus();
      status.textContent = '已记录 ' + manual.rows.length + ' 组。';
    } catch {
      manual.rows.pop();
      status.textContent = '无法保存读数。请检查浏览器的本地存储设置。';
    }
  });

  dialog.append(header, hint, form, rows);
  document.body.append(dialog);
  button.addEventListener('click', () => {
    displayRows();
    status.textContent = '';
    dialog.showModal();
    controls[0].focus();
  });
}
