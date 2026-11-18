import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { Archive, ArrowRight, Clock, Download, FileText, FolderOpen, Inbox, Mail, MailOpen, Search, Send, Truck, UserCheck } from 'lucide-react';
import { api } from '@/api.js';
import { ROLE_NAMES, isManager, useAuth } from '@/auth.jsx';
import { useOffices } from '@/office.jsx';
import { LETTER_TEXT, fmtDay } from '@/letters.jsx';
import LetterFormDialog from '@/components/LetterFormDialog.jsx';
import { promptInstall, useCanInstall } from '@/pwa.js';
import RegisterFile from '@/components/RegisterFile.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const ago = (iso) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true });

// A count that links to where those things are listed.
function Stat({ icon: Icon, label, value, to, tone }) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-foreground/20 hover:bg-muted/40 sm:p-4"
    >
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground', tone)}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-semibold tabular-nums sm:text-2xl">{value ?? '—'}</span>
        <span className="block text-xs leading-tight break-words text-muted-foreground">{label}</span>
      </span>
    </Link>
  );
}

// One letter in a home page list. `meta` is the small line under the subject.
function LetterRow({ letter, meta, badge }) {
  return (
    <li>
      <Link to={`/letters/${letter.id}`} className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50">
        <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
          {letter.direction === 'outbound' ? <Send className="size-4" /> : <Mail className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium break-words">{letter.subject}</span>
          <span className="block text-xs break-words text-muted-foreground">{meta}</span>
        </span>
        {badge}
      </Link>
    </li>
  );
}

// A card holding a list of letters, with a count and an empty message.
function LetterList({ icon: Icon, title, description, count, empty, more, highlight, children }) {
  const has = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <Card className={cn('gap-0 pb-0', highlight && has && 'border-lime ring-1 ring-lime/60')}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" />
          {title}
          {count > 0 && <Badge variant={highlight ? 'default' : 'secondary'} className="tabular-nums">{count}</Badge>}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="px-0">
        {has ? (
          <ul className="divide-y border-t">{children}</ul>
        ) : (
          <p className="border-t px-6 py-4 text-sm text-muted-foreground">{empty}</p>
        )}
        {more && has && (
          <div className="border-t px-3 py-1.5">
            <Button variant="link" size="sm" className="h-auto px-0" asChild>
              <Link to={more.to}>{more.label} <ArrowRight /></Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const letterMeta = (l) => [l.letterNos[0], l.statusName, l.officeName].filter(Boolean).join(' · ');

// The page people land on after signing in: what needs their department's attention, quick ways to start the
// usual jobs, and a few counts for the office picked in the header.
export default function HomePage() {
  const { user } = useAuth();
  const { officeId, officeName } = useOffices();
  const navigate = useNavigate();
  const [home, setHome] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [recording, setRecording] = useState(null);
  const canInstall = useCanInstall();

  const load = () =>
    api
      .get(`/home?officeId=${encodeURIComponent(officeId)}`)
      .then((h) => {
        setHome(h);
        setError('');
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [officeId]);

  const department = home?.department;
  const manager = isManager(user);
  const counts = home?.counts ?? {};
  const scope = officeId ? officeName(officeId) : 'all offices';
  const deptLetters = department && `/letters?department=${department.id}`;

  const findFile = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/files?q=${encodeURIComponent(q.trim())}` : '/files');
  };

  return (
    <>
      <section className="grid gap-4 rounded-2xl bg-header p-4 text-header-foreground sm:p-6">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting()}, {user.name.split(' ')[0]}
          </h1>
          <p className="text-sm text-header-foreground/75">
            {[ROLE_NAMES[user.role], user.officeId && officeName(user.officeId), department?.name].filter(Boolean).join(' · ')}
          </p>
        </div>
        <form onSubmit={findFile} className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a file by number or name"
              aria-label="Find a file"
              className="h-11 bg-background pl-9 text-foreground"
            />
          </div>
          <Button type="submit" className="h-11 bg-lime text-lime-foreground hover:bg-lime/90">Search</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRecording('inbound')}><Inbox /> {LETTER_TEXT.inbound.record}</Button>
          <Button variant="secondary" size="sm" onClick={() => setRecording('outbound')}><Send /> {LETTER_TEXT.outbound.record}</Button>
          <RegisterFile variant="secondary" size="sm" onSaved={load} />
          {canInstall && (
            <Button size="sm" className="bg-lime text-lime-foreground hover:bg-lime/90 sm:ml-auto" onClick={promptInstall}>
              <Download /> Install app
            </Button>
          )}
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {manager && user.pendingCount > 0 && (
        <Link
          to="/settings/accounts"
          className="flex items-center gap-3 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm transition-colors hover:bg-warning/20"
        >
          <UserCheck className="size-4 shrink-0" />
          <span className="flex-1">
            <span className="font-medium">{user.pendingCount} {user.pendingCount === 1 ? 'person is' : 'people are'}</span> waiting for
            approval to sign in.
          </span>
          <ArrowRight className="size-4 shrink-0" />
        </Link>
      )}

      <section aria-label={`Counts for ${scope}`} className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        <Stat icon={FolderOpen} label="Files" value={counts.files} to="/files" />
        <Stat icon={Archive} label="File boxes" value={counts.boxes} to="/files" />
        <Stat icon={Mail} label="Inbound letters" value={counts.inbound} to="/letters" />
        <Stat icon={Send} label="Outbound letters" value={counts.outbound} to="/letters?type=outbound" />
        <Stat
          icon={FileText}
          label="Letters not in a file"
          value={counts.unfiled}
          to="/letters"
          tone={counts.unfiled > 0 && 'bg-warning/20 text-amber-800 dark:text-warning'}
        />
      </section>
      <p className="-mt-2 text-xs text-muted-foreground sm:-mt-4">Counts for {scope}. Change the office in the header.</p>

      {home && !department && (
        <Card>
          <CardContent className="flex items-start gap-3 text-sm">
            <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p>
              You're not in a department yet, so there are no department letters to show.
              {manager ? ' You can add yourself to one under Settings → Workers & Accounts.' : ' Ask an admin to add you to yours.'}
            </p>
          </CardContent>
        </Card>
      )}

      {home && (
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 lg:items-start">
          {department && (
            <div className="grid gap-4 sm:gap-6">
              <LetterList
                icon={MailOpen}
                title="To receive"
                description={`Sent to ${department.name}. Open each one to mark it received.`}
                count={home.toReceive.length}
                empty={`Nothing waiting for ${department.name}.`}
                highlight
              >
                {home.toReceive.map((l) => (
                  <LetterRow
                    key={l.transfer.id}
                    letter={l}
                    meta={`From ${l.transfer.fromDepartmentName ?? 'unassigned'} · sent ${ago(l.transfer.sentAt)} by ${l.transfer.sentByName}`}
                  />
                ))}
              </LetterList>

              <LetterList
                icon={FolderOpen}
                title={`With ${department.name}`}
                count={home.withDepartmentCount}
                empty={`${department.name} has no letters right now.`}
                more={home.withDepartmentCount > home.withDepartment.length && { to: deptLetters, label: `All ${home.withDepartmentCount} letters` }}
              >
                {home.withDepartment.map((l) => (
                  <LetterRow key={l.id} letter={l} meta={letterMeta(l)} />
                ))}
              </LetterList>
            </div>
          )}

          <div className="grid gap-4 sm:gap-6">
            {department && (
              <LetterList
                icon={Send}
                title="Sent, not received yet"
                description={`Sent by ${department.name}. Cancel a send from the letter's page.`}
                count={home.sentAwaiting.length}
                empty="Every letter you sent has been received."
              >
                {home.sentAwaiting.map((l) => (
                  <LetterRow
                    key={l.transfer.id}
                    letter={l}
                    meta={`To ${l.transfer.toDepartmentName} · sent ${ago(l.transfer.sentAt)}`}
                  />
                ))}
              </LetterList>
            )}

            {manager && (
              <LetterList
                icon={Truck}
                title="On the way between departments"
                description={user.role === 'admin' ? `Every letter not received yet, in ${scope}.` : `Letters of ${officeName(user.officeId)} not received yet.`}
                count={home.inTransit.length}
                empty="No letters on the way."
              >
                {home.inTransit.map((l) => (
                  <LetterRow
                    key={l.transfer.id}
                    letter={l}
                    meta={`${l.transfer.fromDepartmentName ?? 'Unassigned'} → ${l.transfer.toDepartmentName} · ${ago(l.transfer.sentAt)}`}
                  />
                ))}
              </LetterList>
            )}

            <LetterList
              icon={Clock}
              title="Recently recorded"
              empty={`No letters recorded in ${scope} yet.`}
              more={{ to: '/letters', label: 'All letters' }}
            >
              {home.recent.map((l) => (
                <LetterRow
                  key={l.id}
                  letter={l}
                  meta={`${l[LETTER_TEXT[l.direction].partyField]} · ${l[LETTER_TEXT[l.direction].dateField] ? fmtDay(l[LETTER_TEXT[l.direction].dateField]) : 'not sent yet'} · ${l.createdByName}`}
                  badge={l.departmentName && <Badge variant="secondary" className="shrink-0">{l.departmentName}</Badge>}
                />
              ))}
            </LetterList>
          </div>
        </div>
      )}

      {!home && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      <LetterFormDialog
        open={Boolean(recording)}
        onOpenChange={(o) => !o && setRecording(null)}
        direction={recording ?? 'inbound'}
        onSaved={(letter) => navigate(`/letters/${letter.id}`)}
      />
    </>
  );
}
