import type { OperationalTask, StaffUser } from '../../types';

/** Etiquetas, permisos y utilidades compartidas por la página y los componentes de Tareas. */

export type Assignee = Pick<StaffUser, 'id' | 'name' | 'email' | 'role'>;

export type TaskHistoryEvent = {
  id: number;
  action: string;
  metadata: string | null;
  created_at: string;
  staff_name: string | null;
  staff_email: string | null;
};

export const categoryLabels: Record<OperationalTask['category'], string> = {
  finance: 'Finanzas',
  access: 'Seguridad',
  documents: 'Documentos',
  contracts: 'Contratos',
  maintenance: 'Mantención',
  general: 'General',
};

export const taskCategoriesByRole: Record<StaffUser['role'], OperationalTask['category'][]> = {
  admin: ['finance', 'access', 'documents', 'contracts', 'maintenance', 'general'],
  finance: ['finance', 'documents', 'contracts', 'general'],
  guard: ['access', 'maintenance', 'general'],
  cashier: ['access', 'general'],
};

export const canAssigneeHandleCategory = (assignee: Assignee, category: OperationalTask['category']) =>
  taskCategoriesByRole[assignee.role].includes(category);

export const priorityLabels: Record<OperationalTask['priority'], string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
};

export const statusLabels: Record<OperationalTask['status'], string> = {
  open: 'Abierta',
  in_progress: 'En curso',
  done: 'Cerrada',
  cancelled: 'Anulada',
};

export const sourceTone = (sourceType: string | null) => {
  if (sourceType === 'dashboard_alert') return 'bg-violet-50 text-violet-700';
  if (sourceType === 'guard_shift_log') return 'bg-sky-50 text-sky-700';
  if (sourceType === 'document') return 'bg-cyan-50 text-cyan-700';
  if (sourceType?.startsWith('finance_') || sourceType?.startsWith('monthly_finance_')) return 'bg-emerald-50 text-emerald-700';
  return 'bg-slate-100 text-slate-600';
};

export const fileToPayload = (file: File) => new Promise<{ fileName: string, mimeType: string, dataBase64: string }>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    const [, dataBase64] = result.split(',');
    resolve({ fileName: file.name, mimeType: file.type, dataBase64 });
  };
  reader.onerror = () => reject(new Error('No se pudo leer el adjunto'));
  reader.readAsDataURL(file);
});

export const formatHistoryMetadata = (metadata: string | null) => {
  if (!metadata) return '-';
  try {
    const parsed = JSON.parse(metadata);
    if (parsed.next) {
      return `Estado: ${parsed.previous?.status || '-'} -> ${parsed.next.status || '-'} · Prioridad: ${parsed.previous?.priority || '-'} -> ${parsed.next.priority || '-'}`;
    }
    if (parsed.note !== undefined) return `Nota: ${parsed.note || '-'}`;
    return Object.entries(parsed).map(([key, value]) => `${key}: ${value}`).join(' · ');
  } catch {
    return metadata;
  }
};
