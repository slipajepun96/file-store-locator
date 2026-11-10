import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Inbox, Mail, Pencil, Plus, Search, Send, Trash2 } from 'lucide-react';
import { api } from '@/api.js';
import { canManageOffice, useAuth } from '@/auth.jsx';
import LetterFormDialog from '@/components/LetterFormDialog.jsx';
import RowMenu from '@/components/RowMenu.jsx';
import { DIRECTIONS, DepartmentSelect, LETTER_TEXT, StatusSelect, fmtDay, useLetterLists } from '@/letters.jsx';
import { useOffices } from '@/office.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TAB_ICONS = { inbound: Inbox, outbound: Send };

// The part of the letter's text that matched the search, with the match highlighted.
function Snippet({ text, q }) {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  return (
    <p className="text-xs break-words text-muted-foreground">
      {at === -1 ? text : (
        <>
          {text.slice(0, at)}
          <mark className="rounded-sm bg-lime/60 px-0.5 text-foreground">{text.slice(at, at + q.length)}</mark>
          {text.slice(at + q.length)}
        </>
      )}
    </p>
  );
}

// Letters, with a tab each for inbound and outbound: search and filter, record new ones, and open one to update
// its status or department. The tab and filters live in the URL, so Back from a letter returns to the same list.
export default function LettersPage() {
  const { user } = useAuth();
  const { officeId, officeName } = useOffices();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const direction = params.get('type') === 'outbound' ? 'outbound' : 'inbound';
  const text = LETTER_TEXT[direction];
  const { statuses, departments } = useLetterLists(direction);
  const q = params.get('q') ?? '';
  const statusId = params.get('status') ?? '';
  const departmentId = params.get('department') ?? '';
  const [letters, setLetters] = useState(null);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState(null);
  const allOffices = officeId === '';

  const setParam = (changes) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });

  // Each direction has its own statuses, so switching tabs clears the status filter.
  const changeTab = (d) => {
    setLetters(null);
    setParam({ type: d === 'outbound' ? 'outbound' : '', status: '' });
  };

  const load = () => {
    const query = new URLSearchParams({ direction, q, officeId, statusId, departmentId });
    return api.get(`/letters?${query}`).then(setLetters).catch((e) => setError(e.message));
  };

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [direction, q, officeId, statusId, departmentId]);

  const canRemove = (l) => canManageOffice(user, l.officeId) || l.createdBy === user.id;

  async function remove(letter) {
    if (!confirm(`Remove the letter "${letter.subject}" and its history?`)) return;
    try {
      await api.del(`/letters/${letter.id}`);
      setLetters((ls) => ls.filter((l) => l.id !== letter.id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function openEdit(letter) {
    try {
      setEditing(await api.get(`/letters/${letter.id}`));
    } catch (e) {
      setError(e.message);
    }
  }

  const actions = (l) => (
    <RowMenu label={`Actions for ${l.subject}`}>
      <DropdownMenuItem onSelect={() => navigate(`/letters/${l.id}`)}><FileText /> Open &amp; update status</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => openEdit(l)}><Pencil /> Edit details</DropdownMenuItem>
      {canRemove(l) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => remove(l)}><Trash2 /> Remove</DropdownMenuItem>
        </>
      )}
    </RowMenu>
  );

  // The other party (sender or recipient) and the date (received or sent; outbound drafts have none yet).
  const party = (l) => l[text.partyField];
  const date = (l) => (l[text.dateField] ? fmtDay(l[text.dateField]) : 'Not sent');
  const filtered = q || statusId || departmentId;

  const list = (
    <>
      {letters && letters.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {filtered ? `No matching ${direction} letters` : `No ${direction} letters recorded yet`}
          {allOffices ? '.' : ` in ${officeName(officeId)}.`}
        </p>
      )}

      {letters?.length > 0 && (
        <>
          {/* Phones: one card per letter. */}
          <ul className="grid gap-2 md:hidden">
            {letters.map((l) => (
              <li key={l.id} className="flex items-start gap-2 rounded-lg border p-3">
                <Link to={`/letters/${l.id}`} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{l.statusName}</Badge>
                    {l.departmentName && <Badge variant="secondary">{l.departmentName}</Badge>}
                  </div>
                  {l.letterNos.length > 0 && <p className="mt-1.5 text-sm font-semibold break-words">{l.letterNos.join(', ')}</p>}
                  <p className="mt-1.5 font-medium break-words">{l.subject}</p>
                  {l.contentSnippet && <Snippet text={l.contentSnippet} q={q.trim()} />}
                  <p className="text-sm break-words text-muted-foreground">
                    {text.party} {party(l)}
                    {l.referenceNo && ` · Ref ${l.referenceNo}`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {l[text.dateField] ? `${text.dateShort} ${date(l)}` : 'Not sent yet'}
                    {allOffices && ` · ${l.officeName}`}
                    {l.fileCount > 0 && ` · ${l.fileCount} file${l.fileCount > 1 ? 's' : ''}`}
                  </p>
                </Link>
                <div className="-mt-1 -mr-1">{actions(l)}</div>
              </li>
            ))}
          </ul>

          {/* Tablets and up: a table. */}
          <div className="hidden min-w-0 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Letter No.</TableHead>
                  <TableHead>{text.dateShort}</TableHead>
                  <TableHead>{text.party}</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Ref. No.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Department</TableHead>
                  {allOffices && <TableHead>Office</TableHead>}
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {letters.map((l) => (
                  <TableRow key={l.id} className="cursor-pointer" onClick={(e) => !e.target.closest('button,a,[role=menu]') && navigate(`/letters/${l.id}`)}>
                    <TableCell className="font-semibold">
                      {l.letterNos[0] ?? <span className="font-normal text-muted-foreground">—</span>}
                      {l.letterNos.length > 1 && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground" title={l.letterNos.join('\n')}>+{l.letterNos.length - 1}</span>
                      )}
                    </TableCell>
                    <TableCell className={l[text.dateField] ? undefined : 'text-muted-foreground'}>{date(l)}</TableCell>
                    <TableCell className="max-w-48 truncate" title={party(l)}>{party(l)}</TableCell>
                    <TableCell className="max-w-72" title={l.subject}>
                      <Link to={`/letters/${l.id}`} className="block truncate font-medium hover:underline">{l.subject}</Link>
                      {l.contentSnippet && (
                        <div className="whitespace-normal">
                          <Snippet text={l.contentSnippet} q={q.trim()} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{l.referenceNo || '—'}</TableCell>
                    <TableCell><Badge variant="outline">{l.statusName}</Badge></TableCell>
                    <TableCell>{l.departmentName ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                    {allOffices && <TableCell>{l.officeName}</TableCell>}
                    <TableCell className="text-right">{l.fileCount || '—'}</TableCell>
                    <TableCell className="w-10 text-right">{actions(l)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {!letters && !error && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Mail className="size-4" /> Loading letters…</p>
      )}
    </>
  );

  return (
    <>
      <Card>
        <Tabs value={direction} onValueChange={changeTab} className="gap-4 sm:gap-6">
          <CardHeader className="gap-3">
            <CardTitle className="text-2xl">Letters</CardTitle>
            <TabsList className="w-full sm:w-fit">
              {DIRECTIONS.map((d) => {
                const Icon = TAB_ICONS[d];
                return (
                  <TabsTrigger key={d} value={d}>
                    <Icon /> {LETTER_TEXT[d].tab}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-11 pl-9 text-base md:text-base"
                placeholder={`Search by ${direction === 'inbound' ? 'sender' : 'recipient'}, subject, letter text, reference or file number…`}
                value={q}
                onChange={(e) => setParam({ q: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setRecording(true)}><Plus /> {text.record}</Button>
              <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto">
                <StatusSelect statuses={statuses} value={statusId} onChange={(v) => setParam({ status: v })} allLabel="All statuses" />
                <DepartmentSelect departments={departments} value={departmentId} onChange={(v) => setParam({ department: v })} allLabel="All departments" />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {DIRECTIONS.map((d) => (
              <TabsContent key={d} value={d} className="grid min-w-0 gap-4">
                {d === direction && list}
              </TabsContent>
            ))}
          </CardContent>
        </Tabs>
      </Card>

      <LetterFormDialog open={recording} onOpenChange={setRecording} direction={direction} onSaved={load} />
      <LetterFormDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} letter={editing} onSaved={load} />
    </>
  );
}
