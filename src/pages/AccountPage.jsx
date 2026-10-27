import { useState } from 'react';
import { api } from '@/api.js';
import { useAuth } from '@/auth.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AccountPage() {
  const { user } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [message, setMessage] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setMessage({ ok: false, text: 'New passwords do not match.' });
    try {
      await api.put('/auth/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setMessage({ ok: true, text: 'Password changed. Other devices have been signed out.' });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    }
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="text-2xl">My Account</CardTitle>
        <CardDescription>{user.name} · {user.email || `@${user.username}`} · {user.role}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!user.hasPassword && <p className="text-sm">You sign in with Google ({user.email}). There is no password to manage here.</p>}
        {user.hasPassword && (
          <>
            <h2 className="font-semibold">Change password</h2>
            <form onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="current">Current password</Label>
                <Input id="current" type="password" value={form.currentPassword} onChange={set('currentPassword')} autoComplete="current-password" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new">New password (min. 8 characters)</Label>
                <Input id="new" type="password" value={form.newPassword} onChange={set('newPassword')} autoComplete="new-password" minLength={8} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input id="confirm" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
              </div>
              <Button type="submit" className="justify-self-start">Change Password</Button>
            </form>
            {message && <p className={message.ok ? 'text-sm text-success' : 'text-sm text-destructive'}>{message.text}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
