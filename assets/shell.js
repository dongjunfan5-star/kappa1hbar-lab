/* 外壳逻辑：首页（清单/筛选/搜索）、单元页（iframe 宿主）、左侧实验目录 */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const durationLabel = (minutes) => minutes > 0 ? `建议 ${minutes} 分钟` : '';

  const WIDE = window.matchMedia('(min-width: 1200px)');
  const icons = {
    close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12m0-12L6 18"/></svg>',
    forward: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>',
    back: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6-6 6 6 6m-6-6h16"/></svg>',
  };

  async function loadManifest() {
    const res = await fetch('./units/manifest.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('units/manifest.json 不存在，请先执行 npm run build');
    return res.json();
  }

  function fatal() {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="fatal" role="alert">
         <h1>实验清单加载失败</h1>
         <p>请检查网络后刷新页面。</p>
       </div>`
    );
  }

  /* ───────────── 左侧实验目录 ───────────── */
  function sidebarHTML(manifest, activeSlug, isUnitPage) {
    const items = (manifest && Array.isArray(manifest.items)) ? manifest.items : [];

    const back = isUnitPage
      ? `<div class="sb-group sb-back-group"><a class="sb-link sb-link-back" href="./">${icons.back}<span>全部实验</span></a></div>`
      : '';

    if (!items.length) {
      const msg = manifest ? '暂无实验内容' : '实验清单加载失败';
      const hint = manifest ? '' : '<div class="sb-hint">请检查网络后刷新页面</div>';
      return back + `<div class="sb-empty">${esc(msg)}${hint}</div>`;
    }

    const chapters = (manifest.chapters && manifest.chapters.length)
      ? manifest.chapters
      : [...new Set(items.map((i) => i.chapter))];

    const groups = chapters
      .map((ch) => {
        const list = items.filter((i) => i.chapter === ch);
        if (!list.length) return '';
        const links = list
          .map((it) => {
            const cur = it.slug === activeSlug ? ' aria-current="page"' : '';
            return `<li><a class="sb-link" href="./unit.html?u=${encodeURIComponent(it.slug)}"${cur} title="${esc(it.title)}">${esc(it.title)}</a></li>`;
          })
          .join('');
        return `<div class="sb-group"><div class="sb-chapter">${esc(ch)}</div><ul class="sb-list">${links}</ul></div>`;
      })
      .join('');

    return back + groups;
  }

  function initShell(manifest) {
    const sidebar = $('#sidebar');
    const scrim = $('#scrim');
    const toggle = $('#nav-toggle');
    if (!sidebar) return;

    const isUnitPage = !!$('#frame');
    const activeSlug = new URLSearchParams(location.search).get('u') || '';
    sidebar.innerHTML =
      `<div class="sb-head">
         <div class="sb-title">实验目录</div>
         <button class="btn btn-ghost sb-close" id="sb-close" type="button" aria-label="关闭目录">${icons.close}</button>
       </div>` +
      sidebarHTML(manifest, activeSlug, isUnitPage);
    const close = $('#sb-close');
    const outside = document.querySelectorAll('.topbar, .main');

    function setOpen(open) {
      const wasOpen = document.body.classList.contains('nav-open');
      document.body.classList.toggle('nav-open', open);
      if (toggle) toggle.setAttribute('aria-expanded', String(open));
      if (scrim) scrim.hidden = !open;
      outside.forEach(element => { element.inert = open; });
      if (open) close?.focus();
      else if (wasOpen && !WIDE.matches) toggle?.focus();
    }

    if (toggle) toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('nav-open')));
    if (scrim) scrim.addEventListener('click', () => setOpen(false));
    if (close) close.addEventListener('click', () => setOpen(false));

    document.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('nav-open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        e.stopPropagation();
      }
      if (e.key === 'Tab') {
        const links = sidebar.querySelectorAll('button, a[href]');
        const first = links[0];
        const last = links[links.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }, true);

    // 切到宽屏时收起抽屉状态，避免残留 class
    const onChange = () => { if (WIDE.matches) setOpen(false); };
    if (WIDE.addEventListener) WIDE.addEventListener('change', onChange);
    else if (WIDE.addListener) WIDE.addListener(onChange);
  }

  /* ───────────── 首页 ───────────── */
  function initIndex(manifest) {
    const items = manifest.items || [];
    const grid = $('#grid');
    const chips = $('#chips');
    const q = $('#q');
    const empty = $('#empty');
    const count = $('#catalog-count');
    let activeChapter = '全部';

    $('#foot-meta').textContent = manifest.generatedAt
      ? `目录更新于 ${new Date(manifest.generatedAt).toLocaleDateString('zh-CN')}`
      : '';

    const chapters = ['全部', ...(manifest.chapters || [])];
    chips.innerHTML = chapters
      .map(
        (c) =>
          `<button class="chip" type="button" data-chapter="${esc(c)}" aria-pressed="${c === activeChapter}">${esc(c)}</button>`
      )
      .join('');
    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      activeChapter = btn.dataset.chapter;
      chips.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      render();
    });

    function cardHTML(it, index) {
      const cover = it.cover
        ? `<img src="./${esc(it.cover)}" alt=""${index < 3 ? '' : ' loading="lazy"'}>`
        : '<span class="ph">暂无仪器图</span>';
      const tags = (it.tags || []).filter(tag => tag !== '仿真实验').slice(0, 3)
        .map((tag) => `<span class="tag">${esc(tag)}</span>`).join('');
      const time = durationLabel(it.duration);
      const duration = time ? `<span class="card-duration">${esc(time)}</span>` : '';
      return `<a class="card" href="./unit.html?u=${encodeURIComponent(it.slug)}">
        <div class="card-cover">${cover}</div>
        <div class="card-body">
          <div class="card-meta"><span class="card-chapter">${esc(it.chapter)}${it.interactive ? '' : ' · 阅读'}</span>${duration}</div>
          <h2 class="card-title"><span>${esc(it.title)}</span>${icons.forward}</h2>
          ${it.summary ? `<p class="card-summary">${esc(it.summary)}</p>` : ''}
          ${tags ? `<div class="card-foot">${tags}</div>` : ''}
        </div>
      </a>`;
    }

    function render() {
      const kw = (q.value || '').trim().toLowerCase();
      const list = items.filter((it) => {
        if (activeChapter !== '全部' && it.chapter !== activeChapter) return false;
        if (!kw) return true;
        const hay = [it.title, it.summary, it.chapter, (it.tags || []).join(' '), it.slug].join(' ').toLowerCase();
        return hay.includes(kw);
      });
      grid.innerHTML = list.map(cardHTML).join('');
      count.textContent = `${list.length} 项实验`;
      empty.hidden = list.length !== 0;
    }

    q.addEventListener('input', render);
    render();
    if (items.length === 0) empty.hidden = false;
  }

  /* ───────────── 单元页（iframe 宿主） ───────────── */
  function initUnit(manifest) {
    const slug = new URLSearchParams(location.search).get('u');
    const item = (manifest.items || []).find((i) => i.slug === slug);
    const frame = $('#frame');
    const loading = $('#loading');

    if (!item) {
      $('#title').textContent = '未找到该实验';
      loading.innerHTML = '<p>没有找到该实验。</p><a href="./">返回全部实验</a>';
      $('#open').hidden = true;
      $('#fs').hidden = true;
      return;
    }

    document.title = `${item.title} · 物理实验交互站`;
    $('#title').textContent = item.title;
    const time = durationLabel(item.duration);
    $('#meta').innerHTML = [
      item.chapter && `<span class="unit-meta-context">${esc(item.chapter)}</span>`,
      time && `<span class="unit-duration">${esc(time)}</span>`,
      item.author && `<span class="unit-meta-context">${esc(item.author)}</span>`,
    ].filter(Boolean).join('<span class="unit-meta-context"> · </span>');

    const src = `./${item.entryUrl}`;
    $('#open').href = src;
    const dataProcessingLink = $('#data-processing');
    if (dataProcessingLink) dataProcessingLink.href = `./data-processing/index.html?from=${encodeURIComponent(item.slug)}`;
    frame.addEventListener('load', () => {
      loading.hidden = true;
      try {
        const inner = frame.contentDocument && frame.contentDocument.title;
        if (inner) document.title = `${inner} · 物理实验交互站`;
      } catch (_) { /* 跨源时忽略 */ }
    });
    frame.src = src;

    const stage = $('#stage');
    const fullscreen = $('#fs');
    const exitFullscreen = $('#exit-fs');
    async function closeFullscreen() {
      if (document.fullscreenElement) {
        try { await document.exitFullscreen(); } catch (_) { return; }
      }
      document.body.classList.remove('pseudo-fs');
      fullscreen.focus();
    }
    exitFullscreen.addEventListener('click', closeFullscreen);
    fullscreen.addEventListener('click', async () => {
      if (document.fullscreenElement) {
        await closeFullscreen();
        return;
      }
      try {
        await stage.requestFullscreen();
      } catch (_) {
        document.body.classList.add('pseudo-fs');
      }
      exitFullscreen.focus();
    });

    // 内容侧可选桥接消息
    window.addEventListener('message', (ev) => {
      if (ev.source !== frame.contentWindow || ev.origin !== window.location.origin) return;
      const d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'physlab:title' && typeof d.title === 'string' && d.title.trim()) {
        $('#title').textContent = d.title;
        document.title = `${d.title} · 物理实验交互站`;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (document.fullscreenElement === stage || document.body.classList.contains('pseudo-fs'))) {
        e.preventDefault();
        closeFullscreen();
        return;
      }
      if (e.key === 'Escape' && !document.fullscreenElement && !document.body.classList.contains('nav-open')) {
        if (history.length > 1) history.back();
      }
    });
  }

  function boot(manifest) {
    initShell(manifest);
    if ($('#grid')) initIndex(manifest);
    else if ($('#frame')) initUnit(manifest);
  }

  function degrade() {
    initShell(null); // 边栏降级为空状态
    if ($('#grid')) {
      fatal();
    } else if ($('#frame')) {
      $('#title').textContent = '加载失败';
      $('#loading').textContent = '实验清单加载失败，请稍后刷新重试。';
    }
  }

  loadManifest().then(boot).catch(degrade);
})();
