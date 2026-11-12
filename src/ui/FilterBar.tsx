import { useState } from 'react';
import type { ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { useIsDesktop } from './useMediaQuery';

export interface FilterBarProps {
  children: ReactNode;
  activeCount?: number;
  onClear?: () => void;
}

/** Filtros en línea desde tablet y en hoja inferior en teléfono. */
export function FilterBar({ children, activeCount = 0, onClear }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useIsDesktop();
  if (isDesktop) return <div className="flex flex-wrap items-end gap-3">{children}{onClear && activeCount > 0 && <Button variant="ghost" onClick={onClear}>Limpiar filtros</Button>}</div>;
  return <>
    <Button variant="secondary" onClick={() => setOpen(true)} icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}>Filtros{activeCount > 0 ? ` (${activeCount})` : ''}</Button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Filtros" footer={<div className="flex gap-3">{onClear && <Button variant="secondary" onClick={onClear} fullWidth>Limpiar</Button>}<Button onClick={() => setOpen(false)} fullWidth>Ver resultados</Button></div>}><div className="space-y-4">{children}</div></Sheet>
  </>;
}
