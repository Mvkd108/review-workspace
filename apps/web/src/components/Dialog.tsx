import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function Dialog({ onClose, labelledBy, children }: { onClose: () => void; labelledBy: string; children: ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  // Capture the trigger during the render phase, before React's autoFocus on a
  // descendant input moves focus during commit. Reading activeElement here is
  // stable for this component and is what lets Escape return focus correctly.
  const previousFocus = useRef<HTMLElement | null>(null);
  if (previousFocus.current === null) {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  // Move focus into the dialog so keyboard flow starts inside it. Prefer an
  // explicit autofocus target, then the first control that is not the close
  // button, so a form lands on its primary field rather than the corner X.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const close = dialog?.querySelector<HTMLElement>('.dialog-close');
    const autofocus = dialog?.querySelector<HTMLElement>('[autofocus]');
    const defaultTarget = focusableElements(dialog).find((element) => element !== close);
    (autofocus ?? defaultTarget)?.focus();
    // Return focus to whatever opened the dialog when it closes.
    return () => previousFocus.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = focusableElements(dialogRef.current);
    if (focusables.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} onKeyDown={handleKeyDown}>
        <IconButton className="dialog-close" onClick={onClose} aria-label="Close"><Icon name="close" /></IconButton>
        {children}
      </section>
    </div>
  );
}
