/* Lucide 极简替代（vendor）
 *
 * 背景：Codex 生成的页面会从 unpkg 拉 lucide@1.17.0（官方 UMD 约 588 KB），
 * 但实际只用到 chevron-left / chevron-right 两个图标（轮播/折叠箭头）。
 *
 * 直接内联 588 KB 不划算，且 unpkg 在国内不稳定；这里实现 createIcons 的最小兼容版，
 * 只输出页面真正需要的图标。调用方用的是官方 API 子集：
 *     lucide.createIcons({ attrs: { width: 16, height: 16 } })
 *
 * 行为与官方一致：把页面里所有 [data-lucide] 的 <i>/<span> 替换成 <svg class="lucide lucide-xxx">。
 * 遇到未定义的图标名时回退到 chevron-right，保证不会出现空按钮。
 */
(function () {
  'use strict';
  if (window.lucide && typeof window.lucide.createIcons === 'function') return;

  var PATHS = {
    'chevron-left': 'm15 18-6-6 6-6',
    'chevron-right': 'm9 18 6-6-6-6',
    'chevron-down': 'm6 9 6 6 6-6',
    'chevron-up': 'm18 15-6-6-6 6'
  };

  function makeSvg(name, attrs) {
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
    var w = (attrs && attrs.width) || 24;
    var h = (attrs && attrs.height) || 24;
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
        var svg = makeSvg(name, attrs);
        if (el.className) svg.setAttribute('class', 'lucide lucide-' + name + ' ' + el.className);
        if (el.parentNode) el.parentNode.replaceChild(svg, el);
      }
    }
  };
})();
