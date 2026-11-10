import { useEffect, useState } from 'react';
import { api } from '@/api.js';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export const DIRECTIONS = ['inbound', 'outbound'];

// A letter's code in a file: the file number, then its running number there, e.g. "F-100/Bil. (24)".
// The server builds the same text (LETTER_NO_SQL in server/letters.js).
export const letterCode = (fileNumber, n) => `${fileNumber}/Bil. (${n})`;

// The words that differ between inbound and outbound letters, and which fields hold the other party and the date.
export const LETTER_TEXT = {
  inbound: {
    tab: 'Inbound',
    record: 'Record Inbound Letter',
    title: 'Record an Inbound Letter',
    party: 'From',
    partyField: 'sender',
    partyPlaceholder: 'Sender or organisation',
    date: 'Date received',
    dateShort: 'Received',
    dateField: 'receivedDate',
    office: 'Received by office',
  },
  outbound: {
    tab: 'Outbound',
    record: 'Record Outbound Letter',
    title: 'Record an Outbound Letter',
    party: 'To',
    partyField: 'recipient',
    partyPlaceholder: 'Recipient or organisation',
    date: 'Date sent',
    dateShort: 'Sent',
    dateField: 'sentDate',
    office: 'Sent from office',
  },
};

// Letter statuses for one direction, and departments, as set by admins under Settings.
export function useLetterLists(direction) {
  const [statuses, setStatuses] = useState([]);
  const [departments, setDepartments] = useState([]);
  useEffect(() => {
    if (!direction) return;
    Promise.all([api.get(`/letter-statuses?direction=${direction}`), api.get('/departments')]).then(([s, d]) => {
      setStatuses(s);
      setDepartments(d);
    });
  }, [direction]);
  return { statuses, departments };
}

// Today as YYYY-MM-DD in the person's own time zone (what <input type="date"> uses).
export const today = () => new Date().toLocaleDateString('en-CA');

// Shows a YYYY-MM-DD date in the person's locale, without shifting it across time zones.
export const fmtDay = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString() : '—');

// Radix Select items can't have an empty value, so "all" and "none" use stand-ins.
const ALL = '__all__';
const NONE = '__none__';

// A department picker. value/onChange use '' for "no department". With allLabel, it's a filter instead:
// '' means all departments and 'none' means letters with no department.
export function DepartmentSelect({ departments, value, onChange, allLabel, size, className, id, label = 'Department' }) {
  const toSelect = (v) => (allLabel ? (v === '' ? ALL : v === 'none' ? NONE : v) : v || NONE);
  const fromSelect = (v) => (allLabel ? (v === ALL ? '' : v === NONE ? 'none' : v) : v === NONE ? '' : v);
  return (
    <Select value={toSelect(value)} onValueChange={(v) => onChange(fromSelect(v))}>
      <SelectTrigger id={id} size={size} className={cn('w-full sm:w-fit sm:min-w-40', className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        <SelectItem value={NONE}>{allLabel ? 'Unassigned' : 'No department'}</SelectItem>
        {departments.length > 0 && <SelectSeparator />}
        {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// A status picker. With allLabel, '' means all statuses (a filter).
export function StatusSelect({ statuses, value, onChange, allLabel, size, className, id, label = 'Status' }) {
  return (
    <Select value={allLabel && !value ? ALL : value} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger id={id} size={size} className={cn('w-full sm:w-fit sm:min-w-40', className)} aria-label={label}>
        <SelectValue placeholder="Choose status" />
      </SelectTrigger>
      <SelectContent>
        {allLabel && (
          <>
            <SelectItem value={ALL}>{allLabel}</SelectItem>
            <SelectSeparator />
          </>
        )}
        {statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
