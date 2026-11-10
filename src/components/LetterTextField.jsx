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
export default function LetterTextField({ id, value, onChange }) {
  const inputRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState(null);

  // A photo, or a scanned PDF page, is read on the server; it's dropped there as soon as it's read.
  const readImage = async (blob) => (await api.post('/letters/read-text', blob)).text;

  async function scan(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setMessage(null);
    let text = value.trim();
    const notes = [];
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
          if (pdf.totalPages > pdf.pages)
            notes.push(`Only the first ${MAX_PDF_PAGES} of ${pdf.totalPages} pages of "${file.name}" were read.`);
          if (!pdf.text) notes.push(`No text was found in "${file.name}".`);
        } else {
          setProgress(files.length > 1 ? `Reading photo ${n + 1} of ${files.length}…` : 'Reading the text…');
          add(await readImage(await shrinkPhoto(file)));
        }
      }
      if (notes.length) setMessage({ ok: true, text: notes.join(' ') });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setProgress(null);
    }
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
