#!/usr/bin/env node
/**
 * 构建：把 shell/ 与 units/ 合成可部署的 dist/，并自动生成单元清单。
 *
 * 规则：
 *   - units/<slug>/ 每个目录 = 一个实验单元
 *   - 目录名以 _ 或 . 开头则跳过（草稿/模板）
 *   - units/<slug>/meta.json 可选，缺省从目录名推断
 *   - 产出 dist/units/manifest.json 供外壳读取
 */
import { readdir, readFile, writeFile, mkdir, cp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shellDir = path.join(root, 'shell');
const unitsDir = path.join(root, 'units');
const distDir = path.join(root, 'dist');

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

if (!(await exists(shellDir))) throw new Error('缺少 shell/ 目录');
if (!(await exists(unitsDir))) { await mkdir(unitsDir, { recursive: true }); }

await cp(shellDir, distDir, { recursive: true });
await cp(unitsDir, path.join(distDir, 'units'), { recursive: true });

const entries = await readdir(unitsDir, { withFileTypes: true });
const slugs = entries
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
  .map((d) => d.name);

const items = [];
const textbookOrder = new Map();
for (const slug of slugs) {
  const metaPath = path.join(unitsDir, slug, 'meta.json');
  let meta = {};
  if (await exists(metaPath)) {
    try { meta = JSON.parse(await readFile(metaPath, 'utf8')); }
    catch (e) { console.warn(`[warn] ${slug}/meta.json 解析失败：${e.message}`); }
  }
  const entry = meta.entry || 'index.html';
  if (!(await exists(path.join(unitsDir, slug, entry)))) {
    console.warn(`[skip] ${slug}/ 缺少入口文件 ${entry}`);
    continue;
  }
  if (Number.isSafeInteger(meta.order)) textbookOrder.set(slug, meta.order);
  items.push({
    slug,
    title: meta.title || slug,
    chapter: meta.chapter || '未分类',
    summary: meta.summary || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    level: meta.level ?? null,
    duration: meta.duration ?? null,
    updated: meta.updated || null,
    author: meta.author || '',
    cover: meta.cover ? `units/${slug}/${meta.cover}` : null,
    entry,
    entryUrl: `units/${slug}/${entry}`,
    interactive: meta.interactive !== false,
  });
}

// Textbook chapter order, followed by any additional chapters.
const chapterSequence = ['力学', '热学', '电磁学', '光学', '近代物理学实验'];
const availableChapters = new Set(items.map((i) => i.chapter));
const chapterOrder = [
  ...chapterSequence.filter(chapter => availableChapters.delete(chapter)),
  ...[...availableChapters].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
];
const unitOrder = item => textbookOrder.get(item.slug) ?? Number.MAX_SAFE_INTEGER;
items.sort(
  (a, b) =>
    chapterOrder.indexOf(a.chapter) - chapterOrder.indexOf(b.chapter) ||
    unitOrder(a) - unitOrder(b) ||
    String(a.title).localeCompare(String(b.title), 'zh-Hans-CN')
);

const manifest = {
  site: '大学物理实验 · 交互实验站',
  generatedAt: new Date().toISOString(),
  count: items.length,
  chapters: chapterOrder,
  items,
};
await writeFile(path.join(distDir, 'units', 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`[build] ${items.length} 个单元 → dist/`);
for (const i of items) console.log(`        · ${i.chapter} / ${i.title}  (${i.slug})`);
