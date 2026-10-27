import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, MapPin, Package, Search } from 'lucide-react';
import { api } from '@/api.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const MIN_QUERY = 2;

// Public lookup at /find: anyone can type a file name and see which box and area it's in, without signing in.
export default function PublicSearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (q.trim().length < MIN_QUERY) {
      setResult(null);
      setError('');
      return;
    }
    const t = setTimeout(() => {
      api
        .get(`/public/files?q=${encodeURIComponent(q)}`)
        .then((r) => {
          setResult(r);
          setError('');
        })
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="mx-auto grid min-h-screen max-w-2xl content-start gap-6 px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold">
          <Package className="size-5" /> File Store Locator
        </div>
        <Link to="/login" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Staff sign in
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Where is my file?</CardTitle>
          <CardDescription>Type the file name to see which box and area it is stored in.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-12 pl-9 text-base md:text-base"
              autoFocus
              placeholder="File name…"
              aria-label="File name"
              value={q}
              onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {!error && q.trim().length > 0 && q.trim().length < MIN_QUERY && (
            <p className="text-sm text-muted-foreground">Keep typing…</p>
          )}
          {!error && result && result.files.length === 0 && (
            <p className="text-sm text-muted-foreground">No file found with a name containing "{q.trim()}".</p>
          )}

          {!error && result?.files.length > 0 && (
            <ul className="grid gap-2">
              {result.files.map((f) => (
                <li key={f.fileNumber} className="grid gap-2 rounded-lg border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{f.name}</p>
                    <p className="text-sm text-muted-foreground">File no. {f.fileNumber}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span className="flex items-center gap-1.5"><Archive className="size-4 text-muted-foreground" /> Box <strong>{f.boxName}</strong></span>
                    <span className="flex items-center gap-1.5"><MapPin className="size-4 text-muted-foreground" /> Area <strong>{f.areaName}</strong></span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!error && result?.more && (
            <p className="text-sm text-muted-foreground">Showing the first {result.files.length} matches. Type more of the name to narrow it down.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
