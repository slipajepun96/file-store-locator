import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/api.js';
import { canManageOffice, useAuth } from '@/auth.jsx';
import LetterFormDialog from '@/components/LetterFormDialog.jsx';
import { DepartmentSelect, LETTER_TEXT, StatusSelect, fmtDay, useLetterLists } from '@/letters.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// A letter's text, cut to a few lines with "Show all" when it's long.
const COLLAPSED_CHARS = 700;
function LetterText({ text }) {
  const [open, setOpen] = useState(false);
  const long = text.length > COLLAPSED_CHARS;
  return (
    <div className="grid gap-2">
      <p className="text-sm break-words whitespace-pre-wrap">{long && !open ? `${text.slice(0, COLLAPSED_CHARS).trimEnd()}…` : text}</p>
      {long && (
        <Button variant="link" size="sm" className="h-auto justify-self-start p-0" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : 'Show all'}
        </Button>
      )}
    </div>
  );
}

const fmtTime = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// One letter: its details, the files it's in, a form to update its status or department, and its history.
export default function LetterPage() {
  const { user } = useAuth();
  const { letterId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [letter, setLetter] = useState(null);
  // Statuses load once the letter (and so its direction) is known.
  const { statuses, departments } = useLetterLists(letter?.direction);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [update, setUpdate] = useState({ statusId: '', departmentId: '', note: '' });
  const [updateMsg, setUpdateMsg] = useState(null);

  const load = () =>
    api
      .get(`/letters/${letterId}`)
      .then((l) => {
        setLetter(l);
        setUpdate({ statusId: l.statusId, departmentId: l.departmentId ?? '', note: '' });
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, [letterId]);

  // The letter's tab on the Letters page.
  const listUrl = letter?.direction === 'outbound' ? '/letters?type=outbound' : '/letters';

  // Back to the list the letter was opened from (keeping its filters), or to Letters.
  const goBack = (e) => {
    if (location.key === 'default') return;
    e.preventDefault();
    navigate(-1);
  };

  async function saveUpdate(e) {
    e.preventDefault();
    try {
      await api.post(`/letters/${letter.id}/updates`, update);
      setUpdateMsg({ ok: true, text: 'Letter updated.' });
      await load();
    } catch (err) {
      setUpdateMsg({ ok: false, text: err.message });
    }
  }

  async function remove() {
    if (!confirm(`Remove the letter "${letter.subject}" and its history?`)) return;
    try {
      await api.del(`/letters/${letter.id}`);
      navigate(listUrl, { replace: true });
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !letter) return <Card><CardContent className="text-destructive">{error}</CardContent></Card>;
  if (!letter) return <Card><CardContent className="text-muted-foreground">Loading…</CardContent></Card>;

  const text = LETTER_TEXT[letter.direction];
  const changed =
    update.statusId !== letter.statusId || (update.departmentId || null) !== letter.departmentId || update.note.trim() !== '';
  const detail = (label, value) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{value || '—'}</dd>
    </div>
  );

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link to={listUrl} onClick={goBack}><ArrowLeft /> {text.tab} letters</Link>
      </Button>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start sm:gap-6">
        <div className="grid gap-4 sm:gap-6">
          <Card>
            <CardHeader className="sm:grid-cols-[1fr_auto]">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge>{text.tab}</Badge>
                <Badge variant="outline">{letter.statusName}</Badge>
                <Badge variant="secondary">{letter.departmentName ?? 'Unassigned'}</Badge>
              </div>
              <CardTitle className="text-xl break-words sm:text-2xl">{letter.subject}</CardTitle>
              {letter.letterNos.length > 0 && (
                <p className="text-sm font-semibold break-words">Letter No. {letter.letterNos.join(', ')}</p>
              )}
              <div className="flex gap-2 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
                <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit</Button>
                {(canManageOffice(user, letter.officeId) || letter.createdBy === user.id) && (
                  <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remove}><Trash2 /> Remove</Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                {detail(text.party, letter[text.partyField])}
                {detail('Reference no.', letter.referenceNo)}
                {detail('Office', letter.officeName)}
                {detail('Letter date', letter.letterDate && fmtDay(letter.letterDate))}
                {detail(text.date, letter[text.dateField] ? fmtDay(letter[text.dateField]) : 'Not sent yet')}
                {detail('Recorded by', letter.createdByName)}
              </dl>
              {letter.notes && (
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap">{letter.notes}</p>
                </div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Files ({letter.files.length})</CardTitle>
              <CardDescription>
                The files this letter is filed in, with its letter number in each. Use Edit to assign or remove files; a removed
                file's number isn't reused.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {letter.files.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not assigned to any file yet.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {letter.files.map((f) => (
                    <li key={f.id} className="px-3 py-2 text-sm">
                      <p className="font-semibold break-words">{f.letterNo}</p>
                      <p className="break-words">{f.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Box <Link to={`/boxes/${f.boxId}`} className="text-foreground underline underline-offset-4">{f.boxName}</Link>
                        {' · '}{f.areaName} · {f.officeName}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Letter text</CardTitle>
              <CardDescription>
                {letter.content ? 'Read from photos of the letter, for searching.' : 'No text yet. Use Edit → Scan photos to add it, so this letter can be found by what it says.'}
              </CardDescription>
            </CardHeader>
            {letter.content && (
              <CardContent>
                <LetterText text={letter.content} />
              </CardContent>
            )}
          </Card>
        </div>

        <div className="grid gap-4 sm:gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Update status</CardTitle>
              <CardDescription>Change the status or the department handling it. Each update is kept in the history.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveUpdate} className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="update-status">Status</Label>
                  <StatusSelect id="update-status" className="sm:w-full" statuses={statuses} value={update.statusId} onChange={(statusId) => setUpdate((u) => ({ ...u, statusId }))} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="update-department">Department</Label>
                  <DepartmentSelect id="update-department" className="sm:w-full" departments={departments} value={update.departmentId} onChange={(departmentId) => setUpdate((u) => ({ ...u, departmentId }))} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="update-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Textarea id="update-note" rows={2} value={update.note} onChange={(e) => setUpdate((u) => ({ ...u, note: e.target.value }))} placeholder="e.g. Forwarded to Legal for reply" />
                </div>
                <Button type="submit" disabled={!changed}>Save update</Button>
                {updateMsg && <p className={updateMsg.ok ? 'text-sm text-success' : 'text-sm text-destructive'}>{updateMsg.text}</p>}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-4 border-l pl-4">
                {letter.updates.map((u) => (
                  <li key={u.id} className="relative text-sm">
                    <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-foreground" aria-hidden="true" />
                    <p className="font-medium">
                      {u.statusName}
                      {u.departmentName && <span className="font-normal text-muted-foreground"> · {u.departmentName}</span>}
                    </p>
                    {u.note && <p className="whitespace-pre-wrap">{u.note}</p>}
                    <p className="text-xs text-muted-foreground">{u.createdByName} · {fmtTime(u.createdAt)}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      <LetterFormDialog open={editing} onOpenChange={setEditing} letter={letter} onSaved={load} />
    </>
  );
}
