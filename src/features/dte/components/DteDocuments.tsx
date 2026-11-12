import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { apiFetchJson } from '../../../lib/api';
import { Badge, Button, DataView, Select } from '../../../ui';
import { DTE_STATUS, DTE_TYPE_NAMES, formatDate, money, openPrintView, type DteDocumentListItem } from '../dteShared';

const FILTERS = [
  ['all', 'Todos'], ['queued', 'En cola'], ['sent', 'Enviados'], ['accepted', 'Aceptados'], ['accepted_with_objections', 'Con reparos'], ['rejected', 'Rechazados'],
] as const;

/** Documentos electrónicos emitidos por la empresa, con su estado ante el SII. */
export function DteDocuments() {
  const [status, setStatus] = useState('all');
  const query = useQuery({
    queryKey: ['dte', 'documents', status],
    queryFn: ({ signal }) => apiFetchJson<{ items: DteDocumentListItem[]; total: number }>(`/api/dte/documents?limit=50${status === 'all' ? '' : `&status=${status}`}`, { signal }),
  });
  const items = query.data?.items ?? [];

  return (
    <section aria-labelledby="dte-documents-title" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="dte-documents-title" className="text-lg font-bold text-slate-900">Documentos electrónicos</h3>
          <p className="text-sm text-slate-600">{query.data ? `${query.data.total} documentos${query.data.total > items.length ? ` (se muestran los ${items.length} más recientes)` : ''}` : 'Cargando…'}</p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
          Estado
          <Select value={status} onChange={event => setStatus(event.target.value)} className="sm:w-56">
            {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </label>
      </div>
      {query.error && <p role="alert" className="text-sm font-semibold text-red-800">{query.error.message}</p>}
      <DataView<DteDocumentListItem>
        caption="Documentos electrónicos"
        loading={query.isPending}
        items={items}
        getKey={doc => doc.id}
        emptyMessage="Aún no hay documentos electrónicos"
        columns={[
          {
            key: 'doc', label: 'Documento', primary: true,
            render: doc => <span>{DTE_TYPE_NAMES[doc.dte_type] || doc.dte_type} N° {doc.folio}{doc.environment === 'certificacion' && <span className="ml-2 text-xs font-semibold text-amber-800">(prueba)</span>}<span className="block text-xs font-normal text-slate-600">{doc.receptor_razon || 'Consumidor final'}</span></span>,
          },
          { key: 'date', label: 'Fecha', render: doc => formatDate(doc.issued_at) },
          { key: 'total', label: 'Monto', render: doc => money(doc.total), className: 'whitespace-nowrap' },
          {
            key: 'status', label: 'Estado SII',
            render: doc => {
              const meta = DTE_STATUS[doc.status] || { label: doc.status, tone: 'neutral' as const };
              return <span><Badge tone={meta.tone}>{meta.label}</Badge>{doc.status_detail && <span className="mt-1 block text-xs text-slate-600">{doc.status_detail}</span>}</span>;
            },
          },
          {
            key: 'actions', label: 'Imprimir', fullWidthOnMobile: true,
            render: doc => (
              <span className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<Printer className="h-4 w-4" aria-hidden="true" />} onClick={() => openPrintView(doc.id, 'thermal')} aria-label={`Imprimir ticket de ${DTE_TYPE_NAMES[doc.dte_type] || 'documento'} ${doc.folio}`}>Ticket</Button>
                <Button size="sm" variant="secondary" icon={<Printer className="h-4 w-4" aria-hidden="true" />} onClick={() => openPrintView(doc.id, 'letter')} aria-label={`Imprimir ${DTE_TYPE_NAMES[doc.dte_type] || 'documento'} ${doc.folio} en carta`}>Carta</Button>
              </span>
            ),
          },
        ]}
      />
    </section>
  );
}
