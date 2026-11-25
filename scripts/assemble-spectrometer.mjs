#!/usr/bin/env node
/**
 * 把 Codex 产出的 spectrometer preview.html 组装成站点单元。
 *
 * 做三件事：
 *  1. 去掉 3 个 unpkg CDN 依赖（国内不稳定、断网不可用）
 *     · Floating UI core/dom（22 KB）→ 内联（页面 CSP 允许 'unsafe-inline'）
 *     · Lucide（588 KB，实际只用 chevron-left/right 两个图标）→ 用 ~1 KB 的 shim 替代
 *  2. 在 srcdoc 的【转义空间】里做精确替换，不解码整篇（避免动到其他 HTML 实体）
 *  3. 写出 site/units/<slug>/index.html
 *
 * 用法：node scripts/assemble-spectrometer.mjs <preview.html> <vendorDir> <outHtml>
 */
import fs from 'node:fs';

const [srcHtml, vendorDir, outHtml] = process.argv.slice(2);
if (!srcHtml || !vendorDir || !outHtml) {
  console.error('用法: node assemble-spectrometer.mjs <preview.html> <vendorDir> <outHtml>');
  process.exit(1);
}

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 内联脚本里若出现 </script 会提前闭合标签，必须打断 */
const defuse = (js) => js.replace(/<\/script/gi, '<\\/script');

let html = fs.readFileSync(srcHtml, 'utf8');

const core = defuse(fs.readFileSync(vendorDir + '/floating-ui.core.umd.min.js', 'utf8'));
const dom = defuse(fs.readFileSync(vendorDir + '/floating-ui.dom.umd.min.js', 'utf8'));

/* Lucide 极简替代：只实现 createIcons，覆盖页面实际用到的 chevron 图标 */
const lucideShim = `(function () {
  if (window.lucide && window.lucide.createIcons) return;
  var PATHS = {
    'chevron-left': 'm15 18-6-6 6-6',
    'chevron-right': 'm9 18 6-6-6-6',
    'chevron-down': 'm6 9 6 6 6-6',
    'chevron-up': 'm18 15-6-6-6 6'
  };
  function make(name, attrs) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'lucide lucide-' + name);
    var w = (attrs && attrs.width) || 24, h = (attrs && attrs.height) || 24;
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', PATHS[name] || PATHS['chevron-right']);
    svg.appendChild(p);
    return svg;
  }
  window.lucide = {
    createIcons: function (opts) {
      var attrs = opts && opts.attrs;
      var nodes = document.querySelectorAll('[data-lucide]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var name = el.getAttribute('data-lucide');
        if (!name) continue;
        var svg = make(name, attrs);
        if (el.className) svg.setAttribute('class', 'lucide lucide-' + name + ' ' + el.className);
        if (el.parentNode) el.parentNode.replaceChild(svg, el);
      }
    }
  };
})();`;

/* 待替换的三个转义标签（与源文件逐字对应） */
const targets = [
  ['&lt;script src=&quot;https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js&quot;&gt;&lt;/script&gt;',
    '&lt;script&gt;' + esc(core) + '&lt;/script&gt;', 'floating-ui core'],
  ['&lt;script src=&quot;https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js&quot;&gt;&lt;/script&gt;',
    '&lt;script&gt;' + esc(dom) + '&lt;/script&gt;', 'floating-ui dom'],
  ['&lt;script id=&quot;codex-visualization-lucide&quot; async src=&quot;https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js&quot;&gt;&lt;/script&gt;',
    '&lt;script&gt;' + esc(lucideShim) + '&lt;/script&gt;', 'lucide shim'],
];

let report = [];
for (const [from, to, label] of targets) {
  const n = html.split(from).length - 1;
  if (n !== 1) throw new Error(`替换目标 "${label}" 命中 ${n} 次（应为 1），源文件结构已变化`);
  html = html.replace(from, to);
  report.push(`${label}: 内联成功`);
}

/* 校验：srcdoc 属性里不应再有任何外部 src/href */
const OPEN = 'data-srcdoc="';
const a = html.indexOf(OPEN) + OPEN.length;
const b = html.indexOf('"></iframe>', a);
if (a < OPEN.length || b < 0) throw new Error('找不到 data-srcdoc 属性');
const srcdoc = html.slice(a, b);
const ext = [...srcdoc.matchAll(/(?:src|href)=&quot;(https?:[^&]+)&quot;/g)].map((m) => m[1]);
if (ext.length) throw new Error('srcdoc 内仍有外部引用:\n  ' + ext.join('\n  '));
report.push('srcdoc 外部引用: 0');

fs.writeFileSync(outHtml, html, 'utf8');
console.log(report.map((r) => '  ✓ ' + r).join('\n'));
console.log(`\n[assemble] 输出 ${outHtml}`);
console.log(`           源 ${(fs.statSync(srcHtml).size / 1024).toFixed(1)} KB → 目标 ${(fs.statSync(outHtml).size / 1024).toFixed(1)} KB`);
