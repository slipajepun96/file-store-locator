import { RefreshCw, WifiOff } from 'lucide-react';
import { applyUpdate, useOnline, useUpdateReady } from '@/pwa.js';
import { Button } from '@/components/ui/button';

// Fixed notices at the bottom of the screen: no connection, and a new version of the app ready to load.
export default function AppStatus() {
  const online = useOnline();
  const updateReady = useUpdateReady();
  if (online && !updateReady) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none"
    >
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border bg-popover px-4 py-2.5 text-sm text-popover-foreground shadow-lg">
        {!online ? (
          <>
            <WifiOff className="size-4 shrink-0 text-muted-foreground" />
            <span>You're offline. Files and letters will load again when you reconnect.</span>
          </>
        ) : (
          <>
            <RefreshCw className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">A new version of the app is ready.</span>
            <Button size="sm" onClick={applyUpdate}>Reload</Button>
          </>
        )}
      </div>
    </div>
  );
}
