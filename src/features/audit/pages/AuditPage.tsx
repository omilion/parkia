import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetchJson } from '../../../lib/api';
import { useMemo, useState } from 'react';
import { Download, Eye, Filter, RefreshCw } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { DataView, FilterBar, Sheet, Input, Select } from '../../../ui';

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
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [filters, setFilters] = useState({ q: '', action: '', entity_type: '', from: '', to: '', limit: '100' });
  const [exportError, setError] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    (Object.entries(filters) as [string, string][]).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  const queryClient = useQueryClient();
  const auditQuery = useQuery({ queryKey: ['audit', queryString], queryFn: async ({ signal }) => {
    const [events, summary] = await Promise.all([apiFetchJson<AuditEvent[]>(`/api/audit-events?${queryString}`, { signal }), apiFetchJson<AuditSummary>(`/api/audit-events/summary?${queryString}`, { signal })]);
    return { events, summary };
  } });
  const events = auditQuery.data?.events ?? [];
  const summary = auditQuery.data?.summary ?? null;
  const isLoading = auditQuery.isPending;
  const error = exportError || auditQuery.error?.message;
  const fetchEvents = () => queryClient.invalidateQueries({ queryKey: ['audit'] });

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

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({ q: '', action: '', entity_type: '', from: '', to: '', limit: '100' });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <div className="flex flex-col xl:flex-row xl:justify-between xl:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Auditoria</h2>
          <p className="text-slate-600 mt-1">Trazabilidad filtrable de acciones administrativas, financieras y operativas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={downloadAuditCsv}
            className="px-5 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-600 hover:text-slate-900 hover:border-slate-300 transition-all flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Exportar CSV
          </button>
          <button
            onClick={fetchEvents}
            disabled={isLoading}
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
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Eventos</p>
          <p className="text-2xl font-bold mt-2">{summary?.total ?? events.length}</p>
        </div>
        <div className="glass-card p-5 md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
          <SummaryList title="Acciones" items={(summary?.byAction || []).map(item => ({ label: actionLabels[item.action] || item.action, count: item.count }))} />
          <SummaryList title="Entidades" items={(summary?.byEntity || []).map(item => ({ label: item.entity_type, count: item.count }))} />
          <SummaryList title="Usuarios" items={(summary?.byUser || []).map(item => ({ label: item.staff_name, count: item.count }))} />
        </div>
      </div>

      <div className="glass-card p-4 space-y-4">
        <div className="flex items-center gap-2"><Filter className="h-4 w-4 text-slate-600" aria-hidden="true" /><h3 className="text-sm font-bold">Filtros de auditoría</h3></div>
        <FilterBar activeCount={Object.entries(filters).filter(([key, value]) => key !== 'limit' && Boolean(value)).length} onClear={clearFilters}>
          <label className="block min-w-0 text-xs font-semibold text-slate-600">Buscar
            <Input value={filters.q} onChange={event => updateFilter('q', event.target.value)} placeholder="Usuario, entidad o detalle" className="mt-1" />
          </label>
          <label className="block text-xs font-semibold text-slate-600">Acción exacta
            <Input value={filters.action} onChange={event => updateFilter('action', event.target.value)} className="mt-1" />
          </label>
          <label className="block text-xs font-semibold text-slate-600">Entidad
            <Select value={filters.entity_type} onChange={event => updateFilter('entity_type', event.target.value)} className="mt-1">{entityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
          </label>
          <label className="block text-xs font-semibold text-slate-600">Desde
            <Input type="date" value={filters.from} onChange={event => updateFilter('from', event.target.value)} className="mt-1" />
          </label>
          <label className="block text-xs font-semibold text-slate-600">Hasta
            <Input type="date" value={filters.to} onChange={event => updateFilter('to', event.target.value)} className="mt-1" />
          </label>
        </FilterBar>
      </div>

      <DataView<AuditEvent> className="[&_table]:table-fixed [&_td]:[overflow-wrap:anywhere]" caption="Eventos de auditoría" items={events} getKey={event => event.id} loading={isLoading} emptyMessage="Sin eventos para los filtros seleccionados" columns={[
        { key: 'action', label: 'Acción', primary: true, render: event => <span>{actionLabels[event.action] || event.action}</span> },
        { key: 'date', label: 'Fecha', render: event => new Date(event.created_at).toLocaleString('es-CL') },
        { key: 'user', label: 'Usuario', render: event => <span>{event.staff_name || 'Sistema'}<span className="block text-xs text-slate-600 break-all">{event.staff_email || event.ip_address || ''}</span></span> },
        { key: 'entity', label: 'Entidad', render: event => `${event.entity_type}${event.entity_id ? ` #${event.entity_id}` : ''}` },
        { key: 'detail', label: 'Detalle', hideOnMobile: true, render: event => <span className="block max-w-xs truncate">{formatMetadata(event.metadata)}</span> },
        { key: 'view', label: 'Ver', className: 'w-20', render: event => <button type="button" onClick={() => setSelectedEvent(event)} aria-label={`Ver detalle del evento ${event.id}`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"><Eye className="h-5 w-5" aria-hidden="true" /></button> },
      ]} />

      <Sheet open={Boolean(selectedEvent)} onClose={() => setSelectedEvent(null)} title={selectedEvent ? `Evento #${selectedEvent.id}` : 'Evento'}>
        {selectedEvent && <div className="space-y-5">
          <h3 className="text-lg font-bold">{actionLabels[selectedEvent.action] || selectedEvent.action}</h3>
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Detail label="Fecha" value={new Date(selectedEvent.created_at).toLocaleString('es-CL')} />
            <Detail label="Usuario" value={selectedEvent.staff_name || 'Sistema'} />
            <Detail label="Correo/IP" value={selectedEvent.staff_email || selectedEvent.ip_address || '-'} />
            <Detail label="Entidad" value={`${selectedEvent.entity_type}${selectedEvent.entity_id ? ` #${selectedEvent.entity_id}` : ''}`} />
          </div>
          <div><p className="mb-2 text-xs font-bold uppercase text-slate-600">Detalle</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950 p-4 text-xs text-white">{formatMetadataBlock(selectedEvent.metadata)}</pre></div>
        </div>}
      </Sheet>
    </div>
  );
};

const SummaryList = ({ title, items }: { title: string; items: { label: string; count: number }[] }) => (
  <div className="space-y-2">
    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">{title}</p>
    {items.length === 0 ? (
      <p className="text-xs text-slate-600">Sin datos</p>
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
    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">{label}</p>
    <p className="text-sm font-bold text-slate-900 mt-1 break-words">{value}</p>
  </div>
);

export default AuditPage;
