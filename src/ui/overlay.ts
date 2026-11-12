import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Comportamiento compartido por Sheet y Dialog:
 * - pila de capas: Escape y el foco solo afectan a la capa superior
 * - bloqueo de scroll del body (con contador, admite capas anidadas)
 * - focus trap con Tab / Shift+Tab y devolucion del foco al cerrar
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const stack: symbol[] = [];
let lockCount = 0;
let previousOverflow = '';
let previousPaddingRight = '';

function lockScroll() {
  if (lockCount === 0) {
    const { body, documentElement } = document;
    previousOverflow = body.style.overflow;
    previousPaddingRight = body.style.paddingRight;
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
  }
  lockCount += 1;
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousOverflow;
    document.body.style.paddingRight = previousPaddingRight;
  }
}

function getFocusable(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    el => el.getClientRects().length > 0 && !el.hasAttribute('inert'),
  );
}

type OverlayOptions = {
  open: boolean;
  onClose: () => void;
  /** Si es false, Escape no cierra (por ejemplo mientras se guarda). */
  dismissible?: boolean;
  panelRef: RefObject<HTMLElement | null>;
  /** Elemento que recibe el foco al abrir. Por defecto, el panel completo. */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

export function useOverlay({ open, onClose, dismissible = true, panelRef, initialFocusRef }: OverlayOptions) {
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  onCloseRef.current = onClose;
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;

    const id = Symbol('overlay');
    const restoreTo = document.activeElement as HTMLElement | null;
    stack.push(id);
    lockScroll();

    // El panel se monta en el mismo commit; se espera un frame para que exista el nodo.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      (initialFocusRef?.current ?? panel).focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      const panel = panelRef.current;

      if (event.key === 'Escape') {
        if (!dismissibleRef.current) return;
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !panel) return;
      const focusable = getFocusable(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !panel.contains(active);
      if (event.shiftKey && (outside || active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      const index = stack.indexOf(id);
      if (index >= 0) stack.splice(index, 1);
      unlockScroll();
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus({ preventScroll: true });
    };
  }, [open, panelRef, initialFocusRef]);
}
