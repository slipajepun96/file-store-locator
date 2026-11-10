import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { OEM, createWorker } from 'tesseract.js';

// Reads the text in a photo of a letter, with Tesseract (Malay and English), on this server.
// Photos are only ever held in memory: the caller passes the image bytes, gets the text back, and the photo is
// never written to disk. The language data comes from the installed @tesseract.js-data packages, so nothing is
// downloaded at run time either.

const require = createRequire(import.meta.url);
const LANGUAGES = ['msa', 'eng'];

// Tesseract loads every language from one folder, but each language package has its own, so their files are
// copied into one temporary folder first. (Passing the data in directly would avoid this, but tesseract.js 7
// mishandles that when it starts up.)
function languageFolder() {
  const dir = path.join(os.tmpdir(), 'file-store-locator-tessdata');
  fs.mkdirSync(dir, { recursive: true });
  for (const code of LANGUAGES) {
    const pkg = path.dirname(require.resolve(`@tesseract.js-data/${code}/package.json`));
    fs.copyFileSync(path.join(pkg, '4.0.0_best_int', `${code}.traineddata.gz`), path.join(dir, `${code}.traineddata.gz`));
  }
  return dir;
}

// One worker, started on first use and kept for later photos (starting one takes a few seconds).
// cacheMethod 'none' stops Tesseract writing a copy of the language data into the working directory.
// errorHandler is required: without it tesseract.js rethrows a failed job's error where nothing can catch it, and
// one unreadable photo would crash the whole server. With it, the job's promise just rejects as usual.
let workerPromise = null;
function getWorker() {
  const options = { langPath: languageFolder(), cacheMethod: 'none', errorHandler: () => {} };
  workerPromise ??= createWorker(LANGUAGES.join('+'), OEM.LSTM_ONLY, options).catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

// Photos are read one at a time, in the order they arrive, so a burst of uploads can't overload the server.
let queue = Promise.resolve();

// Tidies the text: no trailing spaces, and at most one blank line in a row.
const tidy = (text) =>
  text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// JPEG, PNG and WebP files start with these bytes. Anything else is refused before it reaches Tesseract.
const SIGNATURES = [
  [0xff, 0xd8, 0xff],
  [0x89, 0x50, 0x4e, 0x47],
];
export function isPhoto(bytes) {
  const webp = bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return webp || SIGNATURES.some((sig) => sig.every((b, i) => bytes[i] === b));
}

export function readText(image) {
  const job = queue.then(async () => {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    return tidy(data.text);
  });
  queue = job.catch(() => {});
  return job;
}
