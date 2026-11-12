import { useRef, useState } from 'react';
import { Camera, LoaderCircle } from 'lucide-react';
import { api } from '@/api.js';
import { MAX_PDF_PAGES, isPdf, readPdf } from '@/pdf.js';
import { shrinkPhoto } from '@/photo.js';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// The letter's text, for searching by what it says. "Scan photo / PDF" takes or picks photos of the pages (on a
// phone it offers the camera) or PDFs, reads their text and adds it to the box below, where it can be corrected.
// Scanning again adds the new pages after the text already there. Photos and PDFs themselves are never kept.
// When the server reads letters with Claude, it also finds the letter's details (reference, date, sender, recipient,
// subject); they're passed to onFields(fields), which fills in the form and returns the names of what it filled.
export default function LetterTextField({ id, value, onChange, onFields }) {
  const inputRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState(null);

  // A photo, or a scanned PDF page, is read on the server; it's dropped there as soon as it's read.
  // Returns { text, fields } (fields is null when the server read it without Claude).
  const readPage = async (blob) => {
    try {
      return await api.post('/letters/read-text', blob);
    } catch (err) {
      // 413 comes from a size limit in front of the app (e.g. Nginx's client_max_body_size), not from the app itself.
      if (err.status === 413)
        throw new Error(`The photo (${(blob.size / 1024 / 1024).toFixed(1)} MB) was too large for the server to accept. Ask your administrator to raise the upload limit.`);
      throw err;
    }
  };

  async function scan(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setMessage(null);
    let text = value.trim();
    const notes = [];
    let failed = false;
    // The details found on the pages of this scan; the first page that shows a detail wins.
    const found = {};
    const collect = (fields) => {
      for (const [key, v] of Object.entries(fields ?? {})) if (v && !found[key]) found[key] = v;
    };
    const readImage = async (blob) => {
      const page = await readPage(blob);
      collect(page.fields);
      return page.text;
    };
    const add = (page) => {
      if (!page) return;
      text = text ? `${text}\n\n${page}` : page;
      onChange(text);
    };
    try {
      for (const [n, file] of files.entries()) {
        const which = files.length > 1 ? ` (${n + 1} of ${files.length})` : '';
        if (isPdf(file)) {
          const pdf = await readPdf(file, {
            readImage,
            onPage: (page, pages) => setProgress(`Reading "${file.name}"${which}, page ${page} of ${pages}…`),
          });
          add(pdf.text);
          // A PDF made on a computer has its text already, so no page went through the photo reader: ask for the
          // details from the text instead.
          if (pdf.text && !Object.keys(found).length) {
            setProgress(`Finding the letter's details in "${file.name}"…`);
            collect((await api.post('/letters/read-fields', { text: pdf.text })).fields);
          }
          if (pdf.totalPages > pdf.pages)
            notes.push(`Only the first ${MAX_PDF_PAGES} of ${pdf.totalPages} pages of "${file.name}" were read.`);
          if (!pdf.text) notes.push(`No text was found in "${file.name}".`);
        } else {
          setProgress(files.length > 1 ? `Reading photo ${n + 1} of ${files.length}…` : 'Reading the text…');
          const photoText = await readImage(await shrinkPhoto(file));
          add(photoText);
          if (!photoText) {
            const name = files.length > 1 ? `photo ${n + 1}` : 'the photo';
            notes.push(`No text was found in ${name}. Try again with the page flat, filling the frame, in good light.`);
          }
        }
      }
    } catch (err) {
      notes.splice(0, notes.length, err.message);
      failed = true;
    } finally {
      setProgress(null);
    }
    // Details found before any failure are still used.
    const filled = Object.keys(found).length ? onFields?.(found) ?? [] : [];
    if (filled.length) notes.unshift(`Filled in from the letter: ${filled.join(', ')}. Check them before saving.`);
    if (notes.length) setMessage({ ok: !failed, text: notes.join(' ') });
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>
          Letter text <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={Boolean(progress)}>
          {progress ? <LoaderCircle className="animate-spin" /> : <Camera />} Scan photo / PDF
        </Button>
        <input ref={inputRef} type="file" accept="image/*,application/pdf,.pdf" multiple className="hidden" onChange={scan} />
      </div>
      <Textarea
        id={id}
        rows={4}
        className="max-h-64 overflow-y-auto"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Scan the letter's pages or its PDF, or type or paste its text, so it can be found by what it says."
      />
      <p className={message && !message.ok ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
        {progress || message?.text || 'Photos and PDFs are only used to read the text and are not kept. Check the text for mistakes.'}
      </p>
    </div>
  );
}
