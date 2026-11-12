import type { ReactNode } from 'react';
import { Sheet } from '../../ui/Sheet';

/** Adaptador para los formularios existentes; permite migrarlos gradualmente. */
export default function Drawer({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return <Sheet open={isOpen} onClose={onClose} title={title}>{children}</Sheet>;
}
