#!/usr/bin/env node
/**
 * 把 Codex 产出的「声速的测量」三个子页组装成一个站点单元。
 *
 * 输入（Codex 的 data-srcdoc 包装页）：
 *   sound-panel-preview.html       仪器面板（信号发生器 TFG1005）
 *   sound-experiment-preview.html  实验方法（振幅法/相位法/脉冲法）
 *   sound-data-preview.html        数据处理（12 点读数 → 拟合 → 声速）
 *
 * 产出（site/units/sound-speed/）：
 *   panel.html / experiment.html / data.html   三个独立子页
 *   index.html                                 带页签的宿主页
 *
 * 每个子页做四件事：
 *   1. 解出 srcdoc，成为独立 HTML
 *   2. 把 3 个 unpkg 依赖内联（Floating UI 代码内联；Lucide 只用 2 个箭头 → 用 shim）
 *   3. 未替换的模板占位符 __CODEX_VISUALIZATION_WIDGET_STATE__ → {}
 *   4. 固定暗色主题（站点外壳是暗色，避免亮色子页突兀）
 *
 * 用法：node scripts/build-sound-unit.mjs <tmp目录> <vendor目录> <输出单元目录>
 */
import fs from 'node:fs';
import path from 'node:path';

const [tmpDir, vendorDir, unitDir] = process.argv.slice(2);
if (!tmpDir || !vendorDir || !unitDir) {
  console.error('用法: node build-sound-unit.mjs <tmp目录> <vendor目录> <输出单元目录>');
  process.exit(1);
}

const PAGES = [
  { file: 'sound-panel-preview.html', out: 'panel.html', title: '声速 · 仪器面板', label: '仪器面板' },
  { file: 'sound-experiment-preview.html', out: 'experiment.html', title: '声速 · 实验方法', label: '实验方法' },
  { file: 'sound-data-preview.html', out: 'data.html', title: '声速 · 数据处理', label: '数据处理' },
];

const CDN = [
  { match: /@floating-ui\/core@[\d.]+/, file: 'floating-ui.core.umd.min.js', kind: 'inline' },
  { match: /@floating-ui\/dom@[\d.]+/, file: 'floating-ui.dom.umd.min.js', kind: 'inline' },
  { match: /lucide@[\d.]+/, file: 'lucide-shim.js', kind: 'inline' },
];

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const defuse = (js) => js.replace(/<\/script/gi, '<\\/script');

