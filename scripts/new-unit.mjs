#!/usr/bin/env node
/**
 * 新建一个单元骨架：node scripts/new-unit.mjs <slug> ["标题"]
 * 生成 units/<slug>/{meta.json,index.html} 并打印接入说明。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const title = process.argv[3] || (slug ? slug : '');

if (!slug) {
  console.error('用法: node scripts/new-unit.mjs <slug> ["标题"]');
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error('slug 只能用小写字母、数字、连字符，例如 spectrometer-alignment');
  process.exit(1);
}

const dir = path.join(root, 'units', slug);
await mkdir(dir, { recursive: true });

const meta = {
  title,
  chapter: '未分类',
  summary: '',
  tags: [],
  level: 1,
  duration: 120,
  updated: new Date().toISOString().slice(0, 10),
  entry: 'index.html',
  interactive: true,
  author: '',
  cover: '',
};
await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    html,body{margin:0;height:100%;background:#0d1117;color:#e6ecf5;
      font:15px/1.7 "PingFang SC","Microsoft YaHei",system-ui,sans-serif}
    main{max-width:860px;margin:0 auto;padding:48px 24px}
    h1{font-size:26px;margin:0 0 8px}
    p{color:#8b98ab}
    code{background:#1b2330;padding:2px 6px;border-radius:5px;font-size:13px}
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>这是 <code>${slug}</code> 单元的入口页。把你的 HTML / JS / 素材放进本目录即可。</p>
    <p>入口文件名默认 <code>index.html</code>，可在 <code>meta.json</code> 的 <code>entry</code> 字段改。</p>
  </main>
</body>
</html>
`;
await writeFile(path.join(dir, 'index.html'), html, 'utf8');

console.log(`[new] units/${slug}/`);
console.log('下一步：把内容放进去 → npm run build → npm run serve');
