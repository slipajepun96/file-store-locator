import { useEffect, useState } from 'react';
import { api } from '@/api.js';
import { useAuth } from '@/auth.jsx';
import FilePicker from '@/components/FilePicker.jsx';
import LetterTextField from '@/components/LetterTextField.jsx';
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
  const [form, setForm] = useState(() => blank('', direction));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const editing = Boolean(letter);

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
        : blank(officeId || user.officeId || '', direction)
    );
  }, [open, letter, direction]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target?.value ?? e }));

  async function submit(e) {
    e.preventDefault();
    if (!form.officeId) return setError(`Choose the office that ${inbound ? 'received' : 'sent'} the letter.`);
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
            <div className="grid gap-2">
              <Label htmlFor="letter-office">{text.office}</Label>
              <OfficeSelect id="letter-office" className="sm:w-full sm:max-w-none" value={form.officeId} onChange={set('officeId')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="letter-day">
                {text.date}
                {!inbound && <span className="font-normal text-muted-foreground"> (blank if not sent yet)</span>}
              </Label>
              <Input id="letter-day" type="date" value={form[text.dateField]} onChange={set(text.dateField)} required={inbound} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="letter-party">{text.party}</Label>
              <Input id="letter-party" value={form[text.partyField]} onChange={set(text.partyField)} placeholder={text.partyPlaceholder} required autoFocus={!editing} />
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
              <Input id="letter-date" type="date" value={form.letterDate} onChange={set('letterDate')} />
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
