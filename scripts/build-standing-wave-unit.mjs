#!/usr/bin/env node
/**
 * 把 Codex 的「驻波实验 · 整节学习」整页组装成站点单元。
 *
 * 输入：实验平台创建\驻波实验\驻波实验完整学习.html
 *   · 本身是独立整页（没有 data-srcdoc 包裹层），8 个章节 + 5 个 srcdoc 内嵌交互
 *   · 零外部依赖（已验证 unpkg / jsdelivr / cdnjs / fonts 全为 0）
 *   · 主题用 light-dark() + prefers-color-scheme，没有切换按钮
 *
 * 只做一件事：把外层与 5 个内嵌 srcdoc 都固定为暗色（站点外壳是暗色）。
 *
 * 用法：node build-standing-wave-unit.mjs <源html> <输出单元目录>
 */
import fs from 'node:fs';
import path from 'node:path';

const [srcHtml, unitDir] = process.argv.slice(2);
if (!srcHtml || !unitDir) {
  console.error('用法: node build-standing-wave-unit.mjs <源html> <输出单元目录>');
  process.exit(1);
}

const DARK_CSS = ':root{color-scheme:dark}';
const DARK_OUTER = `<style>/* 站点固定暗色 */${DARK_CSS}</style>`;
const DARK_INNER_ESCAPED = `&lt;style&gt;${DARK_CSS}&lt;/style&gt;`;

let html = fs.readFileSync(srcHtml, 'utf8');
const before = html.length;

/* ① 外层文档：在第一个 </head> 前注入 */
const outerClose = html.indexOf('</head>');
if (outerClose < 0) throw new Error('外层文档缺少 </head>');
html = html.slice(0, outerClose) + DARK_OUTER + html.slice(outerClose);

/* ② 5 个内嵌 srcdoc：其 <head> 以转义形式出现 */
const innerCount = (html.match(/&lt;\/head&gt;/g) || []).length;
html = html.replace(/&lt;\/head&gt;/g, `${DARK_INNER_ESCAPED}&lt;/head&gt;`);

/* ③ 校验：仍然零外部依赖 */
const ext = [...html.matchAll(/<(?:script|link|img)[^>]*?(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
const extEscaped = [...html.matchAll(/(?:src|href)=&quot;(https?:[^&]+)&quot;/g)].map((m) => m[1]);
if (ext.length || extEscaped.length) {
  throw new Error('仍有外部资源引用:\n  ' + [...ext, ...extEscaped].join('\n  '));
}

/* ④ 章节标题：用于 meta 与页面标题校验 */
const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';

fs.writeFileSync(path.join(unitDir, 'index.html'), html, 'utf8');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('  ✓ index.html        ' + kb(html.length).padStart(9) + `  · 外层暗色 1 处 · 内嵌暗色 ${innerCount} 处 · 外部引用 0`);
console.log('  ✓ 页面标题           ' + title);
console.log(`\n[build-standing-wave] ${kb(before)} → ${kb(html.length)}  输出: ${unitDir}`);
