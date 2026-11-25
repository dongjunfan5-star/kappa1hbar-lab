#!/usr/bin/env node
/**
 * 把「内容侧覆盖层」注入到实验页的 srcdoc 模板里（幂等）。
 *
 * 背景：`units/<slug>/index.html` 的内容并不是直接写在 HTML 里，
 * 而是塞在 `<iframe data-srcdoc="…">` 的【转义属性】中，由脚本写入 sandbox iframe 渲染。
 * 因此样式/脚本必须按转义格式注入到 srcdoc 的 </body> 之前；写在外层文档中无效。
 *
 * 用法：
 *   node scripts/inject-content-style.mjs <目标html> <覆盖css> [覆盖js]
 *
 * 行为：
 *   · 若目标里已有 PHYSLAB-CONTENT-OVERRIDES 标记块 → 原位替换（幂等）
 *   · 若没有 → 在 srcdoc 的 &lt;/body&gt; 之前插入
 *   · 覆盖 CSS 会被转义（& < > "）后包成 &lt;style&gt;…&lt;/style&gt;
 *   · 若给了覆盖 JS，再紧跟一个 &lt;script&gt; 块（PHYSLAB-CONTENT-SCRIPT 标记，同样幂等）
 */
import fs from 'node:fs';

const [target, cssPath, jsPath] = process.argv.slice(2);
if (!target || !cssPath) {
  console.error('用法: node scripts/inject-content-style.mjs <目标html> <覆盖css> [覆盖js]');
  process.exit(1);
}

const OPEN = 'data-srcdoc="';
const CLOSE = '"></iframe>';
const START = '/* PHYSLAB-CONTENT-OVERRIDES-START';
const END = '/* PHYSLAB-CONTENT-OVERRIDES-END */';
const JS_START = '/* PHYSLAB-CONTENT-SCRIPT-START';
const JS_END = '/* PHYSLAB-CONTENT-SCRIPT-END */';

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const rawCss = fs.readFileSync(cssPath, 'utf8');
if (!rawCss.includes('PHYSLAB-CONTENT-OVERRIDES-START')) {
  throw new Error('覆盖 CSS 缺少 PHYSLAB-CONTENT-OVERRIDES-START 标记');
}
const rawJs = jsPath ? fs.readFileSync(jsPath, 'utf8') : null;
if (rawJs !== null && !rawJs.includes('PHYSLAB-CONTENT-SCRIPT-START')) {
  throw new Error('覆盖 JS 缺少 PHYSLAB-CONTENT-SCRIPT-START 标记');
}

let s = fs.readFileSync(target, 'utf8');
const srcStart = s.indexOf(OPEN);
if (srcStart < 0) throw new Error('目标文件里没有 data-srcdoc 属性');
const contentStart = srcStart + OPEN.length;
const contentEnd = s.indexOf(CLOSE, contentStart);
if (contentEnd < 0) throw new Error('找不到 srcdoc 属性的结束引号（"></iframe>）');

const head = s.slice(0, contentStart);
let srcdoc = s.slice(contentStart, contentEnd);
const tail = s.slice(contentEnd);

const STYLE_OPEN = '&lt;style&gt;';
const STYLE_CLOSE = '&lt;/style&gt;';
const SCRIPT_OPEN = '&lt;script&gt;';
const SCRIPT_CLOSE = '&lt;/script&gt;';

const newStyle = STYLE_OPEN + esc(rawCss) + STYLE_CLOSE;
const newScript = rawJs === null ? '' : SCRIPT_OPEN + esc(rawJs) + SCRIPT_CLOSE;

/* ── 1) 样式块：有则原位替换，无则插到 </body> 前 ── */
const existingCss = srcdoc.indexOf(START);
if (existingCss >= 0) {
  const open = srcdoc.lastIndexOf(STYLE_OPEN, existingCss);
  const close = srcdoc.indexOf(STYLE_CLOSE, existingCss);
  if (open < 0 || close < 0) throw new Error('样式标记块结构异常，无法定位');
  srcdoc = srcdoc.slice(0, open) + newStyle + srcdoc.slice(close + STYLE_CLOSE.length);
  console.log('[inject] 已替换现有样式覆盖块');
} else {
  const bodyClose = srcdoc.lastIndexOf('&lt;/body&gt;');
  if (bodyClose < 0) throw new Error('srcdoc 里找不到 &lt;/body&gt;');
  srcdoc = srcdoc.slice(0, bodyClose) + newStyle + '\n' + srcdoc.slice(bodyClose);
  console.log('[inject] 已插入样式覆盖块');
}

/* ── 2) 脚本块（可选）：紧跟在样式块之后 ── */
if (rawJs !== null) {
  const existingJs = srcdoc.indexOf(JS_START);
  if (existingJs >= 0) {
    const open = srcdoc.lastIndexOf(SCRIPT_OPEN, existingJs);
    const close = srcdoc.indexOf(SCRIPT_CLOSE, existingJs);
    if (open < 0 || close < 0) throw new Error('脚本标记块结构异常，无法定位');
    srcdoc = srcdoc.slice(0, open) + newScript + srcdoc.slice(close + SCRIPT_CLOSE.length);
    console.log('[inject] 已替换现有脚本覆盖块');
  } else {
    const anchor = srcdoc.indexOf(newStyle);
    if (anchor < 0) throw new Error('找不到刚写入的样式块，无法定位脚本插入点');
    const at = anchor + newStyle.length;
    srcdoc = srcdoc.slice(0, at) + '\n' + newScript + srcdoc.slice(at);
    console.log('[inject] 已插入脚本覆盖块');
  }
} else if (srcdoc.indexOf(JS_START) >= 0) {
  // 本次没提供 JS，但文件里有旧脚本块 → 移除，避免残留过期逻辑
  const j = srcdoc.indexOf(JS_START);
  const open = srcdoc.lastIndexOf(SCRIPT_OPEN, j);
  const close = srcdoc.indexOf(SCRIPT_CLOSE, j);
  if (open >= 0 && close >= 0) {
    srcdoc = srcdoc.slice(0, open) + srcdoc.slice(close + SCRIPT_CLOSE.length);
    console.log('[inject] 已移除旧脚本覆盖块（本次未提供 JS）');
  }
}

fs.writeFileSync(target, head + srcdoc + tail, 'utf8');
console.log('[inject] 写入:', target, '（字符数', (head + srcdoc + tail).length, '）');

