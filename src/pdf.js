import { MAX_SIDE, canvasToJpeg } from '@/photo.js';

// Reads a PDF's text in the browser, page by page:
// - a page that already has text (a PDF made on a computer) gives it directly: instant and exact;
// - a page that's only a picture (a scanned PDF) is drawn as an image and read like a photo, by readImage.
// The PDF itself is never uploaded; only scanned pages are sent, one image at a time, and they aren't kept.
// PDF.js (~1 MB) is only loaded the first time someone picks a PDF. The legacy build works on older phones too.

export const MAX_PDF_PAGES = 30;
// A page with fewer letters than this is treated as a scan (a picture, perhaps with a stray page number).
const MIN_TEXT_CHARS = 20;

let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}

export const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

// The text a page already holds, line by line, tidied like the server tidies scanned text.
function pageText(content) {
  return content.items
    .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ''))
    .join('')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function pageImage(page) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  // Scans can have transparent areas; on white they read like paper.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvasToJpeg(canvas);
}

// Returns { text, pages, totalPages }. onPage(n, total) reports progress; readImage(blob) reads a scanned page.
export async function readPdf(file, { onPage, readImage }) {
  const pdfjs = await loadPdfjs();
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error(`"${file.name}" is password-protected. Open it, save a copy without a password, and try again.`);
    throw new Error(`"${file.name}" couldn't be opened as a PDF.`);
  }
  try {
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const texts = [];
    for (let n = 1; n <= pages; n++) {
      onPage?.(n, pages);
      const page = await pdf.getPage(n);
      const text = pageText(await page.getTextContent());
      const scanned = text.replace(/\s/g, '').length < MIN_TEXT_CHARS;
      const result = scanned ? await readImage(await pageImage(page)) : text;
      page.cleanup();
      if (result) texts.push(result);
    }
    return { text: texts.join('\n\n'), pages, totalPages: pdf.numPages };
  } finally {
    pdf.destroy();
  }
}
