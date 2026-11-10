import { useEffect, useState } from 'react';
import { api } from '@/api.js';
import BoxSelect from '@/components/BoxSelect.jsx';
import { letterCode } from '@/letters.jsx';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ResponsiveDialog.jsx';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Edit a file's number, name or box. `file` opens the dialog; onClose() closes it, onSaved(file) gets the saved file.
// Every office's boxes are offered, since a file can be moved to another office.
export default function EditFileDialog({ file, onClose, onSaved }) {
  const [boxes, setBoxes] = useState(null);
  const [areas, setAreas] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) return;
    setForm({ fileNumber: file.fileNumber, name: file.name, boxId: file.boxId, letterCounter: String(file.letterCounter ?? 0) });
    setError('');
    Promise.all([api.get('/boxes'), api.get('/areas')])
      .then(([b, a]) => {
        setBoxes(b);
        setAreas(a);
      })
      .catch((e) => setError(e.message));
  }, [file]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    try {
      onSaved(await api.put(`/files/${file.id}`, form));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <ResponsiveDialog open={Boolean(file)} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Edit File {file?.fileNumber}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          {form && (
            <form id="edit-file" onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-number">File number</Label>
                <Input id="edit-number" value={form.fileNumber} onChange={set('fileNumber')} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-name">File name</Label>
                <Input id="edit-name" value={form.name} onChange={set('name')} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-counter">Letter running no.</Label>
                <Input
                  id="edit-counter"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={form.letterCounter}
                  onChange={set('letterCounter')}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  The last letter number used in this file. The next letter will be{' '}
                  <span className="font-medium text-foreground">{letterCode(form.fileNumber || 'File no.', (Number(form.letterCounter) || 0) + 1)}</span>.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-box">File box</Label>
                {boxes ? (
                  <BoxSelect id="edit-box" boxes={boxes} areas={areas} value={form.boxId} onChange={(boxId) => setForm((f) => ({ ...f, boxId }))} />
                ) : (
                  <p className="text-sm text-muted-foreground">Loading boxes…</p>
                )}
              </div>
            </form>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </ResponsiveDialogClose>
          <Button type="submit" form="edit-file" disabled={!boxes}>Save</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
