import { validExperimentSlug } from './experiment-readings.mjs';

const guideUrl = new URL('./report-guides.json', import.meta.url);
let guideCollection;

async function fetchGuides() {
  const response = await fetch(guideUrl);
  if (!response.ok) throw new Error('无法加载实验讲义，请重试。');
  const guides = await response.json();
  if (!guides || typeof guides !== 'object' || Array.isArray(guides)) {
    throw new Error('实验讲义格式无效。');
  }
  return guides;
}

export async function loadExperimentReportGuide(slug) {
  if (!validExperimentSlug(slug)) return null;
  guideCollection ??= fetchGuides().catch(error => {
    guideCollection = undefined;
    throw error;
  });
  const guides = await guideCollection;
  if (!Object.hasOwn(guides, slug)) return null;
  return guides[slug];
}
