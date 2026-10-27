import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Printer, Search } from 'lucide-react';
import { api } from '@/api.js';
import { useAuth } from '@/auth.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function SearchPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [boxes, setBoxes] = useState(null);
  const [areas, setAreas] = useState([]);
  // The file being edited, as { id, fileNumber, name, boxId }.
  const [editing, setEditing] = useState(null);
  // Ids of files ticked for label printing.
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get(`/files?q=${encodeURIComponent(q)}`).then(setFiles).catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const canRemove = (f) => user.role === 'admin' || f.createdBy === user.id;
  const areaName = (id) => areas.find((a) => a.id === id)?.name ?? '—';

  async function startEdit(file) {
    setError('');
    // Boxes and areas are only needed for editing, so load them on first use.
    if (!boxes) {
      try {
        const [b, a] = await Promise.all([api.get('/boxes'), api.get('/areas')]);
        setBoxes(b);
        setAreas(a);
      } catch (e) {
        return setError(e.message);
      }
    }
    setEditing({ id: file.id, fileNumber: file.fileNumber, name: file.name, boxId: file.boxId });
  }

  async function saveEdit(e) {
    e.preventDefault();
    try {
      const saved = await api.put(`/files/${editing.id}`, editing);
      const box = boxes.find((b) => b.id === saved.boxId);
      setFiles((fs) =>
        fs.map((f) => (f.id === saved.id ? { ...f, ...saved, boxName: box?.name ?? '—', areaName: areaName(box?.areaId) } : f))
      );
      setEditing(null);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(file) {
    if (!confirm(`Remove file ${file.fileNumber} from the records?`)) return;
    try {
      await api.del(`/files/${file.id}`);
      setFiles((fs) => fs.filter((f) => f.id !== file.id));
      setSelected((s) => s.filter((id) => id !== file.id));
    } catch (e) {
      setError(e.message);
    }
  }

  const set = (key) => (e) => setEditing((f) => ({ ...f, [key]: e.target.value }));
  const editBox = editing && boxes?.find((b) => b.id === editing.boxId);

  // Ticked files stay ticked across searches, so labels can be gathered from several searches.
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allShown = files.length > 0 && files.every((f) => selected.includes(f.id));
  const toggleAllShown = () =>
    setSelected((s) => (allShown ? s.filter((id) => !files.some((f) => f.id === id)) : [...new Set([...s, ...files.map((f) => f.id)])]));

  const selectBox = (f) => (
    <Checkbox checked={selected.includes(f.id)} onCheckedChange={() => toggle(f.id)} aria-label={`Select ${f.fileNumber}`} />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Find a File</CardTitle>
        {selected.length > 0 && (
          <CardAction className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setSelected([])}>Clear selection</Button>
            <Button asChild>
              <Link to={`/labels?files=${selected.join(',')}`} target="_blank">
                <Printer /> Print {selected.length} label{selected.length > 1 ? 's' : ''}
              </Link>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9 text-base md:text-base"
            autoFocus
            placeholder="Search by file number or file name…"
            value={q}
            onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {q ? 'No matching files.' : 'No files recorded yet.'}{' '}
            <Link to="/files/new" className="text-foreground underline underline-offset-4">Register a file</Link>
          </p>
        ) : (
          <form onSubmit={saveEdit}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><Checkbox checked={allShown} onCheckedChange={toggleAllShown} aria-label="Select all shown files" /></TableHead>
                  <TableHead>File No.</TableHead>
                  <TableHead>File Name</TableHead>
                  <TableHead>File Box</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) =>
                  editing?.id === f.id ? (
                    <TableRow key={f.id} className="bg-muted/50">
                      <TableCell>{selectBox(f)}</TableCell>
                      <TableCell><Input className="h-8 min-w-24" value={editing.fileNumber} onChange={set('fileNumber')} required autoFocus aria-label="File number" /></TableCell>
                      <TableCell><Input className="h-8 min-w-24" value={editing.name} onChange={set('name')} required aria-label="File name" /></TableCell>
                      <TableCell>
                        <NativeSelect size="sm" value={editing.boxId} onChange={set('boxId')} required aria-label="File box">
                          {boxes.map((b) => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}
                        </NativeSelect>
                      </TableCell>
                      <TableCell>{areaName(editBox?.areaId)}</TableCell>
                      <TableCell>{f.createdByName}</TableCell>
                      <TableCell>{new Date(f.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="space-x-1 text-right">
                        <Button type="submit" size="sm">Save</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={f.id} data-state={selected.includes(f.id) ? 'selected' : undefined}>
                      <TableCell>{selectBox(f)}</TableCell>
                      <TableCell className="font-semibold">{f.fileNumber}</TableCell>
                      <TableCell>{f.name}</TableCell>
                      <TableCell><Link to={`/boxes/${f.boxId}`} className="underline underline-offset-4">{f.boxName}</Link></TableCell>
                      <TableCell>{f.areaName}</TableCell>
                      <TableCell>{f.createdByName}</TableCell>
                      <TableCell>{new Date(f.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="space-x-1 text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/labels?files=${f.id}`} target="_blank">Label</Link>
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(f)}>Edit</Button>
                        {canRemove(f) && (
                          <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove(f)}>
                            Remove
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
