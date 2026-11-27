const encoder = new TextEncoder();
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const officeRelationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const drawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function textValue(value) {
  if (value == null) return '—';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '−∞';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return JSON.stringify(value, (_, item) =>
    typeof item === 'number' && !Number.isFinite(item) ? textValue(item) : item) ?? '—';
  return String(value);
}

function escapeXml(value) {
  return textValue(value)
    .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '�')
    .replace(/[&<>"']/g, char => entities[char]);
}

function paragraph(value, style = 'Normal', { align, bold = false, keepNext = false } = {}) {
  const run = textValue(value).split(/\r\n|\r|\n/).map(line =>
    '<w:t xml:space="preserve">' + escapeXml(line) + '</w:t>').join('<w:br/>');
  return '<w:p><w:pPr><w:pStyle w:val="' + style + '"/>' +
    (keepNext ? '<w:keepNext/>' : '') +
    (align ? '<w:jc w:val="' + align + '"/>' : '') +
    '</w:pPr><w:r>' + (bold ? '<w:rPr><w:b/></w:rPr>' : '') + run + '</w:r></w:p>';
}

function guideSection(title, blocks = []) {
  const content = blocks.map(({ type, text, prefix }) => {
    if (type === 'item') return paragraph((prefix || '•') + ' ' + text, 'GuideItem');
    if (type === 'formula') return paragraph(text, 'GuideFormula');
    if (type === 'subheading') return paragraph(text, 'Heading2');
    return paragraph(text);
  }).join('');
  return paragraph(title, 'Heading1') + (content || paragraph(''));
}

function tableMarkup(headers, rows, width, fractions) {
  const weights = fractions ?? headers.map(() => 1);
  const sum = weights.reduce((total, weight) => total + weight, 0);
  const widths = weights.map(weight => Math.floor(width * weight / sum));
  widths[widths.length - 1] += width - widths.reduce((total, size) => total + size, 0);
  const grid = widths.map(size => '<w:gridCol w:w="' + size + '"/>').join('');
  const contents = [headers, ...rows].map((row, index) => {
    const header = index === 0;
    const cells = headers.map((_, position) => {
      const value = row[position];
      const numeric = /^\s*[−+-]?(?:\d[\d.,]*|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(textValue(value));
      return '<w:tc><w:tcPr><w:tcW w:w="' + widths[position] + '" w:type="dxa"/>' +
        (header ? '<w:shd w:val="clear" w:color="auto" w:fill="EAF0F3"/>' : '') +
        '<w:vAlign w:val="center"/></w:tcPr>' +
        paragraph(value, 'TableText', { align: !header && numeric ? 'right' : 'left', bold: header }) + '</w:tc>';
    }).join('');
    return '<w:tr>' + (header ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + cells + '</w:tr>';
  }).join('');
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(edge =>
    '<w:' + edge + ' w:val="single" w:sz="4" w:color="D1D9DF"/>').join('');
  return '<w:tbl><w:tblPr><w:tblW w:w="' + width + '" w:type="dxa"/><w:tblBorders>' + borders +
    '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>' +
    '<w:top w:w="52" w:type="dxa"/><w:left w:w="84" w:type="dxa"/>' +
    '<w:bottom w:w="52" w:type="dxa"/><w:right w:w="84" w:type="dxa"/>' +
    '</w:tblCellMar></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + contents + '</w:tbl>';
}

function tablesFor(title, headers, rows, width, fractions) {
  if (!headers.length) return '';
  const maximumColumns = 8;
  if (headers.length <= maximumColumns) {
    return paragraph(title, 'Heading1') + tableMarkup(headers, rows, width, fractions);
  }
  // Repeat the first column so rows in wide table sections can be matched.
  let sections = '';
  for (let start = 1; start < headers.length; start += maximumColumns - 1) {
    const end = Math.min(headers.length, start + maximumColumns - 1);
    const indices = [0, ...Array.from({ length: end - start }, (_, index) => start + index)];
    sections += paragraph(title + ' 第 ' + start + ' 至 ' + (end - 1) + ' 列观测量', 'Heading1') +
      tableMarkup(indices.map(index => headers[index]),
        rows.map(row => indices.map(index => row[index])), width);
  }
  return sections;
}

function pngSize(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 ||
      !signature.every((value, index) => bytes[index] === value) ||
      ![73, 72, 68, 82].every((value, index) => bytes[index + 12] === value)) {
    throw new TypeError('拟合图须为有效的 PNG 图像。');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height) throw new RangeError('拟合图的宽高无效。');
  return { width, height };
}

function chartMarkup(png, pageWidth) {
  const { width, height } = pngSize(png);
  const scale = Math.min(pageWidth * 635 / width, 3550000 / height);
  const cx = Math.max(1, Math.floor(width * scale));
  const cy = Math.max(1, Math.floor(height * scale));
  return '<w:p><w:pPr><w:pStyle w:val="Chart"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="1" name="观测数据图" descr="由本次计算生成的观测数据图"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="1" name="观测数据图"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdChart"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

const styles = declaration + '<w:styles xmlns:w="' + wordNamespace + '">' + [
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="85" w:line="285" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>',
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>',
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="ReportMetadata"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:after="220"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="40"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="190" w:after="90"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="26"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="120" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="GuideItem"><w:name w:val="实验提纲条目"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="GuideFormula"><w:name w:val="实验原理公式"/><w:basedOn w:val="Normal"/><w:pPr><w:keepLines/><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="ReportWriting"><w:name w:val="实验结论正文"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="260" w:lineRule="auto"/></w:pPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="ReportMetadata"><w:name w:val="报告信息"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="58"/></w:pPr><w:rPr><w:color w:val="415563"/><w:sz w:val="21"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="报告表格"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="250" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Chart"><w:name w:val="报告图表"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="140" w:line="240" w:lineRule="auto"/></w:pPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="CalculationDetails"><w:name w:val="详细计算数据"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="260" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>',
  '</w:styles>'
].join('\n');

function reportDocument(report, png) {
  const guide = report.experimentGuide ?? {};
  const rows = report.rows ?? [];
  const columns = report.columns ?? [];
  const tables = report.tables ?? [];
  const landscape = Math.max(columns.length, ...tables.map(table => table.headers.length)) > 6;
  const pageWidth = landscape ? 15840 : 12240;
  const pageHeight = landscape ? 12240 : 15840;
  const margin = 1134;
  const width = pageWidth - 2 * margin;
  const experiment = guide.title || report.experiment;
  const meta = ['实验名称　' + (experiment || '____________________________')];
  if (report.method) meta.push('数据处理方法　' + report.method);
  if (report.source) meta.push('读数来源　' + report.source);
  if (report.createdAt) {
    const date = report.createdAt instanceof Date
      ? [report.createdAt.getFullYear(), report.createdAt.getMonth() + 1, report.createdAt.getDate()]
        .map(value => String(value).padStart(2, '0')).join('-')
      : report.createdAt;
    meta.push('导出日期　' + date);
  }
  const inputs = (report.inputs ?? []).filter(input => input.value !== '' && input.value != null);
  const primary = (report.primary ?? []).map(({ label, value, unit }) => [label, value, unit || '—']);
  const notes = report.notes ?? [];
  const body = paragraph('实验报告', 'Title') +
    meta.map(line => paragraph(line, 'ReportMetadata')).join('') +
    guideSection('实验目的', guide.purpose) +
    guideSection('实验原理', guide.principle) +
    guideSection('实验步骤', guide.steps) +
    (columns.length && rows.length ? tablesFor('实验数据', columns, rows, width) : '') +
    (inputs.length ? tablesFor('计算参数', ['参数', '设置值'], inputs.map(({ label, value }) => [label, value]), width, [1, 2.6]) : '') +
    (primary.length ? tablesFor('计算结果', ['项目', '结果', '单位'], primary, width, [1.4, 1.5, .6]) : '') +
    (png ? paragraph('数据图', 'Heading1') + chartMarkup(png, width) : '') +
    tables.map(({ title, headers, rows }) => tablesFor(title, headers, rows, width)).join('') +
    (notes.length ? paragraph('计算说明', 'Heading1') + notes.map(note => paragraph(note)).join('') : '') +
    (report.calculationDetails ? paragraph('详细计算数据', 'Heading1') +
      report.calculationDetails.split(/\r\n|\r|\n/).map(line => paragraph(line, 'CalculationDetails')).join('') : '') +
    paragraph('实验结论', 'Heading1') +
    paragraph('', 'ReportWriting', { keepNext: true }) +
    paragraph('', 'ReportWriting', { keepNext: true }) +
    paragraph('', 'ReportWriting');
  const page = '<w:sectPr><w:pgSz w:w="' + pageWidth + '" w:h="' + pageHeight + '"' +
    (landscape ? ' w:orient="landscape"' : '') +
    '/><w:pgMar w:top="' + margin + '" w:right="' + margin + '" w:bottom="' + margin +
    '" w:left="' + margin + '" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
  return declaration + '<w:document xmlns:w="' + wordNamespace + '" xmlns:r="' + officeRelationships +
    '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="' + drawingNamespace +
    '" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body + page + '</w:body></w:document>';
}

function packageFiles(report, png) {
  const xml = content => encoder.encode(declaration + content);
  const defaults = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (png ? '<Default Extension="png" ContentType="image/png"/>' : '');
  const documentTypes = [
    ['document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
    ['styles', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml']
  ].map(([part, type]) => '<Override PartName="/word/' + part + '.xml" ContentType="' + type + '"/>').join('');
  const relationships = content => xml('<Relationships xmlns="' + packageRelationships + '">' + content + '</Relationships>');
  const relationship = (id, kind, target) => '<Relationship Id="' + id + '" Type="' + officeRelationships +
    '/' + kind + '" Target="' + target + '"/>';
  return [
    ['[Content_Types].xml', xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + defaults + documentTypes + '</Types>')],
    ['_rels/.rels', relationships(relationship('rIdDocument', 'officeDocument', 'word/document.xml'))],
    ['word/document.xml', encoder.encode(reportDocument(report, png))],
    ['word/styles.xml', encoder.encode(styles)],
    ['word/_rels/document.xml.rels', relationships(relationship('rIdStyles', 'styles', 'styles.xml') +
      (png ? relationship('rIdChart', 'image', 'media/chart.png') : ''))],
    ...(png ? [['word/media/chart.png', png]] : [])
  ];
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value;
});

function crc32(bytes) {
  let sum = 0xffffffff;
  for (const byte of bytes) sum = crcTable[(sum ^ byte) & 255] ^ (sum >>> 8);
  return (sum ^ 0xffffffff) >>> 0;
}

function zipStored(files) {
  const entries = [];
  let bodySize = 0;
  let directorySize = 0;
  for (const [file, bytes] of files) {
    const name = encoder.encode(file);
    entries.push({ name, bytes, checksum: crc32(bytes), offset: bodySize });
    bodySize += 30 + name.length + bytes.length;
    directorySize += 46 + name.length;
  }
  const output = new Uint8Array(bodySize + directorySize + 22);
  const view = new DataView(output.buffer);
  const short = (offset, value) => view.setUint16(offset, value, true);
  const word = (offset, value) => view.setUint32(offset, value, true);
  // File metadata fields have the same layout in both ZIP header types.
  const writeFileInfo = (at, { name, bytes, checksum }) => {
    short(at, 20);
    short(at + 2, 0x800);
    short(at + 8, 0x21);
    word(at + 10, checksum);
    word(at + 14, bytes.length);
    word(at + 18, bytes.length);
    short(at + 22, name.length);
  };
  let directory = bodySize;
  for (const entry of entries) {
    const { name, bytes, offset } = entry;
    word(offset, 0x04034b50);
    writeFileInfo(offset + 4, entry);
    output.set(name, offset + 30);
    output.set(bytes, offset + 30 + name.length);
    word(directory, 0x02014b50);
    short(directory + 4, 20);
    writeFileInfo(directory + 6, entry);
    word(directory + 42, offset);
    output.set(name, directory + 46);
    directory += 46 + name.length;
  }
  word(directory, 0x06054b50);
  short(directory + 8, files.length);
  short(directory + 10, files.length);
  word(directory + 12, directorySize);
  word(directory + 16, bodySize);
  return output;
}

/** Build one editable, self-contained Word report using only browser-standard APIs. */
export function buildReportDocx(report, chartPng) {
  return zipStored(packageFiles(report, chartPng));
}
