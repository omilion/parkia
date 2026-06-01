import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, Filter, History, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { cn } from '../lib/utils';

type AuditEvent = {
  id: number;
  staff_name: string | null;
  staff_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: string | null;
  ip_address: string | null;
  created_at: string;
};

type AuditSummary = {
  total: number;
  byAction: { action: string; count: number }[];
  byEntity: { entity_type: string; count: number }[];
  byUser: { staff_name: string; staff_email: string; count: number }[];
};

const actionLabels: Record<string, string> = {
  'staff.created': 'Usuario creado',
  'staff.status_updated': 'Estado de usuario actualizado',
  'staff.password_reset': 'Clave restablecida',
  'config.updated': 'Configuracion actualizada',
  'totem.maintenance_updated': 'Mantencion de totem actualizada',
  'payment.registered': 'Pago registrado',
  'payment_allocation.reversed': 'Asignacion de pago reversada',
  'bank_movement.allocated': 'Movimiento asignado',
  'bank_movement.reconciled': 'Movimiento conciliado',
  'bank_movement.imported': 'Cartola importada',
  'contract.created': 'Contrato creado',
  'contract.renewed': 'Contrato renovado',
  'space.status_updated': 'Estado de espacio actualizado',
  'space.force_released': 'Espacio liberado',
  'space.barrier_opened': 'Barrera abierta',
  'document.uploaded': 'Documento subido',
  'document.updated': 'Documento actualizado',
  'clients.imported': 'Clientes importados',
  'expense.created': 'Gasto creado',
  'expense.updated': 'Gasto actualizado',
  'expense.status_updated': 'Estado de gasto actualizado',
  'expense.reconciled': 'Gasto conciliado',
  'financial_budget.upserted': 'Presupuesto guardado',
  'financial_budget.deleted': 'Presupuesto eliminado',
  'collection_action.created': 'Gestion de cobranza creada',
  'collection_action.completed': 'Gestion de cobranza completada',
  'operational_task.created': 'Tarea creada',
  'operational_task.updated': 'Tarea actualizada',
  'operational_task.completed': 'Tarea completada',
  'finance_month.closed': 'Mes financiero cerrado',
  'finance_month.reopened': 'Mes financiero reabierto',
  'database.backup_created': 'Respaldo creado',
  'import_template.downloaded': 'Plantilla descargada',
};

const entityOptions = [
  { value: '', label: 'Todas las entidades' },
  { value: 'staff', label: 'Usuarios' },
  { value: 'payment', label: 'Pagos' },
  { value: 'bank_movement', label: 'Cartola' },
  { value: 'expense', label: 'Gastos' },
  { value: 'contract', label: 'Contratos' },
  { value: 'space', label: 'Espacios' },
  { value: 'document', label: 'Documentos' },
  { value: 'operational_task', label: 'Tareas' },
  { value: 'monthly_finance_closure', label: 'Cierres' },
];

const formatMetadata = (metadata: string | null) => {
  if (!metadata) return '-';
  try {
    const parsed = JSON.parse(metadata);
    return Object.entries(parsed)
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join(' | ');
  } catch {
    return metadata;
  }
};

const formatMetadataBlock = (metadata: string | null) => {
  if (!metadata) return '{}';
  try {
    return JSON.stringify(JSON.parse(metadata), null, 2);
  } catch {
    return metadata;
  }
};

