const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function rasterizeChart(svg) {
  const chart = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const [, , width, height] = (chart.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (!(width > 0 && height > 0)) throw new Error('无法读取结果图的尺寸。');

  const imageUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const scale = 1800 / Math.max(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法将结果图写入报告。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('结果图生成失败。');
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function loadGuide(slug) {
  const { loadExperimentReportGuide } = await import('./report-guide.mjs');
  return loadExperimentReportGuide(slug);
}

export async function createReportFile(report, svg, experimentSlug) {
  const [{ buildReportDocx }, png, experimentGuide] = await Promise.all([
    import('./report-docx.mjs?v=report-info'),
    svg ? rasterizeChart(svg) : null,
    experimentSlug ? loadGuide(experimentSlug) : null
  ]);
  const bytes = buildReportDocx({ ...report, experimentGuide }, png ?? undefined);
  return {
    file: new Blob([bytes], { type: mime }),
    name: experimentGuide?.title || report.experiment || report.method
  };
}

export function downloadReport(file, title) {
  const name = title?.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').trim().slice(0, 80);
  const link = document.createElement('a');
  const fileUrl = URL.createObjectURL(file);
  link.href = fileUrl;
  link.download = name ? `${name} 实验报告.docx` : '实验报告.docx';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(fileUrl), 30000);
}
