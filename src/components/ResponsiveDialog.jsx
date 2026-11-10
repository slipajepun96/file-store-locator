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

function useIsDesktop() {
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

// A dialog on desktop and a bottom drawer on phones, with one set of parts:
// ResponsiveDialog > ResponsiveDialogContent > Header (Title, Description), Body, Footer.
// Put the form fields in Body: in the drawer it scrolls between the fixed header and footer.
export function ResponsiveDialog({ children, ...props }) {
  const isDesktop = useIsDesktop();
  const Root = isDesktop ? Dialog : Drawer;
  return (
    <DesktopContext.Provider value={isDesktop}>
      <Root {...props}>{children}</Root>
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
export const ResponsiveDialogHeader = pick(DialogHeader, DrawerHeader);

// className sets the dialog's width (e.g. sm:max-w-2xl); the drawer is always full width.
export function ResponsiveDialogContent({ className, children, ...props }) {
  return useContext(DesktopContext) ? (
    <DialogContent className={className} {...props}>{children}</DialogContent>
  ) : (
    <DrawerContent {...props}>{children}</DrawerContent>
  );
}

export function ResponsiveDialogBody({ className, ...props }) {
  const isDesktop = useContext(DesktopContext);
  return <div className={cn(isDesktop ? 'grid gap-4' : 'grid min-h-0 gap-4 overflow-y-auto px-4 pb-2', className)} {...props} />;
}

// On phones the buttons stack full width, with the main action (the last button) on top.
export function ResponsiveDialogFooter({ className, ...props }) {
  return useContext(DesktopContext) ? (
    <DialogFooter className={className} {...props} />
  ) : (
    <DrawerFooter className={cn('flex-col-reverse border-t', className)} {...props} />
  );
}