const AuditPage = () => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [filters, setFilters] = useState({ q: '', action: '', entity_type: '', from: '', to: '', limit: '100' });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    (Object.entries(filters) as [string, string][]).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  const fetchEvents = async () => {
    setIsLoading(true);
    setError(null);
    const [eventsRes, summaryRes] = await Promise.all([
      fetch(`/api/audit-events?${queryString}`),
      fetch(`/api/audit-events/summary?${queryString}`),
    ]);

    if (eventsRes.ok && summaryRes.ok) {
      setEvents(await eventsRes.json());
      setSummary(await summaryRes.json());
    } else {
      setError('No se pudo cargar la auditoria');
    }
    setIsLoading(false);
  };

  const downloadAuditCsv = async () => {
    try {
      const res = await fetch(`/api/audit-events/export.csv?${queryString}`);
      if (!res.ok) throw new Error('No se pudo exportar auditoria');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'auditoria.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error: any) {
      setError(error.message || 'No se pudo exportar auditoria');
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [queryString]);

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({ q: '', action: '', entity_type: '', from: '', to: '', limit: '100' });
  };

  const hasFilters = Object.entries(filters).some(([key, value]) => key !== 'limit' && Boolean(value));

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <div className="flex flex-col xl:flex-row xl:justify-between xl:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Auditoria</h2>
          <p className="text-slate-500 mt-1">Trazabilidad filtrable de acciones administrativas, financieras y operativas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={downloadAuditCsv}
            aria-label="Exportar auditoría en CSV"
            className="px-5 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-600 hover:text-slate-900 hover:border-slate-300 transition-all flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Exportar CSV
          </button>
          <button
            onClick={fetchEvents}
            disabled={isLoading}
            aria-label="Actualizar auditoría"
            className="px-5 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-600 hover:text-slate-900 hover:border-slate-300 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-2xl text-sm font-bold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Eventos</p>
          <p className="text-2xl font-bold mt-2">{summary?.total ?? events.length}</p>
        </div>
        <div className="glass-card p-5 md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
          <SummaryList title="Acciones" items={(summary?.byAction || []).map(item => ({ label: actionLabels[item.action] || item.action, count: item.count }))} />
          <SummaryList title="Entidades" items={(summary?.byEntity || []).map(item => ({ label: item.entity_type, count: item.count }))} />
          <SummaryList title="Usuarios" items={(summary?.byUser || []).map(item => ({ label: item.staff_name, count: item.count }))} />
        </div>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-bold">Filtros de auditoria</h3>
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs font-bold text-slate-500 hover:text-slate-900 flex items-center gap-1">
              <X className="w-3 h-3" />
              Limpiar
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2 bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3 focus-within:border-slate-400 transition-colors">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              value={filters.q}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Buscar usuario, entidad o detalle"
              className="bg-transparent border-none outline-none text-sm w-full"
            />
          </div>
          <input
            value={filters.action}
            onChange={(event) => updateFilter('action', event.target.value)}
            placeholder="accion exacta"
            className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-slate-400"
          />
          <select
            value={filters.entity_type}
            onChange={(event) => updateFilter('entity_type', event.target.value)}
            className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none"
          >
            {entityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none" />
          <input type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none" />
        </div>
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Fecha</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Usuario</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Accion</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Entidad</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Detalle</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Ver</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-sm font-bold text-slate-400">
                  Cargando auditoria...
                </td>
              </tr>
            )}
            {!isLoading && events.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center">
                  <ShieldCheck className="w-8 h-8 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm font-bold text-slate-400">Sin eventos para los filtros seleccionados</p>
                </td>
              </tr>
            )}
            {!isLoading && events.map(event => (
              <tr key={event.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
                  {new Date(event.created_at).toLocaleString()}
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm font-bold">{event.staff_name || 'Sistema'}</p>
                  <p className="text-xs text-slate-500">{event.staff_email || event.ip_address || '-'}</p>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-slate-300" />
                    <span className="text-sm font-bold">{actionLabels[event.action] || event.action}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono mt-1">{event.action}</p>
                </td>
                <td className="px-6 py-4">
                  <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                    {event.entity_type}{event.entity_id ? ` #${event.entity_id}` : ''}
                  </span>
                </td>
                <td className="px-6 py-4 text-xs text-slate-500 max-w-sm truncate">
                  {formatMetadata(event.metadata)}
                </td>
                <td className="px-6 py-4 text-right">
                  <button onClick={() => setSelectedEvent(event)} aria-label={`Ver detalle del evento ${event.id}`} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all">
                    <Eye className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedEvent && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-end p-4" onClick={() => setSelectedEvent(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="audit-detail-title" className="bg-white rounded-3xl p-6 max-w-xl w-full shadow-2xl space-y-5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Evento #{selectedEvent.id}</p>
                <h3 id="audit-detail-title" className="text-xl font-bold mt-1">{actionLabels[selectedEvent.action] || selectedEvent.action}</h3>
              </div>
              <button onClick={() => setSelectedEvent(null)} aria-label="Cerrar detalle de auditoría" className="p-2 rounded-xl hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Fecha" value={new Date(selectedEvent.created_at).toLocaleString()} />
              <Detail label="Usuario" value={selectedEvent.staff_name || 'Sistema'} />
              <Detail label="Correo/IP" value={selectedEvent.staff_email || selectedEvent.ip_address || '-'} />
              <Detail label="Entidad" value={`${selectedEvent.entity_type}${selectedEvent.entity_id ? ` #${selectedEvent.entity_id}` : ''}`} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Metadata</p>
              <pre className="bg-slate-950 text-slate-100 rounded-2xl p-4 text-xs overflow-auto max-h-80">
                {formatMetadataBlock(selectedEvent.metadata)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SummaryList = ({ title, items }: { title: string; items: { label: string; count: number }[] }) => (
  <div className="space-y-2">
    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{title}</p>
    {items.length === 0 ? (
      <p className="text-xs text-slate-400">Sin datos</p>
    ) : items.slice(0, 3).map(item => (
      <div key={item.label} className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-slate-600 truncate">{item.label}</span>
        <span className="font-bold text-slate-900">{item.count}</span>
      </div>
    ))}
  </div>
);

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-slate-50 rounded-2xl p-3 min-w-0">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
    <p className="text-sm font-bold text-slate-900 mt-1 break-words">{value}</p>
  </div>
);

export default AuditPage;
