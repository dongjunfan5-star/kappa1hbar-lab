# 部署说明

在仓库根目录执行 `npm run build`，生成可直接托管的静态文件 `dist/`。Node.js 用于构建和本地预览。

## GitHub Pages

线上站点从 `gh-pages` 分支的根目录发布。仓库的 **Settings → Pages** 设置为 **Deploy from a branch → gh-pages → / (root)**。站点以相对路径加载资源，适用于 `/kappa1hbar-lab/` 子路径。

1. 在 `main` 的仓库根目录执行 `npm run build`，再执行 `npm run serve` 预览。
2. 将源文件与本次构建的 `dist/` 快照一并提交到 `main`。构建会重建 `dist/`，如果空文件 `dist/.nojekyll` 被清除，可用 `git restore -- dist/.nojekyll` 恢复。
3. 将 `dist/` **内部的文件**同步到 `gh-pages` 分支根目录。确认根目录有 `index.html`、`unit.html`、`assets/`、`units/` 和空文件 `.nojekyll`。同步后应清理已从产物中移除的旧文件。
4. 推送 `gh-pages`，在仓库的 [Actions](https://github.com/dongjunfan5-star/kappa1hbar-lab/actions) 查看发布结果。部署成功后，打开首页和至少一个实验，确认目录、封面和仿真页均能加载。

可在 `main` 根目录用 `git worktree add ../kappa1hbar-lab-pages gh-pages` 建立单独的发布目录。同步静态文件时保留该目录的 `.git` 工作树指针。

[GitHub Pages 发布源官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 分享实验

- 首页使用 [实验站地址](https://dongjunfan5-star.github.io/kappa1hbar-lab/)。
- 单个实验使用 `unit.html?u=<slug>`，例如 [数字示波器的原理与使用](https://dongjunfan5-star.github.io/kappa1hbar-lab/unit.html?u=oscilloscope-hardware)。
- 支持 iframe 的教学平台可嵌入完整实验地址，下面是一个嵌入示例。

```html
<iframe
  src="https://dongjunfan5-star.github.io/kappa1hbar-lab/unit.html?u=oscilloscope-hardware"
  title="数字示波器的原理与使用"
  style="width: 100%; height: 720px; border: 0"
  allowfullscreen
></iframe>
```

## 其他静态托管方式

- **Cloudflare Workers**。仓库的 `wrangler.toml` 指向 `dist/`。配置好自己的 Workers 项目后，从仓库根目录执行 `npm run build` 和 `npx wrangler deploy`。
- **Cloudflare Pages 或 Vercel**。可上传 `dist/` 中的静态文件，或连接仓库，以 `npm run build` 为构建命令，输出目录为 `dist`。
- **自有服务器**。将 `dist/` 内的文件同步到站点目录，并配置静态文件服务。下面是一个 Nginx 示例。

```nginx
server {
    listen 80;
    server_name physlab.example.edu.cn;
    root /var/www/physlab;
    index index.html;

    location / { try_files $uri $uri/ =404; }
}
```
