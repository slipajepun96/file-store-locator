import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { api, setUnauthorizedHandler } from '@/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.get('/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  // Re-reads the signed-in user, e.g. to update the admin's pending-approval count.
  const refresh = () => api.get('/auth/me').then(setUser).catch(() => {});
  const login = async (username, password) => setUser(await api.post('/auth/login', { username, password }));
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

// Signed-out visitors get the sign-in form (fallback) on the page they opened, and that page once they're in.
export function RequireAuth({ fallback }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="mt-[40vh] text-center text-muted-foreground">Loading…</p>;
  if (!user) return fallback;
  return <Outlet />;
}

// Admins manage every office; an office admin manages only their own office.
export const isManager = (u) => u?.role === 'admin' || (u?.role === 'office_admin' && Boolean(u.officeId));
export const canManageOffice = (u, officeId) =>
  u?.role === 'admin' || (u?.role === 'office_admin' && Boolean(officeId) && u.officeId === officeId);

export const ROLE_NAMES = { admin: 'Admin', office_admin: 'Office admin', worker: 'Worker' };

// The Settings page: admins and office admins.
export function RequireManager() {
  const { user } = useAuth();
  if (!isManager(user)) return <Navigate to="/" replace />;
  return <Outlet />;
}
