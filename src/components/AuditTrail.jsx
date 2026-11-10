import { useEffect, useState } from 'react';
import { api } from '@/api.js';
import { ROLE_NAMES } from '@/auth.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// What each kind of entry is about, for the filter and the badge on each row.
const TYPE_LABELS = {
  auth: 'Sign-in',
  account: 'Account',
  office: 'Office',
  area: 'Area',
  box: 'File box',
  file: 'File',
  letter: 'Letter',
  status: 'Letter status',
  department: 'Department',
  settings: 'Settings',
};
const ALL = 'all';

const fmtTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

// A YYYY-MM-DD from a date input → the start of that day in the viewer's own time zone.
const startOfDay = (day, addDays = 0) => {
  const d = new Date(`${day}T00:00`);
  d.setDate(d.getDate() + addDays);
  return d.toISOString();
};

function buildQuery({ q, type, from, to }, last) {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (type !== ALL) p.set('type', type);
  if (from) p.set('from', startOfDay(from));
  if (to) p.set('to', startOfDay(to, 1));
  if (last) {
    p.set('before', last.createdAt);
    p.set('beforeId', last.id);
  }
  return p.toString();
}

const who = (e) => (
  <>
    <span className="font-medium">{e.userName || 'Unknown'}</span>
    {e.userRole && <span className="text-muted-foreground"> · {ROLE_NAMES[e.userRole] ?? e.userRole}</span>}
  </>
);

const typeBadge = (e) => (
  <Badge variant="secondary" className="whitespace-nowrap">
    {TYPE_LABELS[e.targetType] ?? e.targetType ?? 'Other'}
  </Badge>
);

// Admins see every office's entries; an office admin sees their own office's.
export default function AuditTrail() {
  const [filters, setFilters] = useState({ q: '', type: ALL, from: '', to: '' });
  const [entries, setEntries] = useState([]);
  const [types, setTypes] = useState(Object.keys(TYPE_LABELS));
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load(append) {
    setLoading(true);
    try {
      const data = await api.get(`/audit?${buildQuery(filters, append ? entries.at(-1) : null)}`);
      setEntries((list) => (append ? [...list, ...data.entries] : data.entries));
      setMore(data.more);
      if (data.types) setTypes(data.types);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Reload when a filter changes; typing in the search box waits for a pause.
  useEffect(() => {
    const t = setTimeout(() => load(false), 300);
    return () => clearTimeout(t);
  }, [filters]);

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const filtered = filters.q || filters.type !== ALL || filters.from || filters.to;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Audit Trail</CardTitle>
        <CardDescription>
          Every change made in the app, newest first: who did it, when, and what changed. Entries can't be edited or removed.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
          <Input className="sm:col-span-2 lg:min-w-48 lg:flex-1" type="search" value={filters.q} onChange={set('q')} placeholder="Search by name or what was done" aria-label="Search the audit trail" />
          <Select value={filters.type} onValueChange={(type) => setFilters((f) => ({ ...f, type }))}>
            <SelectTrigger className="w-full sm:col-span-2 lg:w-44" aria-label="Kind of change"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Everything</SelectItem>
              {types.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="grid gap-1 text-xs text-muted-foreground">
            From
            <Input type="date" value={filters.from} max={filters.to || undefined} onChange={set('from')} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            To
            <Input type="date" value={filters.to} min={filters.from || undefined} onChange={set('to')} />
          </label>
          {filtered && (
            <Button variant="ghost" className="sm:col-span-2 lg:col-span-1" onClick={() => setFilters({ q: '', type: ALL, from: '', to: '' })}>
              Clear filters
            </Button>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && entries.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">{filtered ? 'No entries match these filters.' : 'Nothing recorded yet.'}</p>
        )}

        {/* Phones */}
        <ul className="divide-y rounded-lg border md:hidden">
          {entries.map((e) => (
            <li key={e.id} className="grid gap-1 px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">{fmtTime(e.createdAt)}</span>
                {typeBadge(e)}
              </div>
              <p className="break-words">{e.summary}</p>
              <p className="text-xs">{who(e)}{e.officeName && <span className="text-muted-foreground"> · {e.officeName}</span>}</p>
            </li>
          ))}
        </ul>

        {/* Tablets and up */}
        {entries.length > 0 && (
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">When</TableHead>
                  <TableHead className="w-48">Who</TableHead>
                  <TableHead className="w-28">Kind</TableHead>
                  <TableHead>What happened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="align-top text-muted-foreground tabular-nums">{fmtTime(e.createdAt)}</TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <p>{who(e)}</p>
                      {e.officeName && <p className="text-xs text-muted-foreground">{e.officeName}</p>}
                    </TableCell>
                    <TableCell className="align-top">{typeBadge(e)}</TableCell>
                    <TableCell className="align-top whitespace-normal break-words">{e.summary}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {loading && <p className="text-center text-sm text-muted-foreground">Loading…</p>}
        {more && !loading && (
          <Button variant="outline" className="justify-self-center" onClick={() => load(true)}>Show older entries</Button>
        )}
      </CardContent>
    </Card>
  );
}
