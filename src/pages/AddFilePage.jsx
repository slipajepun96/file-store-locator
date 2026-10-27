import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api.js';
import { useAuth } from '@/auth.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

export default function AddFilePage() {
  const { user } = useAuth();
  const [boxes, setBoxes] = useState(null);
  const [areas, setAreas] = useState([]);
  const [form, setForm] = useState({ fileNumber: '', name: '', boxId: '' });
  const [message, setMessage] = useState(null);
  const numberRef = useRef(null);

  useEffect(() => {
    Promise.all([api.get('/boxes'), api.get('/areas')]).then(([b, a]) => {
      setBoxes(b);
      setAreas(a);
    });
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const areaName = (id) => areas.find((a) => a.id === id)?.name ?? '';

  async function submit(e) {
    e.preventDefault();
    try {
      await api.post('/files', form);
      const box = boxes.find((b) => b.id === form.boxId);
      setMessage({ ok: true, text: `File ${form.fileNumber} saved in ${box?.name}.` });
      // Keep the box selected so a stack of files can be keyed in quickly.
      setForm((f) => ({ ...f, fileNumber: '', name: '' }));
      numberRef.current?.focus();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    }
  }

  if (!boxes) return <Card><CardContent className="text-muted-foreground">Loading…</CardContent></Card>;

  if (boxes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Register File</CardTitle>
          <CardDescription>
            An admin needs to add at least one file box first.{' '}
            {user.role === 'admin' && <Link to="/admin" className="text-foreground underline underline-offset-4">Go to Admin</Link>}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="text-2xl">Register File</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="fileNumber">File number</Label>
            <Input id="fileNumber" ref={numberRef} value={form.fileNumber} onChange={set('fileNumber')} required autoFocus />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name">File name</Label>
            <Input id="name" value={form.name} onChange={set('name')} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="boxId">File box</Label>
            <NativeSelect id="boxId" wrapperClassName="w-full" value={form.boxId} onChange={set('boxId')} required>
              <NativeSelectOption value="">— Select file box —</NativeSelectOption>
              {boxes.map((b) => <NativeSelectOption key={b.id} value={b.id}>{b.name} ({areaName(b.areaId)})</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <Button type="submit" className="justify-self-start">Save File</Button>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">Recorded as {user.name}.</p>
        {message && <p className={message.ok ? 'text-sm text-success' : 'text-sm text-destructive'}>{message.text}</p>}
      </CardFooter>
    </Card>
  );
}
