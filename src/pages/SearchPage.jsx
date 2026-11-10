import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Pencil, Printer, Search, Trash2 } from 'lucide-react';
import { api } from '@/api.js';
import { canManageOffice, useAuth } from '@/auth.jsx';
import EditFileDialog from '@/components/EditFileDialog.jsx';
import RegisterFile from '@/components/RegisterFile.jsx';
import RowMenu from '@/components/RowMenu.jsx';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useOffices } from '@/office.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const SELECTED_KEY = 'selectedFiles';

export default function SearchPage() {
  const { user } = useAuth();
  const { officeId, officeName } = useOffices();
  const navigate = useNavigate();
  const allOffices = officeId === '';
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  // Bumped after registering a file so the list below picks it up.
  const [reloadKey, setReloadKey] = useState(0);
  // The file open in the edit dialog.
  const [editing, setEditing] = useState(null);
  // Ids of files ticked for label printing. Kept for this browser session, so the ticks are still there
  // after opening the labels and coming back.
  const [selected, setSelected] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(SELECTED_KEY)) ?? [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(SELECTED_KEY, JSON.stringify(selected));
    } catch {}
  }, [selected]);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .get(`/files?q=${encodeURIComponent(q)}&officeId=${encodeURIComponent(officeId)}`)
        .then(setFiles)
        .catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, officeId, reloadKey]);

  const canRemove = (f) => canManageOffice(user, f.officeId) || f.createdBy === user.id;

  function saved(file) {
    setFiles((fs) => fs.map((f) => (f.id === file.id ? file : f)));
    setEditing(null);
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

  // Ticked files stay ticked across searches, so labels can be gathered from several searches.
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allShown = files.length > 0 && files.every((f) => selected.includes(f.id));
  const toggleAllShown = () =>
    setSelected((s) => (allShown ? s.filter((id) => !files.some((f) => f.id === id)) : [...new Set([...s, ...files.map((f) => f.id)])]));

  const selectBox = (f) => (
    <Checkbox checked={selected.includes(f.id)} onCheckedChange={() => toggle(f.id)} aria-label={`Select ${f.fileNumber}`} />
  );
  const fmtDate = (iso) => new Date(iso).toLocaleDateString();

  // The row menu (print label, edit, remove), shared by the phone list and the table.
  const actions = (f) => (
    <RowMenu label={`Actions for ${f.fileNumber}`}>
      <DropdownMenuItem onSelect={() => navigate(`/labels?files=${f.id}`)}><Printer /> Print label</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setEditing(f)}><Pencil /> Edit</DropdownMenuItem>
      {canRemove(f) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => remove(f)}><Trash2 /> Remove</DropdownMenuItem>
        </>
      )}
    </RowMenu>
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Files</CardTitle>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <RegisterFile onSaved={() => setReloadKey((k) => k + 1)} />
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setSelected([])}>Clear</Button>
                <Button variant="secondary" asChild>
                  <Link to={`/labels?files=${selected.join(',')}`}>
                    <Printer /> Print {selected.length} label{selected.length > 1 ? 's' : ''}
                  </Link>
                </Button>
              </div>
            )}
          </div>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {q ? 'No matching files' : 'No files recorded yet'}
              {allOffices ? '.' : ` in ${officeName(officeId)}.`}
            </p>
          ) : (
            <>
              {/* Phones: one card per file. */}
              <div className="grid gap-2 md:hidden">
                <label className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                  <Checkbox checked={allShown} onCheckedChange={toggleAllShown} /> Select all {files.length} shown
                </label>
                <ul className="grid gap-2">
                  {files.map((f) => (
                    <li
                      key={f.id}
                      className="rounded-lg border p-3 data-[state=selected]:bg-muted"
                      data-state={selected.includes(f.id) ? 'selected' : undefined}
                    >
                      <div className="flex items-start gap-3">
                        <div className="pt-2">{selectBox(f)}</div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold break-words">{f.fileNumber}</p>
                          <p className="break-words">{f.name}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Box{' '}
                            <Link to={`/boxes/${f.boxId}`} className="font-medium text-foreground underline underline-offset-4">{f.boxName}</Link>
                            {' · '}{f.areaName}
                            {allOffices && ` · ${f.officeName}`}
                          </p>
                          <p className="text-xs text-muted-foreground">{f.createdByName} · {fmtDate(f.createdAt)}</p>
                        </div>
                        <div className="-mt-1 -mr-1">{actions(f)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Tablets and up: a table. */}
              <div className="hidden min-w-0 md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"><Checkbox checked={allShown} onCheckedChange={toggleAllShown} aria-label="Select all shown files" /></TableHead>
                      <TableHead>File No.</TableHead>
                      <TableHead>File Name</TableHead>
                      <TableHead>File Box</TableHead>
                      <TableHead>Area</TableHead>
                      {allOffices && <TableHead>Office</TableHead>}
                      <TableHead>Recorded by</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((f) => (
                      <TableRow key={f.id} data-state={selected.includes(f.id) ? 'selected' : undefined}>
                        <TableCell>{selectBox(f)}</TableCell>
                        <TableCell className="font-semibold">{f.fileNumber}</TableCell>
                        <TableCell className="max-w-72 truncate" title={f.name}>{f.name}</TableCell>
                        <TableCell><Link to={`/boxes/${f.boxId}`} className="underline underline-offset-4">{f.boxName}</Link></TableCell>
                        <TableCell>{f.areaName}</TableCell>
                        {allOffices && <TableCell>{f.officeName}</TableCell>}
                        <TableCell>{f.createdByName}</TableCell>
                        <TableCell>{fmtDate(f.createdAt)}</TableCell>
                        <TableCell className="w-10 text-right">{actions(f)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <EditFileDialog file={editing} onClose={() => setEditing(null)} onSaved={saved} />
    </>
  );
}
