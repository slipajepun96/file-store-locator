import { useEffect, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { api } from '@/api.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { letterCode } from '@/letters.jsx';

// Pick files to assign a letter to: search by file number or name, add from the results, remove with ×.
// value is a list of file objects (with id, fileNumber, name, boxName, letterCounter); onChange gets the new list.
// Each chip shows the letter's code in that file: its actual code if it's already there (letterNo), otherwise the
// code it's about to get (the file's next number; the server gives the final one when saving).
const chipCode = (f) => f.letterNo ?? letterCode(f.fileNumber, f.letterCounter + 1);

export default function FilePicker({ value, onChange, id }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(() => {
      api.get(`/files?q=${encodeURIComponent(q.trim())}`).then((r) => setResults(r.slice(0, 8))).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const chosen = new Set(value.map((f) => f.id));
  const add = (f) => {
    onChange([...value, f]);
    setQ('');
  };

  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((f) => (
            <li key={f.id}>
              <Badge variant="secondary" className="max-w-full gap-1 py-1 pr-1 text-sm whitespace-normal" title={f.name}>
                <span className="font-semibold">{chipCode(f)}</span>
                {!f.letterNo && <span className="text-xs font-normal text-muted-foreground">new</span>}
                <button
                  type="button"
                  className="rounded-sm p-0.5 hover:bg-background"
                  onClick={() => onChange(value.filter((x) => x.id !== f.id))}
                  aria-label={`Remove file ${f.fileNumber}`}
                >
                  <X className="size-3.5" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files to assign…" autoComplete="off" />
      </div>
      {q.trim() && (
        <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No matching files.</li>}
          {results.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-semibold">{f.fileNumber}</span> <span className="break-words">{f.name}</span>
                <p className="text-xs text-muted-foreground">
                  {f.boxName} · {f.officeName} · next letter {letterCode(f.fileNumber, f.letterCounter + 1)}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" disabled={chosen.has(f.id)} onClick={() => add(f)}>
                {chosen.has(f.id) ? 'Added' : <><Plus /> Add</>}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
