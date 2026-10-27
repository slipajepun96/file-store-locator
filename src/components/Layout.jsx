import { NavLink, Outlet } from 'react-router-dom';
import { LogOut, Package } from 'lucide-react';
import { useAuth } from '@/auth.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navClass = ({ isActive }) =>
  cn(
    'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
    isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'
  );

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Package className="size-5" /> File Store Locator
          </div>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/" end className={navClass}>Find File</NavLink>
            <NavLink to="/files/new" className={navClass}>Register File</NavLink>
            {user.role === 'admin' && (
              <NavLink to="/admin" className={navClass}>
                Admin
                {user.pendingCount > 0 && (
                  <Badge className="bg-warning px-1.5 text-black" title="Waiting for approval">{user.pendingCount}</Badge>
                )}
              </NavLink>
            )}
          </nav>
          <div className="flex items-center gap-1">
            <NavLink to="/account" className={navClass}>{user.name}</NavLink>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut /> Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
