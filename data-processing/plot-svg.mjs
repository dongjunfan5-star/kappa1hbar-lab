import { plotData } from './processing.mjs';

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xml = value => String(value).replace(/[&<>"']/g, character => entities[character]);

function bounds(values) {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new RangeError('无法绘制超出数值范围的坐标');
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const margin = low === high ? (Math.abs(low) * 0.1 || 1) : (high - low) * 0.08;
  const domain = [low - margin, high + margin];
  if (!domain.every(Number.isFinite) || !(domain[1] > domain[0])) throw new RangeError('坐标范围过大或过小');
  return domain;
}

function linearTicks(domain) {
  const [low, high] = domain;
  const raw = (high - low) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const multiplier = [1, 2, 2.5, 5, 10].find(step => step * magnitude >= raw);
  const step = multiplier * magnitude;
  const first = Math.ceil(low / step);
  const last = Math.floor(high / step);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last <= first || last - first > 8) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step);
}

function axisTicks(domain, scale) {
  const [low, high] = domain;
  const preferred = scale === 'linear' ? linearTicks(domain) : [];
  const positions = preferred.length ? preferred : Array.from({ length: 6 }, (_, i) => low + (high - low) * (i / 5));
  const ticks = positions.map(position => {
    const value = scale === 'log' ? 10 ** position : scale === 'ln' ? Math.exp(position) : position;
    return { position, value };
  });
  for (let precision = 4; precision <= 17; precision += 1) {
    const labels = ticks.map(({ position, value }) => {
      if (Number.isFinite(value) && (scale === 'linear' || value > 0)) {
        return Number(value.toPrecision(precision)).toString();
      }
      return `${scale === 'log' ? '10' : 'e'}^${Number(position.toPrecision(precision))}`;
    });
    if (new Set(labels).size === ticks.length || precision === 17) {
      return ticks.map(({ position }, index) => ({ position, label: labels[index] }));
    }
  }
}

