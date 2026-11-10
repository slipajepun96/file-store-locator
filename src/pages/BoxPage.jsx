import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api } from '@/api.js';
import { canManageOffice, useAuth } from '@/auth.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function BoxPage() {
  const { user } = useAuth();
  const { boxId } = useParams();
  const [box, setBox] = useState(null);
  const [error, setError] = useState('');
  // Ids of files ticked for label printing; none ticked prints them all.
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    setSelected([]);
    api.get(`/boxes/${boxId}`).then(setBox).catch((e) => setError(e.message));
  }, [boxId]);

  if (error) return <Card><CardContent className="text-destructive">{error}</CardContent></Card>;
  if (!box) return <Card><CardContent className="text-muted-foreground">Loading…</CardContent></Card>;

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allSelected = box.files.length > 0 && selected.length === box.files.length;
  const toPrint = selected.length > 0 ? selected : box.files.map((f) => f.id);

  return (
    <Card>
      <CardHeader className="sm:grid-cols-[1fr_auto]">
        <CardTitle className="text-2xl">{box.name}</CardTitle>
        <CardDescription>Office: {box.office?.name ?? '—'} · Area: {box.area?.name ?? '—'} · {box.files.length} file(s)</CardDescription>
        {/* Below the title on phones, beside it on wider screens. */}
        <div className="flex flex-wrap gap-2 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
          {box.files.length > 0 && (
            <Button variant="outline" asChild>
              <Link to={`/labels?files=${toPrint.join(',')}`}>
                <Printer />
                {selected.length > 0
                  ? `Print ${selected.length} File Label${selected.length > 1 ? 's' : ''}`
                  : 'Print All File Labels'}
              </Link>
            </Button>
          )}
          {canManageOffice(user, box.officeId) && (
            <Button asChild>
              <Link to={`/labels?ids=${box.id}`}><Printer /> Print Box Label</Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {box.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">This box is empty.</p>
        ) : (
          <>
            {/* Phones: one card per file. */}
            <div className="grid gap-2 md:hidden">
              <label className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                <Checkbox checked={allSelected} onCheckedChange={() => setSelected(allSelected ? [] : box.files.map((f) => f.id))} />
                Select all {box.files.length}
              </label>
              <ul className="grid gap-2">
                {box.files.map((f) => (
                  <li key={f.id} className="flex items-start gap-3 rounded-lg border p-3 data-[state=selected]:bg-muted" data-state={selected.includes(f.id) ? 'selected' : undefined}>
                    <div className="pt-0.5">
                      <Checkbox checked={selected.includes(f.id)} onCheckedChange={() => toggle(f.id)} aria-label={`Select ${f.fileNumber}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold break-words">{f.fileNumber}</p>
                      <p className="break-words">{f.name}</p>
                      <p className="text-xs text-muted-foreground">{f.createdByName} · {new Date(f.createdAt).toLocaleDateString()}</p>
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/labels?files=${f.id}`}><Printer /> Label</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hidden min-w-0 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={() => setSelected(allSelected ? [] : box.files.map((f) => f.id))}
                      aria-label="Select all files"
                    />
                  </TableHead>
                  <TableHead>File No.</TableHead>
                  <TableHead>File Name</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {box.files.map((f) => (
                  <TableRow key={f.id} data-state={selected.includes(f.id) ? 'selected' : undefined}>
                    <TableCell><Checkbox checked={selected.includes(f.id)} onCheckedChange={() => toggle(f.id)} aria-label={`Select ${f.fileNumber}`} /></TableCell>
                    <TableCell className="font-semibold">{f.fileNumber}</TableCell>
                    <TableCell>{f.name}</TableCell>
                    <TableCell>{f.createdByName}</TableCell>
                    <TableCell>{new Date(f.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/labels?files=${f.id}`}>Label</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
