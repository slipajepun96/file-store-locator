import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { api, setUnauthorizedHandler } from '@/api.js';
import { startLive, stopLive, useLive } from '@/live.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True when the server couldn't be reached to check the sign-in (e.g. the installed app opened offline). That's not
  // the same as being signed out, so the app says it's offline instead of showing the sign-in form.
  const [unreachable, setUnreachable] = useState(false);
  const unreachableRef = useRef(false);
  unreachableRef.current = unreachable;

  const check = () =>
    api
      .get('/auth/me')
      .then((u) => {
        setUser(u);
        setUnreachable(false);
      })
      .catch((err) => {
        setUnreachable(Boolean(err.offline));
        if (!err.offline) setUser(null);
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    check();
    // Check again once the connection comes back.
    const online = () => unreachableRef.current && check();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);

  // Re-reads the signed-in user, e.g. to update the admin's pending-approval count.
  const refresh = () => api.get('/auth/me').then(setUser).catch(() => {});
  const login = async (username, password) => setUser(await api.post('/auth/login', { username, password }));

  // Live updates while signed in. Account changes (role, office, department, the sign-up count, being blocked)
  // re-read the signed-in user; a blocked or removed account is then signed out.
  useEffect(() => {
    if (!user) return stopLive();
    startLive();
  }, [Boolean(user)]);
  useLive(['account', 'department', 'office'], () => user && refresh());
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, unreachable, retry: check, login, logout, refresh }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

// Signed-out visitors get the sign-in form (fallback) on the page they opened, and that page once they're in.
export function RequireAuth({ fallback }) {
  const { user, loading, unreachable, retry } = useAuth();
  if (loading) return <p className="mt-[40vh] text-center text-muted-foreground">Loading…</p>;
  if (!user && unreachable)
    return (
      <div className="mx-auto mt-[30vh] grid max-w-sm gap-3 px-4 text-center">
        <p className="font-semibold">{navigator.onLine ? "Can't reach the server" : "You're offline"}</p>
        <p className="text-sm text-muted-foreground">File Store Locator needs a connection to show files and letters. It will carry on once you're back online.</p>
        <button type="button" onClick={retry} className="justify-self-center text-sm font-medium underline underline-offset-4">Try again</button>
      </div>
    );
  if (!user) return fallback;
  return <Outlet />;
}

// Admins manage every office; an office admin manages only their own office.
export const isManager = (u) => u?.role === 'admin' || (u?.role === 'office_admin' && Boolean(u.officeId));
export const canManageOffice = (u, officeId) =>
  u?.role === 'admin' || (u?.role === 'office_admin' && Boolean(officeId) && u.officeId === officeId);

// A worker sends and receives letters only for their own department; admins, and office admins for their own
// office's letters, for any. The server checks the same (canActForDepartment in server/auth.js).
export const canActForDepartment = (u, officeId, departmentId) =>
  canManageOffice(u, officeId) || (Boolean(departmentId) && u?.departmentId === departmentId);

export const ROLE_NAMES = { admin: 'Admin', office_admin: 'Office admin', worker: 'Worker' };

// The Settings page: admins and office admins.
export function RequireManager() {
  const { user } = useAuth();
  if (!isManager(user)) return <Navigate to="/" replace />;
  return <Outlet />;
}
