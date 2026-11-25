# 内容接入契约（给 Codex / 内容作者）

**一句话**：把一整套静态文件（HTML + JS + 素材）放进 `units/<slug>/`，跑一次构建，它就出现在站点上。

不需要改外壳代码，不需要打包，不需要框架。

---

## 1. 目录规则

```
units/
├── <slug>/                 ← 一个实验 = 一个目录
│   ├── meta.json           ← 元数据（可选，但强烈建议）
│   ├── index.html          ← 入口页（默认名，可在 meta.json 改）
│   ├── cover.png           ← 卡片封面（可选，16:9 最好）
│   └── ...                 ← 你的 JS / CSS / 图片 / glTF / wasm，随便放
└── _template/              ← 下划线开头 = 构建时跳过（放模板/草稿）
```

**slug 命名**：只允许小写字母、数字、连字符，例：`spectrometer-alignment`。
**下划线或点开头的目录不会被收录**，适合放草稿。

```bash
node scripts/new-unit.mjs oscilloscope-basics "示波器的原理与使用"
```

---

## 2. `meta.json` 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | 建议 | 卡片与页面标题。缺省用目录名 |
| `chapter` | string | 建议 | 章节，用于筛选。如 `光学`、`电磁学` |
| `summary` | string | 可选 | 一两句简介，卡片上显示 |
| `tags` | string[] | 可选 | 关键词，参与搜索 |
| `level` | 1 \| 2 \| 3 | 可选 | 难度 |
| `duration` | number | 可选 | 建议学时（分钟） |
| `updated` | `YYYY-MM-DD` | 可选 | 更新时间 |
| `author` | string | 可选 | 作者/维护者 |
| `cover` | string | 可选 | 封面图文件名，相对本目录，如 `cover.png` |
| `entry` | string | 可选 | 入口文件名，默认 `index.html` |
| `interactive` | boolean | 可选 | 是否含交互，默认 `true`，会在卡片上标「可交互」 |

最小可用：

```json
{ "title": "示波器的原理与使用", "chapter": "电磁学" }
```

---

## 3. 硬性要求（踩了就白屏）

1. **所有资源用相对路径**。页面运行在 `/units/<slug>/` 下，`<script src="./main.js">` ✅，`src="/main.js"` ❌。
2. **不要引用本目录之外的文件**（外壳不会替你转发）。第三方库请把文件下载到本目录内，不要依赖 CDN —— 部署到内网/断网环境会挂。
3. **不要用 `file://` 假设**，一切走 HTTP。
4. **入口是普通 HTML 页面**，不要要求特殊构建步骤（真需要构建，就在交付前把产物静态化）。
5. **不要覆盖页面根滚动行为之外的东西**（不要 `top:0;position:fixed` 全屏浮层盖住外壳顶栏，除非你不用顶栏 —— 全屏请看第 4 节）。
6. 文件名避免空格与中文（部署到某些 CDN 会有编码问题）。

---

## 4. 可选桥接（不加也能完整使用）

在 `index.html` 里加一行：

```html
<script src="../assets/bridge.js"></script>
```

> 注意路径：从 `units/<slug>/` 到外壳资源是 `../assets/bridge.js`。

提供的能力：

```js
window.physlab.setTitle('自定义标题');  // 改写外壳顶栏标题
window.physlab.fullscreen();            // 请求外壳把 iframe 全屏
```

不加这个脚本，一切照常工作，只是标题取 `<title>`、全屏用外壳顶栏的按钮。

---

## 5. 建议（影响观感，不影响能否跑）

- **响应式**：外壳在手机上会变成单列，内容宽度建议 `max-width: 860–1000px` 并居中。
- **深色背景**：外壳是深色 (#0d1117)，内容页背景用近似的深色最协调。
- **字号**：正文 15–16px，行高 1.6–1.7。
- **交互可访问**：所有动画尊重 `prefers-reduced-motion`；不要只靠 hover 才能操作。
- **首屏别太重**：单页 JS 超过 ~1MB 会明显卡；大模型/大图请懒加载。
- **Canvas/WebGL**：需要处理 `devicePixelRatio`，否则高 DPI 屏会糊。

---

## 6. 自检清单（交付前跑一遍）

```bash
cd site
node scripts/build.mjs      # 看输出里有没有你的单元
node scripts/serve.mjs      # 打开 http://127.0.0.1:8765/
```

- [ ] 首页出现卡片，章节筛选和搜索能找到它
- [ ] 点进去，交互图能操作、没有控制台报错
- [ ] 手机宽度（DevTools 375px）不横向滚动
- [ ] 断网/内网环境下也能跑（没有 CDN 依赖）
- [ ] `meta.json` 的 title/chapter 正确
