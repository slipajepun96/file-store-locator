import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, useParams } from 'react-router-dom';
import { Archive, ArrowDown, ArrowUp, Ban, Building2, Check, History, KeyRound, ListChecks, Network, Pencil, Printer, Trash2, Users } from 'lucide-react';
import { api } from '@/api.js';
import { ROLE_NAMES, useAuth } from '@/auth.jsx';
import { cn } from '@/lib/utils';
import { DIRECTIONS, LETTER_TEXT } from '@/letters.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOffices } from '@/office.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import AuditTrail from '@/components/AuditTrail.jsx';
import OfficeSelect from '@/components/OfficeSelect.jsx';
import RowMenu from '@/components/RowMenu.jsx';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const dangerGhost = 'text-destructive hover:text-destructive';

// A card listing named things with an Add form, and Rename / Move / Remove in each row's menu.
// `extra` is sent along with each new name, e.g. the office an area belongs to. With canMove, items can be
// moved up and down (endpoint/:id/move), for lists whose order matters.
function NameList({ title, description, endpoint, placeholder, items, onChange, extra, canRename, canMove }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function run(action) {
    try {
      await action();
      setError('');
      onChange();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function add(e) {
    e.preventDefault();
    if (await run(() => api.post(endpoint, { ...extra, name }))) setName('');
  }

  function remove(item) {
    if (confirm(`Remove "${item.name}"?`)) run(() => api.del(`${endpoint}/${item.id}`));
  }

  function rename(item) {
    const next = prompt(`New name for "${item.name}":`, item.name)?.trim();
    if (next && next !== item.name) run(() => api.put(`${endpoint}/${item.id}`, { name: next }));
  }

  const move = (item, direction) => run(() => api.post(`${endpoint}/${item.id}/move`, { direction }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        <form onSubmit={add} className="flex gap-2">
          <Input className="min-w-0 flex-1" aria-label={title} value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} required />
          <Button type="submit">Add</Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <ul className="divide-y">
          {items.map((i, n) => (
            <li key={i.id} className="flex items-center justify-between gap-2 py-1 text-sm">
              <span className="min-w-0 break-words">
                {canMove && <span className="mr-2 text-muted-foreground tabular-nums">{n + 1}.</span>}
                {i.name}
              </span>
              <RowMenu label={`Actions for ${i.name}`}>
                {canRename && <DropdownMenuItem onSelect={() => rename(i)}><Pencil /> Rename</DropdownMenuItem>}
                {canMove && (
                  <>
                    <DropdownMenuItem disabled={n === 0} onSelect={() => move(i, 'up')}><ArrowUp /> Move up</DropdownMenuItem>
                    <DropdownMenuItem disabled={n === items.length - 1} onSelect={() => move(i, 'down')}><ArrowDown /> Move down</DropdownMenuItem>
                  </>
                )}
                {(canRename || canMove) && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onSelect={() => remove(i)}><Trash2 /> Remove</DropdownMenuItem>
              </RowMenu>
            </li>
          ))}
          {items.length === 0 && <li className="py-2 text-sm text-muted-foreground">None yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

const EMPTY_INVITE = { name: '', email: '', role: 'worker' };
const ROLE_OPTIONS = ['worker', 'office_admin', 'admin'];
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
const STATUS_BADGE = {
  active: 'bg-success/15 text-success',
  pending: 'bg-warning/20 text-amber-800 dark:text-warning',
  rejected: 'bg-destructive/15 text-destructive',
};

// A role picker. onChange gets the role.
function RoleSelect({ value, onChange, disabled, label = 'Role', size, className }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size={size} className={className} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{ROLE_NAMES[r]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// Admins manage every account. Office admins see sign-up requests and their own office's workers.
function UsersSection({ managedOfficeId }) {
  const { user: me, refresh } = useAuth();
  const { officeName } = useOffices();
  const isAdmin = me.role === 'admin';
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY_INVITE);
  // The office chosen for each waiting request, by user id (admins pick; office admins approve into their own).
  const [requestOffice, setRequestOffice] = useState({});
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
    const body = { ...form, officeId: form.officeId ?? managedOfficeId };
    if (await run(() => api.post('/users', body), `${form.email} can now sign in with Google.`)) setForm(EMPTY_INVITE);
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

  const approve = (u, role) => {
    const officeId = isAdmin ? (requestOffice[u.id] ?? managedOfficeId) : me.officeId;
    const where = officeId ? ` in ${officeName(officeId)}` : '';
    return update(u, { status: 'active', role, officeId }, `${u.name} approved as ${ROLE_NAMES[role].toLowerCase()}${where}.`);
  };

  const pending = users.filter((u) => u.status === 'pending');
  const others = users.filter((u) => u.status !== 'pending');

  // Pieces shared by the phone cards and the tables.
  const requestOfficeSelect = (u) => (
    <OfficeSelect
      size="sm"
      emptyLabel="No office"
      value={requestOffice[u.id] ?? managedOfficeId}
      onChange={(id) => setRequestOffice((r) => ({ ...r, [u.id]: id }))}
      label={`Office for ${u.name}`}
    />
  );
  // Approve stays a button; the other choices are in the row menu.
  const requestActions = (u) => (
    <div className="flex items-center justify-end gap-1">
      <Button size="sm" onClick={() => approve(u, 'worker')}>
        <Check /> {isAdmin ? 'Approve' : `Approve into ${officeName(me.officeId)}`}
      </Button>
      <RowMenu label={`More for ${u.name}`}>
        {isAdmin && (
          <>
            <DropdownMenuItem onSelect={() => approve(u, 'office_admin')}>Approve as office admin</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => approve(u, 'admin')}>Approve as admin</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => update(u, { status: 'rejected' }, `${u.name} rejected.`)}><Ban /> Reject</DropdownMenuItem>
      </RowMenu>
    </div>
  );
  const signIn = (u) => (
    <>
      {u.email || (u.username && `@${u.username}`)}
      {u.hasPassword && <span className="text-muted-foreground"> · password</span>}
    </>
  );
  const roleControl = (u, className) =>
    isAdmin ? (
      <RoleSelect
        size="sm"
        className={className}
        value={u.role}
        disabled={u.id === me.id}
        label={`Role for ${u.name}`}
        onChange={(role) => update(u, { role }, `${u.name} is now ${ROLE_NAMES[role].toLowerCase()}.`)}
      />
    ) : (
      ROLE_NAMES[u.role]
    );
  const officeControl = (u, className) =>
    isAdmin ? (
      <OfficeSelect
        size="sm"
        className={className}
        emptyLabel="No office"
        value={u.officeId}
        label={`Office for ${u.name}`}
        onChange={(id) => update(u, { officeId: id }, `${u.name} moved to ${id ? officeName(id) : 'no office'}.`)}
      />
    ) : (
      u.officeId ? officeName(u.officeId) : '—'
    );
  const statusBadge = (u) => (
    <Badge className={STATUS_BADGE[u.status]}>
      {u.status === 'active' ? (u.google || u.hasPassword ? 'active' : 'invited') : u.status}
    </Badge>
  );
  const accountActions = (u) => {
    const self = u.id === me.id;
    const canReset = isAdmin && u.hasPassword;
    if (self && !canReset) return null;
    return (
      <RowMenu label={`Actions for ${u.name}`}>
        {u.status === 'rejected' && (
          <DropdownMenuItem onSelect={() => update(u, { status: 'active' }, `${u.name} approved.`)}><Check /> Approve</DropdownMenuItem>
        )}
        {canReset && <DropdownMenuItem onSelect={() => resetPassword(u)}><KeyRound /> Reset password</DropdownMenuItem>}
        {!self && (
          <>
            {(u.status === 'rejected' || canReset) && <DropdownMenuSeparator />}
            {u.status === 'active' && (
              <DropdownMenuItem variant="destructive" onSelect={() => update(u, { status: 'rejected' }, `${u.name} can no longer sign in.`)}><Ban /> Block</DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onSelect={() => remove(u)}><Trash2 /> Remove</DropdownMenuItem>
          </>
        )}
      </RowMenu>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Workers &amp; Accounts</CardTitle>
        {!isAdmin && <CardDescription>Sign-up requests, and the workers of {officeName(me.officeId)}.</CardDescription>}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-5">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-success">{notice}</p>}

        {pending.length > 0 && (
          <div className="rounded-lg border border-warning/50 bg-warning/10 p-4">
            <h3 className="mb-2 font-semibold">Waiting for approval ({pending.length})</h3>
            {/* Phones */}
            <ul className="grid gap-2 md:hidden">
              {pending.map((u) => (
                <li key={u.id} className="grid gap-2 rounded-lg border bg-card p-3">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{u.name}</p>
                    <p className="text-sm break-all text-muted-foreground">{u.email}</p>
                    <p className="text-xs text-muted-foreground">Requested {fmtDate(u.createdAt)}</p>
                  </div>
                  {isAdmin && requestOfficeSelect(u)}
                  {requestActions(u)}
                </li>
              ))}
            </ul>
            {/* Tablets and up */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Google email</TableHead>
                    <TableHead>Requested</TableHead>
                    {isAdmin && <TableHead>Office</TableHead>}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{u.name}</TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>{fmtDate(u.createdAt)}</TableCell>
                      {isAdmin && <TableCell>{requestOfficeSelect(u)}</TableCell>}
                      <TableCell className="text-right">{requestActions(u)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Pre-approve by Google email</h3>
          <form onSubmit={invite} className="grid gap-2 sm:flex sm:flex-wrap">
            <Input className="sm:min-w-36 sm:flex-1" value={form.name} onChange={set('name')} placeholder="Worker name" aria-label="Name" required />
            <Input className="sm:min-w-36 sm:flex-1" type="email" value={form.email} onChange={set('email')} placeholder="name@gmail.com" aria-label="Google email" autoCapitalize="none" required />
            {isAdmin && (
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <RoleSelect className="w-full sm:w-fit" value={form.role} onChange={(role) => setForm((f) => ({ ...f, role }))} />
                <OfficeSelect emptyLabel="No office" value={form.officeId ?? managedOfficeId} onChange={(officeId) => setForm((f) => ({ ...f, officeId }))} />
              </div>
            )}
            <Button type="submit">Add</Button>
          </form>
        </div>

        {/* Phones */}
        <ul className="grid gap-2 md:hidden">
          {others.map((u) => (
            <li key={u.id} className="grid gap-2 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">{u.name}{u.id === me.id && <span className="text-muted-foreground"> (you)</span>}</p>
                  <p className="text-sm break-all text-muted-foreground">{signIn(u)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {statusBadge(u)}
                  {accountActions(u)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="grid min-w-0 gap-1">
                  <span className="text-xs text-muted-foreground">Role</span>
                  {roleControl(u, 'w-full sm:w-full')}
                </div>
                <div className="grid min-w-0 gap-1">
                  <span className="text-xs text-muted-foreground">Office</span>
                  {officeControl(u, 'w-full sm:w-full')}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Last sign-in {fmtDate(u.lastLoginAt)}</p>
            </li>
          ))}
        </ul>

        {/* Tablets and up */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name &amp; sign-in</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Office</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {others.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="whitespace-normal">
                    <p className="font-medium">{u.name}{u.id === me.id && <span className="font-normal text-muted-foreground"> (you)</span>}</p>
                    <p className="text-xs break-all text-muted-foreground">{signIn(u)}</p>
                  </TableCell>
                  <TableCell>{roleControl(u)}</TableCell>
                  <TableCell>{officeControl(u)}</TableCell>
                  <TableCell>{statusBadge(u)}</TableCell>
                  <TableCell>{fmtDate(u.lastLoginAt)}</TableCell>
                  <TableCell className="w-10 text-right">{accountActions(u)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// Areas and file boxes of one office. Admins pick the office; an office admin always manages their own.
function BoxesSection({ managedOfficeId }) {
  const { user } = useAuth();
  const { offices, officeId, setOfficeId, officeName } = useOffices();
  const isAdmin = user.role === 'admin';
  const [areas, setAreas] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [boxForm, setBoxForm] = useState({ name: '', areaId: '' });
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');

  const office = `?officeId=${encodeURIComponent(managedOfficeId)}`;
  const loadAreas = () => (managedOfficeId ? api.get(`/areas${office}`).then(setAreas) : setAreas([]));
  const loadBoxes = () => (managedOfficeId ? api.get(`/boxes${office}`).then(setBoxes) : setBoxes([]));

  useEffect(() => {
    loadAreas();
    loadBoxes();
    setSelected([]);
    setBoxForm({ name: '', areaId: '' });
    setError('');
  }, [managedOfficeId]);

  const areaName = (id) => areas.find((a) => a.id === id)?.name ?? '—';

  async function addBox(e) {
    e.preventDefault();
    if (!boxForm.areaId) return setError('Choose an area for the box.');
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
  const managedName = officeName(managedOfficeId);

  return (
    <>
      {isAdmin && offices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Office</span>
          <OfficeSelect value={officeId} onChange={setOfficeId} placeholder="Choose an office to manage" label="Office to manage" />
        </div>
      )}

      {!managedOfficeId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">File Box Areas &amp; File Boxes</CardTitle>
            <CardDescription>
              {offices.length === 0
                ? 'Add an office first, then add its areas and file boxes.'
                : 'Choose an office to manage its areas and file boxes.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <NameList
            title={`File Box Areas · ${managedName}`}
            endpoint="/areas"
            placeholder="e.g. Rack A, Shelf 2"
            items={areas}
            onChange={loadAreas}
            extra={{ officeId: managedOfficeId }}
          />

          <Card>
            <CardHeader className={selected.length > 0 ? 'sm:grid-cols-[1fr_auto]' : undefined}>
              <CardTitle className="text-lg">File Boxes · {managedName}</CardTitle>
              <CardDescription>
                {areas.length === 0
                  ? 'Add an area first, then create file boxes in it.'
                  : 'Box names must be unique across all offices.'}
              </CardDescription>
              {selected.length > 0 && (
                <div className="sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
                  <Button asChild>
                    <Link to={`/labels?ids=${selected.join(',')}`}>
                      <Printer /> Print {selected.length} label{selected.length > 1 ? 's' : ''}
                    </Link>
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              {areas.length > 0 && (
                <form onSubmit={addBox} className="grid gap-2 sm:flex sm:flex-wrap">
                  <Input className="sm:min-w-36 sm:flex-1" aria-label="File box name" value={boxForm.name} onChange={(e) => setBoxForm({ ...boxForm, name: e.target.value })} placeholder="File box name, e.g. BOX-001" required />
                  <Select value={boxForm.areaId} onValueChange={(areaId) => setBoxForm((f) => ({ ...f, areaId }))}>
                    <SelectTrigger className="w-full sm:w-fit sm:min-w-40" aria-label="Area"><SelectValue placeholder="Choose area" /></SelectTrigger>
                    <SelectContent>
                      {areas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="submit">Add Box</Button>
                </form>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              {boxes.length > 0 && (
                <>
                  {/* Phones */}
                  <ul className="divide-y rounded-lg border md:hidden">
                    {boxes.map((b) => (
                      <li key={b.id} className="flex items-center gap-3 px-3 py-2 data-[state=selected]:bg-muted" data-state={selected.includes(b.id) ? 'selected' : undefined}>
                        <Checkbox checked={selected.includes(b.id)} onCheckedChange={() => toggle(b.id)} aria-label={`Select ${b.name}`} />
                        <div className="min-w-0 flex-1">
                          <Link to={`/boxes/${b.id}`} className="font-medium break-words underline underline-offset-4">{b.name}</Link>
                          <p className="text-xs text-muted-foreground">{areaName(b.areaId)}</p>
                        </div>
                        <Button variant="ghost" size="icon" asChild>
                          <Link to={`/labels?ids=${b.id}`} aria-label={`Print label for ${b.name}`}><Printer /></Link>
                        </Button>
                        <Button variant="ghost" size="sm" className={dangerGhost} onClick={() => removeBox(b)}>Remove</Button>
                      </li>
                    ))}
                  </ul>
                  {/* Tablets and up */}
                  <div className="hidden md:block">
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
                                <Link to={`/labels?ids=${b.id}`}>Label</Link>
                              </Button>
                              <Button variant="ghost" size="sm" className={dangerGhost} onClick={() => removeBox(b)}>Remove</Button>
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
        </>
      )}
    </>
  );
}

// The Settings sections. adminOnly ones are hidden from office admins.
const SECTIONS = [
  { key: 'accounts', label: 'Workers & Accounts', icon: Users },
  { key: 'offices', label: 'Offices', icon: Building2, adminOnly: true },
  { key: 'boxes', label: 'Areas & File Boxes', icon: Archive },
  { key: 'statuses', label: 'Letter Statuses', icon: ListChecks, adminOnly: true },
  { key: 'departments', label: 'Departments', icon: Network, adminOnly: true },
  { key: 'audit', label: 'Audit Trail', icon: History },
];

// Settings: the section menu on the left (a scrolling row of tabs on phones) and the section on the right.
export default function SettingsPage() {
  const params = useParams();
  const section = params.section ?? 'accounts';
  const { user } = useAuth();
  const { offices, officeId, reload: reloadOffices } = useOffices();
  const isAdmin = user.role === 'admin';
  // Admins manage the office picked in the header; an office admin always manages their own office.
  const managedOfficeId = isAdmin ? officeId : user.officeId;
  const sections = SECTIONS.filter((s) => isAdmin || !s.adminOnly);
  const current = sections.find((s) => s.key === section);
  const [statuses, setStatuses] = useState([]);
  // Inbound and outbound letters each have their own statuses, on a tab each.
  const [statusDirection, setStatusDirection] = useState('inbound');
  const [departments, setDepartments] = useState([]);
  const loadStatuses = () => api.get(`/letter-statuses?direction=${statusDirection}`).then(setStatuses);
  const loadDepartments = () => api.get('/departments').then(setDepartments);

  useEffect(() => {
    if (section === 'statuses') loadStatuses();
  }, [section, statusDirection]);
  useEffect(() => {
    if (section === 'departments') loadDepartments();
  }, [section]);

  if (!current) return <Navigate to="/settings" replace />;

  const linkClass = ({ isActive }) =>
    cn(
      'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-accent hover:text-accent-foreground',
      isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'
    );

  return (
    <>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)] md:items-start md:gap-6">
        <nav aria-label="Settings" className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1 md:sticky md:top-20 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
          {sections.map((s) => (
            <NavLink key={s.key} to={`/settings/${s.key}`} className={(state) => linkClass({ isActive: state.isActive || (s.key === 'accounts' && !params.section) })}>
              <s.icon className="size-4" />
              {s.label}
              {s.key === 'accounts' && user.pendingCount > 0 && (
                <Badge className="ml-auto bg-warning px-1.5 text-black" title="Waiting for approval">{user.pendingCount}</Badge>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-6">
          {section === 'accounts' && <UsersSection managedOfficeId={managedOfficeId} />}
          {section === 'offices' && (
            <NameList
              title="Offices"
              description="Each office has its own areas, file boxes, files and letters. An office with areas or letters can't be removed."
              endpoint="/offices"
              placeholder="e.g. Head Office, Branch 2"
              items={offices}
              onChange={reloadOffices}
              canRename
            />
          )}
          {section === 'boxes' && <BoxesSection managedOfficeId={managedOfficeId} />}
          {section === 'audit' && <AuditTrail />}
          {section === 'statuses' && (
            <Tabs
              value={statusDirection}
              onValueChange={(d) => {
                setStatuses([]);
                setStatusDirection(d);
              }}
            >
              <TabsList className="w-full sm:w-fit">
                {DIRECTIONS.map((d) => <TabsTrigger key={d} value={d}>{LETTER_TEXT[d].tab} letters</TabsTrigger>)}
              </TabsList>
              {DIRECTIONS.map((d) => (
                <TabsContent key={d} value={d}>
                  <NameList
                    title={`${LETTER_TEXT[d].tab} Letter Statuses`}
                    description={`The steps an ${d} letter goes through. New ${d} letters start at the first one; the order here is the order in the status pickers. A status that letters still use can't be removed.`}
                    endpoint="/letter-statuses"
                    placeholder={d === 'inbound' ? 'e.g. Awaiting reply' : 'e.g. Awaiting signature'}
                    items={statuses}
                    onChange={loadStatuses}
                    extra={{ direction: d }}
                    canRename
                    canMove
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}
          {section === 'departments' && (
            <NameList
              title="Departments"
              description="Departments a letter can be assigned to. A department that letters are still assigned to can't be removed."
              endpoint="/departments"
              placeholder="e.g. Finance, Legal"
              items={departments}
              onChange={loadDepartments}
              canRename
            />
          )}
        </div>
      </div>
    </>
  );
}
