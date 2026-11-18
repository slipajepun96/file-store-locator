import { createContext, useContext, useSyncExternalStore } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

// Same breakpoint as Tailwind's md: phones get a drawer, tablets and desktops a dialog.
const DESKTOP_QUERY = '(min-width: 768px)';

// Also for forms that behave differently on phones, e.g. not focusing a field (which opens the keyboard).
export function useIsDesktop() {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(DESKTOP_QUERY);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches
  );
}

const DesktopContext = createContext(true);

// The drawer library moves and resizes the drawer itself when the keyboard opens (repositionInputs). It tells the
// keyboard opening from closing by jumps of 60px or more in the visible height, but Android animates the keyboard in
// many small steps, so it can lose track and leave the drawer short after the keyboard closes. On Android the page
// resizes with the keyboard instead (interactive-widget=resizes-content in index.html), and the drawer, capped at the
// screen height, follows it; so the library's own handling is turned off there. iOS keeps it, since it needs it.
const IS_ANDROID = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

// A dialog on desktop and a bottom drawer on phones, with one set of parts:
// ResponsiveDialog > ResponsiveDialogContent > Header (Title, Description), Body, Footer.
// Put the form fields in Body: in the drawer it scrolls between the fixed header and footer.
export function ResponsiveDialog({ children, ...props }) {
  const isDesktop = useIsDesktop();
  return (
    <DesktopContext.Provider value={isDesktop}>
      {isDesktop ? (
        <Dialog {...props}>{children}</Dialog>
      ) : (
        <Drawer repositionInputs={!IS_ANDROID} {...props}>{children}</Drawer>
      )}
    </DesktopContext.Provider>
  );
}

const pick = (desktop, mobile) =>
  function Part(props) {
    const Comp = useContext(DesktopContext) ? desktop : mobile;
    return <Comp {...props} />;
  };

export const ResponsiveDialogTrigger = pick(DialogTrigger, DrawerTrigger);
export const ResponsiveDialogClose = pick(DialogClose, DrawerClose);
export const ResponsiveDialogTitle = pick(DialogTitle, DrawerTitle);
export const ResponsiveDialogDescription = pick(DialogDescription, DrawerDescription);

// className sets the dialog's width (e.g. sm:max-w-2xl); the drawer is always full width.
// On phones the drawer can use almost the whole screen. It opens without focusing a field (vaul's default), since
// that would bring up the keyboard and hide half the form; so don't give fields autoFocus there (see useIsDesktop).
export function ResponsiveDialogContent({ className, children, ...props }) {
  return useContext(DesktopContext) ? (
    <DialogContent className={className} {...props}>{children}</DialogContent>
  ) : (
    <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-0.75rem)]" {...props}>
      {children}
    </DrawerContent>
  );
}

export function ResponsiveDialogHeader({ className, ...props }) {
  return useContext(DesktopContext) ? (
    <DialogHeader className={className} {...props} />
  ) : (
    <DrawerHeader className={cn('px-4 pt-2 pb-3', className)} {...props} />
  );
}

export function ResponsiveDialogBody({ className, ...props }) {
  const isDesktop = useContext(DesktopContext);
  return <div className={cn(isDesktop ? 'grid gap-4' : 'grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 pb-3', className)} {...props} />;
}

// On phones the buttons share one row, splitting the width, with the main action (the last button) on the right.
export function ResponsiveDialogFooter({ className, ...props }) {
  return useContext(DesktopContext) ? (
    <DialogFooter className={className} {...props} />
  ) : (
    <DrawerFooter className={cn('flex-row border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] *:flex-1', className)} {...props} />
  );
}
