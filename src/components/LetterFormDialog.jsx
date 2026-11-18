import { useEffect, useState } from 'react';
import { api } from '@/api.js';
import { useAuth } from '@/auth.jsx';
import DatePicker from '@/components/DatePicker.jsx';
import FilePicker from '@/components/FilePicker.jsx';
import LetterTextField, { LetterScan } from '@/components/LetterTextField.jsx';
import CorrespondentField, { useCorrespondents } from '@/components/CorrespondentField.jsx';
import OfficeSelect from '@/components/OfficeSelect.jsx';
import { DepartmentSelect, LETTER_TEXT, StatusSelect, today, useLetterLists } from '@/letters.jsx';
import { useOffices } from '@/office.jsx';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  useIsDesktop,
} from '@/components/ResponsiveDialog.jsx';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// An inbound letter defaults to being received today; an outbound one starts without a date sent (a draft).
const blank = (officeId, direction) => ({
  officeId,
  receivedDate: direction === 'inbound' ? today() : '',
  sentDate: '',
  sender: '',
  recipient: '',
  subject: '',
  referenceNo: '',
  letterDate: '',
  statusId: '',
  departmentId: '',
  notes: '',
  content: '',
  files: [],
});

// Record a new letter going in `direction` (letter = null) or edit one (a letter with its files), in a dialog
// (a drawer on phones). Opens while `open` is true.
// Status and department are only set here for a new letter; afterwards they change through status updates.
export default function LetterFormDialog({ open, onOpenChange, letter, direction: newDirection = 'inbound', onSaved }) {
  const { user } = useAuth();
  const { officeId } = useOffices();
  const direction = letter?.direction ?? newDirection;
  const text = LETTER_TEXT[direction];
  const inbound = direction === 'inbound';
  const { statuses, departments } = useLetterLists(direction);
  const correspondents = useCorrespondents(open);
  const [form, setForm] = useState(() => blank('', direction));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // On phones a focused field brings up the keyboard, so the first field is only focused on larger screens.
  const isDesktop = useIsDesktop();
  const editing = Boolean(letter);
  // Only admins choose the office; everyone else records letters in their own office (the server does the same).
  const isAdmin = user.role === 'admin';

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(
      letter
        ? {
            officeId: letter.officeId,
            receivedDate: letter.receivedDate ?? '',
            sentDate: letter.sentDate ?? '',
            sender: letter.sender,
            recipient: letter.recipient,
            subject: letter.subject,
            referenceNo: letter.referenceNo,
            letterDate: letter.letterDate ?? '',
            notes: letter.notes,
            content: letter.content ?? '',
            files: letter.files ?? [],
          }
        : blank(isAdmin ? officeId || user.officeId || '' : user.officeId || '', direction)
    );
    // By id, so a live reload of the same letter doesn't wipe what's being typed.
  }, [open, letter?.id, direction]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target?.value ?? e }));

  const listName = (name) => {
    const key = name?.trim().replace(/\s+/g, ' ').toLowerCase();
    return (key && correspondents.list.find((c) => c.name.toLowerCase() === key)?.name) || name;
  };

  // Details found in a scanned letter fill only the fields that are still empty, so nothing typed is replaced.
  // Returns the names of the fields filled, for the scan's message.
  function fillFromLetter(fields) {
    const targets = [
      ['referenceNo', fields.referenceNo, 'reference no.'],
      ['letterDate', fields.letterDate, 'letter date'],
      // A name read from the letter that's already on the list (in any capitalisation) uses the list's spelling.
      [text.partyField, listName(fields[text.partyField]), inbound ? 'sender' : 'recipient'],
      ['subject', fields.subject, 'subject'],
    ];
    const isEmpty = (f, key) => !String(f[key] ?? '').trim();
    const fill = targets.filter(([key, v]) => v && isEmpty(form, key));
    // Checked again against the latest form, in case something was typed while the letter was being read.
    setForm((f) => ({ ...f, ...Object.fromEntries(fill.filter(([key]) => isEmpty(f, key)).map(([key, v]) => [key, v])) }));
    return fill.map(([, , label]) => label);
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.officeId)
      return setError(
        isAdmin
          ? `Choose the office that ${inbound ? 'received' : 'sent'} the letter.`
          : "You're not in an office yet, so you can't record letters. Ask an admin to add you to yours."
      );
    setSaving(true);
    const body = { ...form, direction, fileIds: form.files.map((f) => f.id) };
    try {
      const saved = editing ? await api.put(`/letters/${letter.id}`, body) : await api.post('/letters', body);
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{editing ? `Edit ${text.tab} Letter` : text.title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {editing ? 'Change the details or the files this letter is in.' : `Recorded as ${user.name}.`} The letter number is given
            automatically from each file it's assigned to.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          <form id="letter-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            {isAdmin && (
              <div className="grid gap-2">
                <Label htmlFor="letter-office">{text.office}</Label>
                <OfficeSelect id="letter-office" className="sm:w-full sm:max-w-none" value={form.officeId} onChange={set('officeId')} />
              </div>
            )}
            <div className={isAdmin ? 'grid gap-2' : 'grid gap-2 sm:col-span-2'}>
              <Label htmlFor="letter-day">
                {text.date}
                {!inbound && <span className="font-normal text-muted-foreground"> (blank if not sent yet)</span>}
              </Label>
              <DatePicker id="letter-day" value={form[text.dateField]} onChange={set(text.dateField)} required={inbound} placeholder={inbound ? 'Pick a date' : 'Not sent yet'} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="letter-party">{text.party}</Label>
              <CorrespondentField
                id="letter-party"
                value={form[text.partyField]}
                onChange={set(text.partyField)}
                names={correspondents.list}
                onAdded={correspondents.reload}
                placeholder={`${text.partyPlaceholder}: type to search`}
                required
                autoFocus={isDesktop && !editing}
              />
            </div>
            <div className="sm:col-span-2">
              <LetterScan value={form.content} onChange={set('content')} onFields={fillFromLetter} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="letter-subject">Subject</Label>
              <Input id="letter-subject" value={form.subject} onChange={set('subject')} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="letter-ref">Reference no. <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="letter-ref" value={form.referenceNo} onChange={set('referenceNo')} placeholder={inbound ? 'Their reference' : 'Our reference'} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="letter-date">Letter date <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <DatePicker id="letter-date" value={form.letterDate} onChange={set('letterDate')} />
            </div>
            {!editing && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="letter-status">Status</Label>
                  <StatusSelect
                    id="letter-status"
                    className="sm:w-full"
                    statuses={statuses}
                    value={form.statusId || statuses[0]?.id || ''}
                    onChange={set('statusId')}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="letter-department">Department</Label>
                  <DepartmentSelect id="letter-department" className="sm:w-full" departments={departments} value={form.departmentId} onChange={set('departmentId')} />
                </div>
              </>
            )}
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="letter-files">Assign to files</Label>
              <FilePicker id="letter-files" value={form.files} onChange={set('files')} />
            </div>
            <div className="sm:col-span-2">
              <LetterTextField id="letter-text" value={form.content} onChange={set('content')} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="letter-notes">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="letter-notes" value={form.notes} onChange={set('notes')} rows={2} />
            </div>
          </form>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </ResponsiveDialogClose>
          <Button type="submit" form="letter-form" disabled={saving}>{editing ? 'Save' : 'Record Letter'}</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
