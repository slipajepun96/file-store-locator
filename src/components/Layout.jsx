import { NavLink, Outlet } from 'react-router-dom';
import { Building2, LogOut, Package, UserRound } from 'lucide-react';
import { isManager, useAuth } from '@/auth.jsx';
import { useOffices } from '@/office.jsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import OfficeSelect from '@/components/OfficeSelect.jsx';
import { cn } from '@/lib/utils';

// Links in the deep green header: the current page is lime, the rest a soft white that brightens on hover.
const navClass = ({ isActive }) =>
  cn(
    'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    isActive
      ? 'bg-lime text-lime-foreground'
      : 'text-header-foreground/75 hover:bg-white/10 hover:text-header-foreground'
  );

// Phones: brand and account on the first row; office picker and the menu on a second, full-width row.
// Wider screens: everything on one row.
export default function Layout() {
  const { user, logout } = useAuth();
  const { offices, officeId, setOfficeId } = useOffices();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-header text-header-foreground shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Package className="size-5 shrink-0 text-lime" />
            <span className="sm:hidden">Files</span>
            <span className="hidden sm:inline">File Store Locator</span>
          </div>

          <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto sm:flex-1">
            {offices.length > 0 && (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-header-foreground/75 sm:flex-none">
                <Building2 className="size-4 shrink-0" aria-hidden="true" />
                <OfficeSelect
                  size="sm"
                  className="border-transparent bg-background text-foreground dark:bg-background"
                  value={officeId}
                  onChange={setOfficeId}
                  emptyLabel="All offices"
                />
              </div>
            )}
            <nav className="flex shrink-0 gap-1">
              <NavLink to="/" end className={navClass}>Files</NavLink>
              <NavLink to="/letters" className={navClass}>Letters</NavLink>
              {isManager(user) && (
                <NavLink to="/settings" className={navClass}>
                  Settings
                  {user.pendingCount > 0 && (
                    <Badge className="bg-warning px-1.5 text-black" title="Waiting for approval">{user.pendingCount}</Badge>
                  )}
                </NavLink>
              )}
            </nav>
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-1">
            <NavLink to="/account" className={(s) => cn(navClass(s), 'min-w-0')} title="My account">
              <UserRound className="size-4 shrink-0 sm:hidden" />
              <span className="max-w-32 truncate sm:max-w-48">{user.name}</span>
            </NavLink>
            <Button
              variant="ghost"
              size="sm"
              className="text-header-foreground/75 hover:bg-white/10 hover:text-header-foreground"
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut /> <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6">
        <Outlet />
      </main>
    </div>
  );
}
