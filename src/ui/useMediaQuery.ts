import { useSyncExternalStore } from 'react';

/** Puntos de quiebre del shell. Deben coincidir con los de Tailwind (md = 768, xl = 1280). */
export const BREAKPOINTS = {
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
} as const;

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** true en tablet y escritorio (>= 768 px): tabla, panel lateral, filtros en linea. */
export const useIsDesktop = () => useMediaQuery(BREAKPOINTS.md);
