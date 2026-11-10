import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '@/api.js';
import { isManager, useAuth } from '@/auth.jsx';
import BoxSelect from '@/components/BoxSelect.jsx';
import { letterCode } from '@/letters.jsx';
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
  ResponsiveDialogTrigger,
} from '@/components/ResponsiveDialog.jsx';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMPTY = { fileNumber: '', name: '', boxId: '', letterCounter: '' };

// A "Register File" button that opens the register form in a dialog (a drawer on phones). Calls onSaved(file) after each save.
// The dialog stays open after saving, with the box still selected, so a stack of files can be keyed in quickly.
export default function RegisterFile({ onSaved }) {
  const { user } = useAuth();
  const { officeId, officeName } = useOffices();
  const [open, setOpen] = useState(false);
  const [boxes, setBoxes] = useState(null);
  const [areas, setAreas] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [message, setMessage] = useState(null);
  const numberRef = useRef(null);

  // Load the boxes each time the dialog opens, so newly added boxes show up. Only the chosen office's boxes are
  // offered (or every office's, grouped, when "All offices" is chosen).
  useEffect(() => {
    if (!open) return;
    const office = `?officeId=${encodeURIComponent(officeId)}`;
    Promise.all([api.get(`/boxes${office}`), api.get(`/areas${office}`)])
      .then(([b, a]) => {
        setBoxes(b);
        setAreas(a);
        setForm((f) => (b.some((x) => x.id === f.boxId) ? f : { ...f, boxId: '' }));
      })
      .catch((e) => setMessage({ ok: false, text: e.message }));
  }, [open, officeId]);

  function changeOpen(next) {
    setOpen(next);
    if (!next) {
      setMessage(null);
      setForm((f) => ({ ...EMPTY, boxId: f.boxId }));
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.boxId) return setMessage({ ok: false, text: 'Choose a file box.' });
    try {
      const file = await api.post('/files', form);
      setMessage({ ok: true, text: `File ${file.fileNumber} saved in ${file.boxName} (${file.officeName}).` });
      setForm((f) => ({ ...f, fileNumber: '', name: '', letterCounter: '' }));
      numberRef.current?.focus();
      onSaved?.(file);
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    }
  }

  const noBoxes = boxes && boxes.length === 0;

  return (
    <ResponsiveDialog open={open} onOpenChange={changeOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button><Plus /> Register File</Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Register a File</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {officeId ? `Boxes in ${officeName(officeId)}` : 'Boxes in all offices'} · recorded as {user.name}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          {!boxes && !message && <p className="text-sm text-muted-foreground">Loading…</p>}

          {noBoxes && (
            <p className="text-sm">
              {officeId ? `${officeName(officeId)} has no file boxes yet. ` : 'There are no file boxes yet. '}
              An admin needs to add at least one file box first.{' '}
              {isManager(user) && <Link to="/settings/boxes" className="underline underline-offset-4">Go to Settings</Link>}
            </p>
          )}

          {boxes?.length > 0 && (
            <form id="register-file" onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="reg-number">File number</Label>
                <Input id="reg-number" ref={numberRef} value={form.fileNumber} onChange={set('fileNumber')} required autoFocus />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reg-name">File name</Label>
                <Input id="reg-name" value={form.name} onChange={set('name')} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reg-counter">Letter running no. <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input
                  id="reg-counter"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={form.letterCounter}
                  onChange={set('letterCounter')}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  The last letter number already used in this file. The next letter will be{' '}
                  <span className="font-medium text-foreground">{letterCode(form.fileNumber || 'File no.', (Number(form.letterCounter) || 0) + 1)}</span>.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reg-box">File box</Label>
                <BoxSelect
                  id="reg-box"
                  boxes={boxes}
                  areas={areas}
                  value={form.boxId}
                  onChange={(boxId) => setForm((f) => ({ ...f, boxId }))}
                  invalid={message && !message.ok && !form.boxId}
                />
              </div>
            </form>
          )}

          {message && <p className={message.ok ? 'text-sm text-success' : 'text-sm text-destructive'}>{message.text}</p>}
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <ResponsiveDialogClose asChild>
            <Button type="button" variant="outline">{message?.ok ? 'Done' : 'Cancel'}</Button>
          </ResponsiveDialogClose>
          {boxes?.length > 0 && <Button type="submit" form="register-file">Save File</Button>}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