function decodeSrcdoc(wrapperHtml) {
  const K = 'data-srcdoc="';
  const a = wrapperHtml.indexOf(K) + K.length;
  const b = wrapperHtml.indexOf('"></iframe>', a);
  if (a < K.length || b < 0) throw new Error('找不到 data-srcdoc 属性');
  return wrapperHtml
    .slice(a, b)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

let report = [];

for (const page of PAGES) {
  const srcPath = path.join(tmpDir, page.file);
  let doc = decodeSrcdoc(fs.readFileSync(srcPath, 'utf8'));
  const before = doc.length;

  // ① 未替换的模板占位符 → 空初始状态（否则 JSON.parse 抛错）
  const phCount = (doc.match(/__CODEX_VISUALIZATION_WIDGET_STATE__/g) || []).length;
  doc = doc.replace(/__CODEX_VISUALIZATION_WIDGET_STATE__/g, '{}');

  // ② 内联 3 个 unpkg 依赖
  let inlined = 0;
  for (const cdn of CDN) {
    const re = new RegExp(`<script[^>]*\\ssrc="https://unpkg\\.com/[^"]*?"[^>]*></script>`, 'g');
    const hits = [...doc.matchAll(re)].filter((m) => cdn.match.test(m[0]));
    for (const h of hits) {
      const js = defuse(fs.readFileSync(path.join(vendorDir, cdn.file), 'utf8'));
      doc = doc.replace(h[0], `<script>${js}</script>`);
      inlined++;
    }
  }

  // ③ 固定暗色主题（页面用 light-dark() + color-scheme 控制）
  doc = doc.replace('</head>', '<style>:root{color-scheme:dark!important}</style>\n</head>');
  // ④ 中文标题
  doc = doc.replace(/<title>[^<]*<\/title>/, `<title>${page.title}</title>`);
  // ⑤ 打上本站标记：宿主页靠它判断"这一页真的加载成功了"，
  //    否则 404 / 浏览器错误页 也有 body，会被误判成成功
  doc = doc.replace('</head>', `<meta name="physlab-view" content="${page.out}">\n</head>`);

  // ⑤ 校验：不能再有外部 src/href
  const ext = [...doc.matchAll(/<(?:script|link|img)[^>]*?(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  if (ext.length) throw new Error(`${page.file} 仍有外部引用:\n  ${ext.join('\n  ')}`);

  fs.writeFileSync(path.join(unitDir, page.out), doc, 'utf8');
  report.push(
    `${page.out.padEnd(16)} ${(doc.length / 1024).toFixed(1).padStart(7)} KB  · 内联 ${inlined} 个依赖` +
    (phCount ? ` · 修占位符 ${phCount}` : '') + ` · 外部引用 0`
  );
}

/* ── 宿主页：三个页签 + 懒加载 iframe ── */
const tabs = PAGES.map(
  (p, i) =>
    `<button class="tab" role="tab" type="button" data-src="./${p.out}" data-title="${esc(p.title)}"` +
    ` aria-selected="${i === 0 ? 'true' : 'false'}">${esc(p.label)}</button>`
).join('\n    ');

const shell = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>声速的测量</title>
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; flex-direction: column;
    background: #0a0e14; color: #dbe4f0;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  .tabs {
    flex: none; display: flex; gap: 6px; padding: 10px 12px;
    border-bottom: 1px solid #1c2433; background: #0d1219;
    overflow-x: auto; scrollbar-width: thin;
  }
  .tab {
    appearance: none; flex: none; cursor: pointer; white-space: nowrap;
    border: 1px solid #253042; background: #121a24; color: #a9b6c8;
    padding: 7px 14px; border-radius: 999px; font: inherit; font-size: 13px;
    transition: background .15s, color .15s, border-color .15s;
  }
  .tab:hover { background: #17202c; color: #dbe4f0; }
  .tab[aria-selected="true"] { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
  .tab:focus-visible { outline: 2px solid #4da3ff; outline-offset: 2px; }
  .stage { position: relative; flex: 1; min-height: 0; }
  .stage iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #0a0e14; }
  .stage iframe[hidden] { display: none; }
  .loading {
    position: absolute; inset: 0; display: grid; place-items: center;
    color: #7d8b9e; font-size: 13px; pointer-events: none; z-index: 2;
  }
  /* 关键：类选择器的 display 会盖过 hidden 属性的 UA 样式，必须显式处理 */
  .loading[hidden] { display: none; }

  /* 加载失败提示（DNS 抖动 / 断网时不再显示浏览器原始错误页）
   * z-index 必须高于后插入的 iframe，否则浮层会被内容盖住 */
  .failed {
    position: absolute; inset: 0; display: none; place-items: center;
    background: #0a0e14; padding: 24px; text-align: center; z-index: 3;
  }
  .failed.show { display: grid; }
  .failed-box { max-width: 420px; }
  .failed-title { color: #dbe4f0; font-size: 15px; font-weight: 600; margin-bottom: 8px; }
  .failed-desc { color: #7d8b9e; font-size: 13px; line-height: 1.7; margin-bottom: 16px; }
  .failed-retry {
    appearance: none; cursor: pointer; font: inherit; font-size: 13px;
    background: #1d4ed8; color: #fff; border: 1px solid #1d4ed8;
    padding: 8px 20px; border-radius: 999px;
  }
  .failed-retry:hover { background: #2563eb; }
</style>
</head>
<body>
  <div class="tabs" role="tablist" aria-label="声速实验视图">
    ${tabs}
  </div>
  <div class="stage" id="stage">
    <div class="loading" id="loading">正在加载…</div>
    <div class="failed" id="failed" role="alert">
      <div class="failed-box">
        <div class="failed-title">内容加载失败</div>
        <div class="failed-desc" id="failed-desc">可能是网络波动导致，点击下方按钮重试。</div>
        <button class="failed-retry" type="button" id="retry">重新加载</button>
      </div>
    </div>
  </div>
<script>
(function () {
  'use strict';
  var stage = document.getElementById('stage');
  var loading = document.getElementById('loading');
  var failed = document.getElementById('failed');
  var failedDesc = document.getElementById('failed-desc');
  var retryBtn = document.getElementById('retry');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var views = {};           // src -> 当前 iframe 及其加载状态
  var activeTab = tabs[0];
  var TIMEOUT_MS = 25000;   // 面板页 500 KB，国内访问偏慢，超时给足余量

  function syncOverlay() {
    var view = views[activeTab.dataset.src];
    loading.hidden = view.state !== 'loading';
    failed.classList.toggle('show', view.state === 'failed');
    if (view.state === 'failed') failedDesc.textContent = view.message;
  }

  function createFrame(src, title, loadSrc) {
    var frame = document.createElement('iframe');
    frame.title = title || '';
    frame.setAttribute('loading', 'eager');
    var view = { frame: frame, state: 'loading' };
    views[src] = view;

    function finish(state, message) {
      // 重试后，旧 iframe 的异步回调不能更新新一轮的状态。
      if (views[src] !== view) return;
      clearTimeout(view.timer);
      view.state = state;
      view.message = message;
      if (activeTab.dataset.src === src) syncOverlay();
    }

    view.timer = setTimeout(function () {
      finish('failed', '加载较慢（超过 25 秒）。网络可能不稳定，可以再等一下或点「重新加载」。');
    }, TIMEOUT_MS);

    frame.addEventListener('load', function () {
      if (views[src] !== view || view.state === 'ok') return;
      // 网络失败时浏览器会渲染自己的错误页 / 404 页——这些页面也有 body，
      // 所以用子页里的本站标记来判断，拿不到标记就当作失败。
      var ok = false;
      try {
        var d = frame.contentDocument;
        ok = !!(d && d.querySelector('meta[name="physlab-view"]'));
      } catch (e) { ok = false; }   // 跨源（浏览器错误页）会抛错
      if (ok) finish('ok');
      else finish('failed', '内容没能加载：域名解析失败或网络中断。请检查网络后点「重新加载」。');
    });
    frame.src = loadSrc || src;
    stage.appendChild(frame);
  }

  function activate(tab) {
    var src = tab.dataset.src;
    activeTab = tab;
    tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t === tab)); });

    if (!views[src]) createFrame(src, tab.dataset.title || tab.textContent);
    Object.keys(views).forEach(function (k) { views[k].frame.hidden = k !== src; });
    syncOverlay();
    document.title = tab.dataset.title || '声速的测量';
  }

  /* 重试：重新载入当前页签，并加时间戳绕过缓存 */
  retryBtn.addEventListener('click', function () {
    var src = activeTab.dataset.src;
    var old = views[src];
    clearTimeout(old.timer);
    old.frame.remove();
    createFrame(src, activeTab.dataset.title || activeTab.textContent, src + '?r=' + Date.now());
    syncOverlay();
  });

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { activate(tab); });
    tab.addEventListener('keydown', function (e) {
      var i = tabs.indexOf(tab);
      var next = e.key === 'ArrowRight' ? tabs[i + 1] : e.key === 'ArrowLeft' ? tabs[i - 1] : null;
      if (!next) return;
      e.preventDefault();
      next.focus();
      activate(next);
    });
  });

  activate(tabs[0]);
})();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(unitDir, 'index.html'), shell, 'utf8');
report.push(`index.html        ${(shell.length / 1024).toFixed(1).padStart(7)} KB  · 3 页签宿主页`);

console.log(report.map((r) => '  ✓ ' + r).join('\n'));
console.log('\n[build-sound] 输出目录:', unitDir);
