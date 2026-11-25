# 部署上线（让所有人能访问）

产物是 `dist/` —— **纯静态、零依赖、无需 Node 运行时**。任何静态托管都能放。

```bash
cd site
npm run build      # 生成 dist/
```

---

## 方案 A：Cloudflare Pages（推荐，免费、国内访问尚可、无限带宽）

### A1. 图形界面直传（最快，2 分钟）
1. 打开 <https://dash.cloudflare.com/?to=/:account/workers-and-pages>
2. **Create → Pages → Upload assets**
3. 项目名填 `physlab`（决定默认域名 `physlab.pages.dev`）
4. 把 **`dist/` 目录里的内容**（不是 `dist` 本身）拖进去 → Deploy
5. 得到 `https://physlab.pages.dev` —— 这就是"所有人能看"的地址

> 更新内容：重新 `npm run build`，再拖一次新的 `dist/`（会覆盖为新部署）。

### A2. 连 Git（推荐长期维护）
1. 把整个 `site/` 推到一个 GitHub 仓库
2. Pages → **Connect to Git** → 选仓库
3. 构建设置：
   - Framework preset：`None`
   - Build command：`npm run build`
   - Build output directory：`dist`
4. 以后每次 `git push` 自动重新部署

---

## 方案 B：Vercel

```bash
npm i -g vercel      # 或用 npx vercel
cd site
npx vercel --prod
```

按提示走，Output Directory 填 `dist`（Vercel 会自动识别静态站）。
或在 <https://vercel.com/new> 导入 Git 仓库，配置同上。

---

## 方案 C：GitHub Pages（子路径部署）

外壳全用相对路径，**可以**部署在 `https://<user>.github.io/<repo>/` 子路径下。

本站配置为从 `gh-pages` 分支的根目录发布，访问 <https://dongjunfan5-star.github.io/kappa1hbar-lab/>。

1. 在 `main` 分支运行 `npm run build`。
2. 将 `dist/` 内的文件同步到 `gh-pages` 分支根目录，保留空文件 `.nojekyll`。
3. 提交并推送 `gh-pages` 分支。GitHub Pages 会重新发布。

---

## 方案 D：自有服务器（国内校园网最稳）

```bash
npm run build
scp -r dist/* user@server:/var/www/physlab/
```

nginx：

```nginx
server {
    listen 80;
    server_name physlab.example.edu.cn;
    root /var/www/physlab;
    index index.html;

    # 带哈希的静态资源长缓存
    location ~* \.(js|css|png|jpg|jpeg|webp|avif|svg|woff2|glb|gltf|wasm)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    # HTML 与 manifest 不缓存，保证更新即时生效
    location ~* \.(html|json)$ {
        add_header Cache-Control "no-cache";
    }
    location / { try_files $uri $uri/ /index.html; }
}
```

---

## 自定义域名

- **Cloudflare Pages**：Custom domains → 添加 `physlab.yourdomain.com` → 按提示加 CNAME。
- **Vercel**：Settings → Domains。
- **国内备案**：若用 `.cn` 域名或国内服务器，需 ICP 备案；校内服务器一般走学校统一域名。

---

## 访问与分享

上线后建议：

| 用途 | 链接 |
|---|---|
| 首页 | `https://physlab.pages.dev/` |
| 单个实验 | `https://physlab.pages.dev/unit.html?u=oscilloscope-basics` |
| 直接嵌 PPT / 教学平台 | `<iframe src="https://physlab.pages.dev/unit.html?u=xxx" style="width:100%;height:720px;border:0"></iframe>` |

**单实验链接可以直接发给学生**，也能被别的平台用 iframe 嵌入 —— 这是 iframe 宿主架构的附带好处。

---

## 更新流程（内容上线后）

```bash
# 1. Codex 往 units/<slug>/ 里放内容
# 2. 本地自检
npm run build && npm run serve
# 3. 部署
#    Cloudflare 直传：重新拖 dist/
#    Git 自动部署：git push
```

---

## 注意事项

- **首次访问慢**：Pages 免费版冷启动 + 大素材会有延迟；把大图压到 AVIF/WebP、大模型转 Draco。
- **国内访问**：`*.pages.dev` 在国内时快时慢；如果面向校内，方案 D 更稳。
- **不要放敏感内容**：Pages 默认公开、可被搜索引擎索引。需要限制访问请改用带鉴权的服务器。
