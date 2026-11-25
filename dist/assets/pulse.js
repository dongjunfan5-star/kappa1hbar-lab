/* 随机折线电流（站点外壳背景层）
 *
 * 形态：起点突然出现 → 沿「带折角的两段折线」迅速传播 → 在终点消失。
 *
 * 为什么需要 JS：
 *   ① CSS 没有随机函数，无法随机起点/方向/转折点；
 *   ② CSS 读不到「折线终点是否压在扫描线上」这种几何关系；
 *   ③ 折线的两段朝向不同，纯 CSS 关键帧无法按随机角度拼出折角。
 *   所以 JS 只做「决策」：算点、算角度、写入 CSS 变量；
 *   真正的动画全部是 CSS 的 transform / opacity（合成层，无逐帧主线程动画）。
 *
 * 关键几何（与 shell.css 的 body::before 严格对应）：
 *   电流层 position:fixed; inset:-30% -8%；
 *   条纹周期 192px，亮线位于图层内 y ∈ [86, 89]；
 *   current：translate3d(0,0,0) → translate3d(-40px,-192px,0)，7.2s linear infinite
 *   ⇒ 某时刻扫描线的视口 Y = 86 + 192k - 0.30*innerHeight - 192*phase
 */
(function () {
  'use strict';

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (window.__physlabPulse) return;
  window.__physlabPulse = true;

  var PERIOD = 192;          // 条纹周期
  var LINE_Y = 86;           // 亮线在图层内的起点
  var LOOP_MS = 7200;        // current 动画时长
  var SHIFT = 192;           // 纵向位移（= 一个周期 → 无缝）
  var TRAVEL_MS = 420;       // 与 .bolt-spark / .bolt-seg 的动画时长一致
  var BURST = /[?&]pulse=burst\b/.test(location.search); // 调试：高频 + 必命中

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ── 量出电流层真实的顶边与高度 ──
   * 注意：body::before 用的是 repeating-linear-gradient(0deg, ...)，
   * 0deg 表示「向上」，色标从【图层底边】开始计量。
   * 所以第一条亮线距底边 86px，而不是距顶边 86px。 */
  var layerTop = null;
  var layerH = null;
  function measureLayer() {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;inset:-30% -8%;opacity:0;pointer-events:none;z-index:-9';
    document.body.appendChild(probe);
    var r = probe.getBoundingClientRect();
    layerTop = r.top;
    layerH = r.height;
    probe.remove();
  }

  /* 读取 current 的当前相位，保证与扫描线严格同步 */
  function phaseMs() {
    var list = document.getAnimations ? document.getAnimations() : [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.animationName === 'current' && typeof a.currentTime === 'number') {
        return ((a.currentTime % LOOP_MS) + LOOP_MS) % LOOP_MS;
      }
    }
    return 0;
  }

  /* 返回最靠近 y 的那条扫描线的视口 Y */
  function nearestLineY(y, t) {
    if (layerTop === null || layerH === null) measureLayer();
    var frac = (t % LOOP_MS) / LOOP_MS;
    // 距底边 86px 的那条线（随动画上移 SHIFT*frac）
    var fromBottom = layerTop + layerH - LINE_Y - SHIFT * frac;
    var k = Math.round((fromBottom - y) / PERIOD);
    return fromBottom - k * PERIOD;
  }

  /* ── 落点：避开内容卡片（.stage / .wrap），否则永远被挡住看不见 ── */
  function contentRect() {
    var el = document.querySelector('.stage') || document.querySelector('.wrap');
    return el ? el.getBoundingClientRect() : null;
  }

  function insideCard(x, y, rect) {
    if (!rect) return false;
    var p = 18;
    return x > rect.left - p && x < rect.right + p && y > rect.top - p && y < rect.bottom + p;
  }

  function pickStart(rect) {
    var W = window.innerWidth, H = window.innerHeight;
    for (var i = 0; i < 14; i++) {
      var x = 30 + Math.random() * Math.max(1, W - 60);
      var y = 60 + Math.random() * Math.max(1, H - 120);
      if (!insideCard(x, y, rect)) return { x: x, y: y };
    }
    // 兜底：左侧目录区
    return {
      x: 24 + Math.random() * Math.max(1, Math.min(300, W * 0.2)),
      y: 80 + Math.random() * Math.max(1, H - 160)
    };
  }

  function clampPt(p, m) {
    return {
      x: Math.min(Math.max(p.x, m), window.innerWidth - m),
      y: Math.min(Math.max(p.y, m), window.innerHeight - m)
    };
  }

  function addBend(x, y) {
    var b = document.createElement('div');
    b.className = 'bend';
    b.style.left = x + 'px';
    b.style.top = y + 'px';
    document.body.appendChild(b);
    b.addEventListener('animationend', function () { b.remove(); });
    window.setTimeout(function () { if (b.parentNode) b.remove(); }, 600);
  }

  function addSeg(x, y, len, angDeg, late) {
    var s = document.createElement('div');
    s.className = 'bolt-seg' + (late ? ' late' : '');
    s.style.left = x + 'px';
    s.style.top = (y - 1) + 'px';          // 2px 高度 → 居中对齐
    s.style.width = Math.max(2, len) + 'px';
    s.style.transform = 'rotate(' + angDeg + 'deg)';
    document.body.appendChild(s);
    s.addEventListener('animationend', function () { s.remove(); });
    window.setTimeout(function () { if (s.parentNode) s.remove(); }, 700);
    return s;
  }

  function deg(a) { return (a * 180) / Math.PI; }
  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  function spawn() {
    if (reduced.matches || document.hidden) return;

    var t = phaseMs();
    var rect = contentRect();
    var raw = pickStart(rect);
    var M = 18;                                   // 视口安全边距
    var start = clampPt(raw, M);

    // ① 起点命中扫描线？→ 起点处弯一下
    var hitStart = BURST ? true : Math.random() < 0.5;
    if (hitStart) start.y = nearestLineY(start.y, t);

    // ② 随机第一段方向与长度（贴边被裁短就换个方向重试，避免第一段消失）
    var ang1 = Math.random() * Math.PI * 2;
    var leg1 = 60 + Math.random() * 95;           // 60–155px
    var bend = clampPt({ x: start.x + Math.cos(ang1) * leg1, y: start.y + Math.sin(ang1) * leg1 }, M);
    for (var i = 0; i < 4 && dist(start, bend) < 45; i++) {
      ang1 = Math.random() * Math.PI * 2;
      bend = clampPt({ x: start.x + Math.cos(ang1) * leg1, y: start.y + Math.sin(ang1) * leg1 }, M);
    }

    // ③ 随机折角（25°–75°）与第二段长度；被视口裁得太短就反折重试
    var turn = (0.44 + Math.random() * 0.87) * (Math.random() < 0.5 ? -1 : 1);
    var leg2 = 45 + Math.random() * 75;           // 45–120px
    var ang2 = ang1 + turn;
    var end = clampPt({ x: bend.x + Math.cos(ang2) * leg2, y: bend.y + Math.sin(ang2) * leg2 }, M);
    for (var j = 0; j < 4 && dist(bend, end) < 35; j++) {
      turn = -turn * 0.85;
      ang2 = ang1 + turn;
      end = clampPt({ x: bend.x + Math.cos(ang2) * leg2, y: bend.y + Math.sin(ang2) * leg2 }, M);
    }

    // ④ 终点是否压到扫描线？压到就把终点吸附过去（用到达时刻的相位算）
    var hitEnd = BURST ? true : Math.random() < 0.45;
    if (hitEnd) {
      var tArrive = (t + TRAVEL_MS * 0.94) % LOOP_MS;
      end.y = Math.min(Math.max(nearestLineY(end.y, tArrive), M), window.innerHeight - M);
    }

    // ⑤ 用「实际落点」反算两段朝向（保证画的线与光点轨迹完全重合）
    var a1 = Math.atan2(bend.y - start.y, bend.x - start.x);
    var a2 = Math.atan2(end.y - bend.y, end.x - bend.x);

    addSeg(start.x, start.y, dist(start, bend), deg(a1), false);
    addSeg(bend.x, bend.y, dist(bend, end), deg(a2), true);

    var spark = document.createElement('div');
    spark.className = 'bolt-spark';
    spark.style.left = start.x + 'px';
    spark.style.top = start.y + 'px';
    spark.style.setProperty('--bx1', (bend.x - start.x) + 'px');
    spark.style.setProperty('--by1', (bend.y - start.y) + 'px');
    spark.style.setProperty('--bx2', (end.x - start.x) + 'px');
    spark.style.setProperty('--by2', (end.y - start.y) + 'px');
    document.body.appendChild(spark);
    spark.addEventListener('animationend', function () { spark.remove(); });
    window.setTimeout(function () { if (spark.parentNode) spark.remove(); }, 700);

    // ⑥ 命中则触发局部弯曲
    if (hitStart) addBend(start.x, start.y);
    if (hitEnd) window.setTimeout(function () { addBend(end.x, end.y); }, TRAVEL_MS * 0.92);
  }

  /* ── 调度：随机间隔 ── */
  var timer = null;
  function schedule() {
    var wait = BURST ? 320 : 900 + Math.random() * 1700;  // 0.9–2.6s
    timer = window.setTimeout(function () { spawn(); schedule(); }, wait);
  }
  function start() { if (!timer) schedule(); }
  function stop() { if (timer) { window.clearTimeout(timer); timer = null; } }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });
  window.addEventListener('resize', function () { layerTop = null; layerH = null; });
  if (reduced.addEventListener) {
    reduced.addEventListener('change', function (e) { if (e.matches) stop(); else start(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
