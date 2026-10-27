import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Package } from 'lucide-react';
import { api } from '@/api.js';
import { useAuth } from '@/auth.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Messages for the ?status= the server adds when it sends someone back from Google.
const STATUS = {
  pending: { ok: true, text: 'Thanks! Your access request has been sent. An admin needs to approve your account before you can sign in.' },
  rejected: { ok: false, text: 'Your access request was not approved. Contact an admin if you think this is a mistake.' },
  unverified: { ok: false, text: 'Your Google email address is not verified.' },
  cancelled: { ok: false, text: 'Google sign-in was cancelled.' },
  'google-off': { ok: false, text: 'Google sign-in is not set up on this server yet.' },
  error: { ok: false, text: 'Google sign-in failed. Please try again.' },
};

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const status = STATUS[params.get('status')];

  useEffect(() => {
    api.get('/auth/config').then(setConfig).catch(() => setConfig({ google: false, password: true }));
  }, []);

  if (loading || !config) return null;
  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(form.username, form.password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const passwordForm = (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor="username">Username</Label>
        <Input id="username" value={form.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" required autoFocus={!config.google} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" value={form.password} onChange={set('password')} autoComplete="current-password" required />
      </div>
      <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl"><Package className="size-5" /> File Store Locator</CardTitle>
          <CardDescription>
            {config.google ? "Sign in with your Google account. New users need an admin's approval first." : 'Sign in to continue.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {status && (
            <Alert variant={status.ok ? 'default' : 'destructive'}>
              <AlertDescription className={status.ok ? 'text-foreground' : undefined}>{status.text}</AlertDescription>
            </Alert>
          )}

          {config.google ? (
            <>
              <Button variant="outline" size="lg" asChild>
                <a href="/api/auth/google">
                  <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
                    <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z" />
                    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
                  </svg>
                  Sign in with Google
                </a>
              </Button>
              {config.password && (
                <details className="group">
                  <summary className="mb-3 cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    Sign in with username &amp; password
                  </summary>
                  {passwordForm}
                </details>
              )}
            </>
          ) : (
            passwordForm
          )}
          <p className="border-t pt-4 text-center text-sm text-muted-foreground">
            Just looking for a file?{' '}
            <Link to="/find" className="text-foreground underline underline-offset-4">Search without signing in</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
