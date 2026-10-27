import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api } from '@/api.js';
import { useAuth } from '@/auth.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const dangerGhost = 'text-destructive hover:text-destructive';

function NameList({ title, endpoint, placeholder, items, onChange }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function add(e) {
    e.preventDefault();
    try {
      await api.post(endpoint, { name });
      setName('');
      setError('');
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(item) {
    if (!confirm(`Remove "${item.name}"?`)) return;
    try {
      await api.del(`${endpoint}/${item.id}`);
      setError('');
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <Input className="min-w-36 flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} required />
          <Button type="submit">Add</Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <ul className="divide-y">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between py-1.5 text-sm">
              <span>{i.name}</span>
              <Button variant="ghost" size="sm" className={dangerGhost} onClick={() => remove(i)}>Remove</Button>
            </li>
          ))}
          {items.length === 0 && <li className="py-2 text-sm text-muted-foreground">None yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

const EMPTY_INVITE = { name: '', email: '', role: 'worker' };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
const STATUS_BADGE = {
  active: 'bg-success/15 text-success',
  pending: 'bg-warning/20 text-amber-800 dark:text-warning',
  rejected: 'bg-destructive/15 text-destructive',
};

function UsersSection() {
  const { user: me, refresh } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY_INVITE);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => api.get('/users').then(setUsers);
  useEffect(() => { load(); }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function run(action, ok) {
    try {
      await action();
      setError('');
      setNotice(ok || '');
      await load();
      refresh();
      return true;
    } catch (err) {
      setError(err.message);
      setNotice('');
      return false;
    }
  }

  async function invite(e) {
    e.preventDefault();
    if (await run(() => api.post('/users', form), `${form.email} can now sign in with Google.`)) setForm(EMPTY_INVITE);
  }

  const update = (u, changes, ok) => run(() => api.put(`/users/${u.id}`, changes), ok);

  function resetPassword(u) {
    const password = prompt(`New password for ${u.name} (min. 8 characters):`);
    if (password) run(() => api.put(`/users/${u.id}/password`, { password }), `Password reset for ${u.name}.`);
  }

  function remove(u) {
    if (confirm(`Remove ${u.name}'s account? Files they recorded are kept. They can request access again.`))
      run(() => api.del(`/users/${u.id}`));
  }

  const pending = users.filter((u) => u.status === 'pending');
  const others = users.filter((u) => u.status !== 'pending');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Workers &amp; Accounts</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-success">{notice}</p>}

        {pending.length > 0 && (
          <div className="rounded-lg border border-warning/50 bg-warning/10 p-4">
            <h3 className="mb-2 font-semibold">Waiting for approval ({pending.length})</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Google email</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.name}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{fmtDate(u.createdAt)}</TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button size="sm" onClick={() => update(u, { status: 'active', role: 'worker' }, `${u.name} approved as worker.`)}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => update(u, { status: 'active', role: 'admin' }, `${u.name} approved as admin.`)}>Approve as admin</Button>
                      <Button size="sm" variant="ghost" className={dangerGhost} onClick={() => update(u, { status: 'rejected' }, `${u.name} rejected.`)}>Reject</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Pre-approve by Google email</h3>
          <form onSubmit={invite} className="flex flex-wrap gap-2">
            <Input className="min-w-36 flex-1" value={form.name} onChange={set('name')} placeholder="Worker name" required />
            <Input className="min-w-36 flex-1" type="email" value={form.email} onChange={set('email')} placeholder="name@gmail.com" autoCapitalize="none" required />
            <NativeSelect value={form.role} onChange={set('role')} aria-label="Role">
              <NativeSelectOption value="worker">Worker</NativeSelectOption>
              <NativeSelectOption value="admin">Admin</NativeSelectOption>
            </NativeSelect>
            <Button type="submit">Add</Button>
          </form>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Sign-in</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {others.map((u) => {
              const self = u.id === me.id;
              return (
                <TableRow key={u.id}>
                  <TableCell>{u.name}{self && <span className="text-muted-foreground"> (you)</span>}</TableCell>
                  <TableCell>{u.email || (u.username && `@${u.username}`)}{u.hasPassword && <span className="text-muted-foreground"> · password</span>}</TableCell>
                  <TableCell>
                    <NativeSelect size="sm" value={u.role} disabled={self} aria-label="Role" onChange={(e) => update(u, { role: e.target.value }, `${u.name} is now ${e.target.value}.`)}>
                      <NativeSelectOption value="worker">Worker</NativeSelectOption>
                      <NativeSelectOption value="admin">Admin</NativeSelectOption>
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_BADGE[u.status]}>
                      {u.status === 'active' ? (u.google || u.hasPassword ? 'active' : 'invited') : u.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{fmtDate(u.lastLoginAt)}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    {!self && u.status === 'active' && (
                      <Button size="sm" variant="ghost" className={dangerGhost} onClick={() => update(u, { status: 'rejected' }, `${u.name} can no longer sign in.`)}>Block</Button>
                    )}
                    {u.status === 'rejected' && (
                      <Button size="sm" variant="ghost" onClick={() => update(u, { status: 'active' }, `${u.name} approved.`)}>Approve</Button>
                    )}
                    {u.hasPassword && <Button size="sm" variant="ghost" onClick={() => resetPassword(u)}>Reset password</Button>}
                    {!self && <Button size="sm" variant="ghost" className={dangerGhost} onClick={() => remove(u)}>Remove</Button>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  const [areas, setAreas] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [boxForm, setBoxForm] = useState({ name: '', areaId: '' });
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');

  const loadAreas = () => api.get('/areas').then(setAreas);
  const loadBoxes = () => api.get('/boxes').then(setBoxes);

  useEffect(() => {
    loadAreas();
    loadBoxes();
  }, []);

  const areaName = (id) => areas.find((a) => a.id === id)?.name ?? '—';

  async function addBox(e) {
    e.preventDefault();
    try {
      await api.post('/boxes', boxForm);
      setBoxForm((f) => ({ ...f, name: '' }));
      setError('');
      loadBoxes();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeBox(box) {
    if (!confirm(`Remove file box "${box.name}"?`)) return;
    try {
      await api.del(`/boxes/${box.id}`);
      setSelected((s) => s.filter((id) => id !== box.id));
      setError('');
      loadBoxes();
    } catch (err) {
      setError(err.message);
    }
  }

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <h1 className="text-2xl font-semibold">Admin</h1>
      <UsersSection />
      <NameList title="File Box Areas" endpoint="/areas" placeholder="e.g. Rack A, Shelf 2" items={areas} onChange={loadAreas} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">File Boxes</CardTitle>
          {areas.length === 0 && <CardDescription>Add an area first, then create file boxes in it.</CardDescription>}
          {selected.length > 0 && (
            <CardAction>
              <Button asChild>
                <Link to={`/labels?ids=${selected.join(',')}`} target="_blank">
                  <Printer /> Print {selected.length} label{selected.length > 1 ? 's' : ''}
                </Link>
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="grid gap-3">
          {areas.length > 0 && (
            <form onSubmit={addBox} className="flex flex-wrap gap-2">
              <Input className="min-w-36 flex-1" value={boxForm.name} onChange={(e) => setBoxForm({ ...boxForm, name: e.target.value })} placeholder="File box name, e.g. BOX-001" required />
              <NativeSelect value={boxForm.areaId} onChange={(e) => setBoxForm({ ...boxForm, areaId: e.target.value })} required aria-label="Area">
                <NativeSelectOption value="">— Area —</NativeSelectOption>
                {areas.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}
              </NativeSelect>
              <Button type="submit">Add Box</Button>
            </form>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {boxes.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>File Box</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {boxes.map((b) => (
                  <TableRow key={b.id} data-state={selected.includes(b.id) ? 'selected' : undefined}>
                    <TableCell><Checkbox checked={selected.includes(b.id)} onCheckedChange={() => toggle(b.id)} aria-label={`Select ${b.name}`} /></TableCell>
                    <TableCell><Link to={`/boxes/${b.id}`} className="font-medium underline underline-offset-4">{b.name}</Link></TableCell>
                    <TableCell>{areaName(b.areaId)}</TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/labels?ids=${b.id}`} target="_blank">Label</Link>
                      </Button>
                      <Button variant="ghost" size="sm" className={dangerGhost} onClick={() => removeBox(b)}>Remove</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