/** 将 plotData 的返回值渲染为独立 SVG，适用于浏览器、报告文件与命令行。 */
export function plotToSvg(chart, { width = 720, height = 480, errorStyle = 'bars', overlays = [] } = {}) {
  if (!chart?.points?.length || !chart.xAxis || !chart.yAxis) throw new TypeError('请先调用 plotData');
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 320 || height < 240) {
    throw new RangeError('绘图区尺寸至少为 320 × 240');
  }
  if (!['bars', 'box'].includes(errorStyle)) throw new RangeError('errorStyle 须为 bars 或 box');
  const { points, title, xAxis, yAxis, connect } = chart;
  const polar = chart.coordinateSystem === 'polar';
  if (!Array.isArray(overlays) || (polar && overlays.length > 0)) throw new RangeError('拟合线组仅支持直角坐标图');
  const curves = overlays.map(series => plotData(series, { xScale: xAxis.scale, yScale: yAxis.scale }).points);
  const estimatesX = [];
  const estimatesY = [];
  for (const point of points) {
    estimatesX.push(point.plot.x);
    estimatesY.push(point.plot.y);
    if (polar) {
      for (const edge of [...point.radialBar, ...point.angularBar, ...point.corners]) {
        if (edge === null) continue;
        estimatesX.push(edge.x);
        estimatesY.push(edge.y);
      }
    } else {
      const { xLow, xHigh, yLow, yHigh } = point.plotBounds;
      estimatesX.push(xLow ?? point.plot.x, xHigh);
      estimatesY.push(yLow ?? point.plot.y, yHigh);
    }
  }
  for (const series of curves) {
    for (const point of series) {
      estimatesX.push(point.plot.x);
      estimatesY.push(point.plot.y);
    }
  }
  const left = 78;
  const right = width - 34;
  const top = 49;
  const bottom = height - 59;
  let xDomain = bounds(estimatesX);
  let yDomain = bounds(estimatesY);
  if (polar) {
    let radius = 0;
    for (const point of points) radius = Math.max(radius, point.bounds.yHigh);
    radius = radius ? radius * 1.08 : 1;
    const aspect = (right - left) / (bottom - top);
    const xRadius = radius * Math.max(1, aspect);
    const yRadius = radius * Math.max(1, 1 / aspect);
    xDomain = [-xRadius, xRadius];
    yDomain = [-yRadius, yRadius];
  }
  const x = value => left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * (right - left);
  const y = value => bottom - ((value - yDomain[0]) / (yDomain[1] - yDomain[0])) * (bottom - top);
  const coord = value => value.toFixed(2);
  const line = (x1, y1, x2, y2) =>
    `<line x1="${coord(x1)}" y1="${coord(y1)}" x2="${coord(x2)}" y2="${coord(y2)}"/>`;
  const text = (px, py, anchor, label) =>
    `<text x="${coord(px)}" y="${coord(py)}" text-anchor="${anchor}">${xml(label)}</text>`;
  const circle = (px, py, radius) => `<circle cx="${coord(px)}" cy="${coord(py)}" r="${coord(radius)}"/>`;
  const mark = point => `${coord(x(point.x))},${coord(y(point.y))}`;
  const pathPoints = list => list.filter(Boolean).map(mark).join(' ');
  const polarArc = (angle, halfWidth, radius) => {
    const steps = Math.max(2, Math.ceil(32 * halfWidth / Math.PI));
    return Array.from({ length: steps + 1 }, (_, step) => {
      const theta = angle - halfWidth + 2 * halfWidth * step / steps;
      return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
    });
  };
  const labels = [];
  const grid = [];
  const labelOf = axis => axis.unit ? `${axis.label} (${axis.unit})` : axis.label;
  if (polar) {
    const radius = Math.min(xDomain[1], yDomain[1]);
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      const value = radius * fraction;
      grid.push(circle(x(0), y(0), x(value) - x(0)));
      labels.push(text(x(value) + 3, y(0) - 8, 'start', Number(value.toPrecision(3))));
    }
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      grid.push(line(x(0), y(0), x(radius * Math.cos(angle)), y(radius * Math.sin(angle))));
      const angleLabel = chart.angleUnit === 'deg' ? `${45 * index}°`
        : ['0', 'π/4', 'π/2', '3π/4', 'π', '5π/4', '3π/2', '7π/4'][index];
      const anchor = index === 0 ? 'start' : index === 4 ? 'end' : 'middle';
      const offsetX = index === 0 ? 9 : index === 4 ? -9 : 0;
      const offsetY = index > 0 && index < 4 ? -6 : index > 4 ? 13 : 4;
      labels.push(text(x(radius * Math.cos(angle)) + offsetX, y(radius * Math.sin(angle)) + offsetY, anchor, angleLabel));
    }
    labels.push(text(width / 2, height - 13, 'middle', `${labelOf(xAxis)} / ${labelOf(yAxis)}`));
  } else {
    grid.push(`<rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"/>`);
    for (const tick of axisTicks(xDomain, xAxis.scale)) {
      grid.push(line(x(tick.position), top, x(tick.position), bottom));
      labels.push(text(x(tick.position), bottom + 20, 'middle', tick.label));
    }
    for (const tick of axisTicks(yDomain, yAxis.scale)) {
      grid.push(line(left, y(tick.position), right, y(tick.position)));
      labels.push(text(left - 9, y(tick.position) + 4, 'end', tick.label));
    }
    labels.push(text((left + right) / 2, height - 13, 'middle', labelOf(xAxis)));
    labels.push(`<g transform="rotate(-90 17 ${(top + bottom) / 2})">${text(17, (top + bottom) / 2, 'middle', labelOf(yAxis))}</g>`);
  }
  const errors = [];
  for (const point of points) {
    if (polar) {
      const toRadians = chart.angleUnit === 'deg' ? Math.PI / 180 : 1;
      const angle = point.x * toRadians;
      const halfWidth = Math.min(Math.PI, point.ux * toRadians);
      if (errorStyle === 'box' && point.ux && point.uy) {
        const exterior = polarArc(angle, halfWidth, point.bounds.yHigh);
        const interior = polarArc(angle, halfWidth, Math.max(0, point.bounds.yLow)).reverse();
        errors.push(`<polygon points="${pathPoints([...exterior, ...interior])}"/>`);
      } else {
        const radial = point.radialBar.map(end => end ?? { x: 0, y: 0 });
        if (point.uy) errors.push(`<polyline points="${pathPoints(radial)}"/>`);
        if (point.ux) errors.push(`<polyline points="${pathPoints(polarArc(angle, halfWidth, point.y))}"/>`);
      }
      continue;
    }
    const { xLow, xHigh, yLow, yHigh } = point.plotBounds;
    const x0 = x(xLow ?? xDomain[0]);
    const x1 = x(xHigh);
    const y0 = y(yHigh);
    const y1 = y(yLow ?? yDomain[0]);
    const px = x(point.plot.x);
    const py = y(point.plot.y);
    if (errorStyle === 'box' && point.ux && point.uy) {
      errors.push(`<rect x="${coord(x0)}" y="${coord(y0)}" width="${coord(x1 - x0)}" height="${coord(y1 - y0)}"/>`);
      continue;
    }
    if (point.ux) errors.push(line(x0, py, x1, py), line(x1, py - 3, x1, py + 3));
    if (point.ux && xLow !== null) errors.push(line(x0, py - 3, x0, py + 3));
    if (point.uy) errors.push(line(px, y0, px, y1), line(px - 3, y0, px + 3, y0));
    if (point.uy && yLow !== null) errors.push(line(px - 3, y1, px + 3, y1));
  }
  const symbols = points.map(point => circle(x(point.plot.x), y(point.plot.y), 3.5));
  const series = connect ? `<polyline points="${pathPoints(points.map(point => point.plot))}"/>` : '';
  const fit = curves.map(curve => `<polyline points="${pathPoints(curve.map(point => point.plot))}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(title || '实验数据图')}" font-family="sans-serif" font-size="12">
<rect width="100%" height="100%" fill="#fff"/>
<g fill="none" stroke="#e2e8e6">${grid.join('')}</g>
<g fill="#253532">${labels.join('')}</g>
<g fill="none" stroke="#476a70" stroke-width="1.2">${errors.join('')}${series}</g>
<g fill="none" stroke="#b04c27" stroke-width="1.6">${fit}</g>
<g fill="#18645d">${symbols.join('')}</g>
<text x="${width / 2}" y="25" text-anchor="middle" font-size="17" fill="#172622">${xml(title)}</text>
</svg>`;
}
