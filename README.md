# 大学物理实验 · 交互实验站

Kappa1hbar Lab 是面向大学物理实验课程的在线预习与练习平台。实验页提供交互仿真、原理说明和操作步骤，适合课前熟悉仪器、课后复习测量方法。

**[打开在线实验站](https://dongjunfan5-star.github.io/kappa1hbar-lab/)**

## 实验目录

站点收录 26 项实验。首页支持按章节筛选和按关键词搜索，实验卡片和实验页标有建议用时。

| 章节 | 数量 | 实验示例 |
| --- | ---: | --- |
| 力学 | 8 | [驻波实验](https://dongjunfan5-star.github.io/kappa1hbar-lab/unit.html?u=standing-wave) |
| 热学 | 3 | [固体比热容的测量](https://dongjunfan5-star.github.io/kappa1hbar-lab/unit.html?u=solid-specific-heat) |
| 电磁学 | 6 | [数字示波器的原理与使用](https://dongjunfan5-star.github.io/kappa1hbar-lab/unit.html?u=oscilloscope-hardware) |
| 光学 | 6 | [分光计的调整与使用](https://dongjunfan5-star.github.io/kappa1hbar-lab/unit.html?u=spectrometer) |
| 近代物理学实验 | 3 | [氢原子光谱的测量](https://dongjunfan5-star.github.io/kappa1hbar-lab/unit.html?u=atomic-spectra) |

## 本地预览

安装 Node.js 和 npm，即可在仓库根目录运行以下命令。项目没有需要安装的 npm 依赖。

```bash
npm run preview
```

在浏览器打开 [本地预览](http://127.0.0.1:8765/)。`npm run preview` 会先构建再启动服务，也可以按用途单独运行。

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 将站点外壳和实验文件合成到 `dist/`，同时生成实验目录清单 |
| `npm run serve` | 预览已有的 `dist/` |
| `npm run new -- <slug> "实验标题"` | 为未使用的 slug 生成实验目录、元数据和入口页 |

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| [`shell/`](shell/) | 首页目录、实验页外壳和共用样式、脚本 |
| [`units/`](units/) | 按 slug 划分的实验源码，每个实验有独立的入口和素材 |
| [`scripts/`](scripts/) | 构建、预览、实验脚手架及辅助组装脚本 |
| [`dist/`](dist/) | 构建后的静态文件快照，供预览及发布 |
| [`wrangler.toml`](wrangler.toml) | Cloudflare Workers 静态资源配置 |

编辑现有实验从 `units/<slug>/` 入手。新增实验时填写标题、章节、建议用时和简介，再构建预览。字段规则和检查清单见 [实验内容接入](CONTENT-CONTRACT.md)。

## 发布

源码和构建快照存放在 `main`，GitHub Pages 从 `gh-pages` 分支根目录发布。更新网站时，将重新构建的 `dist/` 同步到发布分支。具体步骤见 [部署说明](DEPLOY.md)。
