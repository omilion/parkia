import React from 'react';

import { Car, CheckCircle2, DoorOpen } from 'lucide-react';
import { AccessLog, GuardShiftLog, GuardShiftLogEntry } from '../../../types';

const ACCESS_AUDIT_PAGE_SIZE = 50;

const shiftNameLabels: Record<GuardShiftLog['shift_name'], string> = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  night: 'Noche',
  custom: 'Especial',
};

const shiftEntryCategoryLabels: Record<GuardShiftLogEntry['category'], string> = {
  access: 'Acceso',
  visitor: 'Visita',
  incident: 'Incidente',
  maintenance: 'Mantención',
  payment: 'Pago',
  handover: 'Traspaso',
  other: 'Otro',
};

const shiftPriorityLabels: Record<GuardShiftLogEntry['priority'], string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
};

const statusLabelsForShiftTask: Record<NonNullable<GuardShiftLogEntry['task_status']>, string> = {
  open: 'Abierta',
  in_progress: 'En curso',
  done: 'Cerrada',
  cancelled: 'Anulada',
};

const accessTabIds = ['live', 'visitors', 'shift-log', 'audit', 'rates'] as const;

type AccessTabId = typeof accessTabIds[number];

function getInitialAccessTab() {
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  return accessTabIds.includes(requestedTab as AccessTabId) ? requestedTab as AccessTabId : 'live';
}

function getAccessPoint(log: Pick<AccessLog, 'plate' | 'space_name'>) {
  const name = (log.space_name || '').toLowerCase();
  const isPedestrian = !log.plate && (name.includes('puerta') || name.includes('peaton') || name.includes('principal'));
  return {
    label: isPedestrian ? 'Puerta peatonal' : 'Barrera vehicular',
    Icon: isPedestrian ? DoorOpen : Car,
    className: isPedestrian ? 'bg-sky-50 text-sky-700' : 'bg-indigo-50 text-indigo-700',
  };
}

function formatCurrency(value: number | null | undefined) {
  return `$${Number(value || 0).toLocaleString('es-CL')}`;
}

function ShiftFollowUpCard({
  entry,
  onResolve,
  isActionLoading,
}: {
  entry: GuardShiftLogEntry;
  key?: React.Key;
  onResolve: (entry: GuardShiftLogEntry) => void | Promise<void>;
  isActionLoading: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold uppercase tracking-wider">
          Pendiente
        </span>
        <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold uppercase tracking-wider">
          {shiftEntryCategoryLabels[entry.category]}
        </span>
        {entry.task_id && (
          <span className="px-2 py-1 bg-sky-50 text-sky-700 rounded-lg text-xs font-bold uppercase tracking-wider">
            Tarea #{entry.task_id}
          </span>
        )}
      </div>
      <div>
        <p className="text-sm font-bold text-slate-900">{entry.title}</p>
        {entry.detail && <p className="text-xs text-slate-600 mt-1">{entry.detail}</p>}
        <p className="text-xs text-slate-600 mt-2">
          {entry.shift_date || '-'} · {entry.shift_name ? shiftNameLabels[entry.shift_name] : 'Turno'} · {entry.shift_staff_name || entry.staff_name}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onResolve(entry)}
        disabled={isActionLoading}
        className="w-full py-2 bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <CheckCircle2 className="w-4 h-4" />
        Resolver seguimiento
      </button>
    </div>
  );
}
export { ACCESS_AUDIT_PAGE_SIZE, shiftNameLabels, shiftEntryCategoryLabels, shiftPriorityLabels, statusLabelsForShiftTask, accessTabIds, getInitialAccessTab, getAccessPoint, formatCurrency, ShiftFollowUpCard };
export type { AccessTabId };
