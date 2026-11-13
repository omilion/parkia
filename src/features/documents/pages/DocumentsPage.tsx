import { useApiMutation } from '../../../lib/useApiMutation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetchJson } from '../../../lib/api';
import { DataView } from '../../../ui/DataView';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Building2, Download, Filter, RefreshCw, Search } from 'lucide-react';
import type { Branch, DocumentRecord, StaffUser } from '../../../types';
import PaginationControls from '../../../components/ui/PaginationControls';
import { cn } from '../../../lib/utils';
import { todayLocal } from '../../../../shared/dates';

const DOCUMENT_PAGE_SIZE = 50;

type ReviewDocument = DocumentRecord & {
  client_name: string | null;
  contract_id_display: number | null;
};

type ReviewResponse = {
  documents: ReviewDocument[];
  summary: {
    pending: number;
    rejected: number;
    expired: number;
    expiringSoon: number;
  };
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const statusLabel: Record<string, string> = {
  pending: 'Pendiente',
  received: 'Recibido',
  approved: 'Aprobado',
  rejected: 'Observado',
  expired: 'Vencido',
};

const typeLabel: Record<string, string> = {
  contract: 'Contrato',
  identity: 'Identidad',
  mandate: 'Mandato',
  receipt: 'Comprobante',
  other: 'Otro',
};

const DocumentsPage = () => {
  const apiWrite = useApiMutation("features/documents/pages");
  const initialParams = new URLSearchParams(window.location.search);
  const initialCriticalFilter = initialParams.get('filter') === 'critical';
  const initialDocumentId = Number(initialParams.get('documentId') || 0) || null;
  const [selectedBranchId, setSelectedBranchId] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [libraryScope, setLibraryScope] = useState<'critical' | 'all'>(initialCriticalFilter ? 'critical' : 'critical');
  const [documentPage, setDocumentPage] = useState(1);
  const [focusedDocumentId, setFocusedDocumentId] = useState<number | null>(initialDocumentId);
  const [actionError, setLoadError] = useState('');

  const queryClient = useQueryClient();
  const params = new URLSearchParams({ scope: libraryScope, page: String(documentPage), pageSize: String(DOCUMENT_PAGE_SIZE) });
  if (statusFilter !== 'all') params.set('status', statusFilter);
  if (typeFilter !== 'all') params.set('type', typeFilter);
  if (searchTerm.trim()) params.set('search', searchTerm.trim());
  if (selectedBranchId !== 'all') params.set('branch_id', selectedBranchId);
  const documentQuery = useQuery({ queryKey: ['documents', params.toString()], queryFn: async ({ signal }) => {
    const [review, assignees, branches] = await Promise.all([
      apiFetchJson<ReviewResponse>(`/api/documents/review?${params}`, { signal }),
      apiFetchJson<Pick<StaffUser, 'id' | 'name' | 'email' | 'role'>[]>('/api/documents/assignees', { signal }), apiFetchJson<Branch[]>('/api/branches', { signal }),
    ]); return { review, assignees, branches };
  } });
  const documents = documentQuery.data?.review.documents ?? [];
  const summary = documentQuery.data?.review.summary ?? { pending: 0, rejected: 0, expired: 0, expiringSoon: 0 };
  const documentTotal = documentQuery.data?.review.total ?? 0;
  const assignees = documentQuery.data?.assignees ?? [];
  const branches = documentQuery.data?.branches ?? [];
  const isLoading = documentQuery.isPending;
  const loadError = actionError || documentQuery.error?.message || '';
  const fetchDocuments = () => { setLoadError(''); return queryClient.invalidateQueries({ queryKey: ['documents'] }); };

  const filteredDocuments = useMemo(() => {
    return documents.filter(document => {
      const matchesFocused = !focusedDocumentId || document.id === focusedDocumentId;
      return matchesFocused;
    });
  }, [documents, focusedDocumentId]);

  const hasActiveFilters = statusFilter !== 'all' || typeFilter !== 'all' || searchTerm.trim().length > 0 || libraryScope !== 'critical' || selectedBranchId !== 'all' || Boolean(focusedDocumentId);
  const clearFilters = () => {
    setStatusFilter('all');
    setTypeFilter('all');
    setSearchTerm('');
    setLibraryScope('critical');
    setSelectedBranchId('all');
    setDocumentPage(1);
    setFocusedDocumentId(null);
  };

  const getDocumentClientId = (document: ReviewDocument) => (
    document.entity_type === 'client' ? document.entity_id : null
  );

  const getDocumentContractId = (document: ReviewDocument) => (
    document.entity_type === 'contract' ? document.entity_id : document.contract_id_display
  );

  const updateDocument = async (documentId: number, payload: Record<string, unknown>) => {
    const res = await apiWrite.request(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      fetchDocuments();
    } else {
      const body = await res.json();
      setLoadError(body.error || 'No se pudo actualizar el documento.');
    }
  };

  const updateStatus = async (document: ReviewDocument, status: string) => {
    if (status === 'rejected') {
      const reason = window.prompt('Motivo de observación del documento');
      if (!reason?.trim()) {
        setLoadError('Observar un documento requiere motivo.');
        return;
      }
      await updateDocument(document.id, { status, rejection_reason: reason, notes: reason, next_action_at: document.next_action_at || todayLocal() });
      return;
    }
    await updateDocument(document.id, { status });
  };

  const expiringSoonDocuments = documents.filter(document =>
    document.expires_at &&
    document.status !== 'approved' &&
    document.status !== 'expired' &&
    new Date(document.expires_at) > new Date() &&
    new Date(document.expires_at) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  ).slice(0, 4);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Seguimiento Documental</h2>
          <p className="text-slate-600 mt-1">Documentos pendientes, observados y vencidos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">
            <Building2 className="w-4 h-4 text-slate-600" />
            <select aria-label="Sucursal"
              value={selectedBranchId}
              onChange={(event) => {
                setSelectedBranchId(event.target.value);
                setDocumentPage(1);
              }}
              className="bg-transparent outline-none"
            >
              <option value="all">Todas las sucursales</option>
              {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <button
            onClick={fetchDocuments}
            disabled={isLoading}
            className="px-5 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
            Actualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="glass-card p-6 border-l-4 border-l-amber-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Pendientes</p>
          <p className="text-3xl font-bold text-amber-800 mt-2">{summary.pending}</p>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-red-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Observados</p>
          <p className="text-3xl font-bold text-red-700 mt-2">{summary.rejected}</p>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-rose-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Vencidos</p>
          <p className="text-3xl font-bold text-rose-600 mt-2">{summary.expired}</p>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-blue-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Vencen en 30 días</p>
          <p className="text-3xl font-bold text-blue-600 mt-2">{summary.expiringSoon}</p>
        </div>
      </div>

      {expiringSoonDocuments.length > 0 && (
        <div className="border border-blue-100 bg-blue-50 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-blue-600" />
            <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wider">Próximos vencimientos</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {expiringSoonDocuments.map(document => (
              <div key={document.id} className="bg-white border border-blue-100 rounded-xl p-4 min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">{document.label}</p>
                <p className="text-xs text-slate-600 truncate">{document.client_name || 'Sin cliente asociado'}</p>
                {document.branch_name && <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mt-1">{document.branch_name}</p>}
                <p className="text-xs font-bold text-blue-600 mt-2">Vence {new Date(document.expires_at!).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <div className="flex bg-slate-100 p-1.5 rounded-2xl">
          {[
            { id: 'critical', label: 'Críticos' },
            { id: 'all', label: 'Biblioteca completa' },
          ].map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setLibraryScope(option.id as 'critical' | 'all');
                if (option.id === 'critical' && ['received', 'approved'].includes(statusFilter)) setStatusFilter('all');
                setDocumentPage(1);
              }}
              className={cn(
                "rounded-xl px-4 py-2 text-xs font-bold transition-all",
                libraryScope === option.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-700"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[280px] bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
          <Search className="w-5 h-5 text-slate-600" />
          <input aria-label="Buscar por cliente, documento, archivo o nota..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setDocumentPage(1);
            }}
            placeholder="Buscar por cliente, documento, archivo o nota..."
            className="bg-transparent border-none outline-none text-sm w-full"
          />
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
          <Filter className="w-4 h-4 text-slate-600" />
          <select aria-label="Estado del documento" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setDocumentPage(1); }} className="bg-transparent border-none outline-none text-sm font-medium">
            <option value="all">{libraryScope === 'critical' ? 'Estados críticos' : 'Todos los estados'}</option>
            <option value="pending">Pendientes</option>
            {libraryScope === 'all' && <option value="received">Recibidos</option>}
            {libraryScope === 'all' && <option value="approved">Aprobados</option>}
            <option value="rejected">Observados</option>
            <option value="expired">Vencidos</option>
          </select>
        </div>
        <select aria-label="Todos los tipos" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setDocumentPage(1); }} className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none">
          <option value="all">Todos los tipos</option>
          <option value="contract">Contratos</option>
          <option value="identity">Identidad</option>
          <option value="mandate">Mandatos</option>
          <option value="receipt">Comprobantes</option>
          <option value="other">Otros</option>
        </select>
      </div>

      {(libraryScope === 'all' || focusedDocumentId) && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-sm font-bold text-blue-700">
            {focusedDocumentId ? `Mostrando documento #${focusedDocumentId}` : 'Mostrando biblioteca documental completa'}
          </p>
          <button onClick={clearFilters} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all">
            Limpiar filtros
          </button>
        </div>
      )}

      <div>
        {loadError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{loadError}</p>}
        <DataView<ReviewDocument> caption="Documentos" items={loadError ? [] : filteredDocuments} loading={isLoading} getKey={document => document.id} emptyMessage={loadError || 'No hay documentos para los filtros seleccionados'} columns={[
          { key: 'document', label: 'Documento', primary: true, render: document => <span>{document.label}<span className="block break-all text-xs font-normal text-slate-600">{typeLabel[document.document_type]} - {document.file_name}</span></span> },
          { key: 'owner', label: 'Cliente', render: document => <div className="space-y-2"><p>{document.client_name || 'Sin cliente asociado'}</p>{document.branch_name && <p className="text-xs text-slate-600">{document.branch_name}</p>}<div className="flex flex-wrap justify-end gap-2">{getDocumentClientId(document) && <Link className="inline-flex min-h-11 items-center text-indigo-700 underline" to={`/clients?id=${getDocumentClientId(document)}`}>Cliente</Link>}{getDocumentContractId(document) && <Link className="inline-flex min-h-11 items-center text-indigo-700 underline" to={`/contracts?id=${getDocumentContractId(document)}`}>Contrato</Link>}</div></div> },
          { key: 'status', label: 'Estado', render: document => <span className="font-semibold">{statusLabel[document.status]}</span> },
          { key: 'expiry', label: 'Vencimiento', render: document => document.expires_at ? new Date(document.expires_at).toLocaleDateString('es-CL') : 'Sin vencimiento' },
          { key: 'followup', label: 'Seguimiento', fullWidthOnMobile: true, render: document => <div className="min-w-0 space-y-2"><select aria-label={`Responsable de ${document.label}`} value={document.assigned_staff_id || ''} onChange={e => updateDocument(document.id, { assigned_staff_id: e.target.value || null })} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">Sin responsable</option>{assignees.map(assignee => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select><input aria-label={`Proxima accion de ${document.label}`} type="date" value={document.next_action_at || ''} onChange={e => updateDocument(document.id, { next_action_at: e.target.value || null })} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /><p className="break-words text-xs text-slate-600">{document.rejection_reason || document.notes || 'Sin notas'}</p></div> },
          { key: 'actions', label: 'Acciones', fullWidthOnMobile: true, render: document => <div className="flex flex-wrap justify-end gap-2"><select aria-label={`Estado de ${document.label}`} value={document.status} onChange={e => updateStatus(document, e.target.value)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="pending">Pendiente</option><option value="received">Recibido</option><option value="approved">Aprobado</option><option value="rejected">Observado</option><option value="expired">Vencido</option></select><a href={`/api/documents/${document.id}/download`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100" aria-label={`Descargar ${document.label}`}><Download className="h-5 w-5" aria-hidden="true" /></a></div> },
        ]} />
        <PaginationControls
          page={documentPage}
          pageSize={DOCUMENT_PAGE_SIZE}
          total={documentTotal}
          onPageChange={setDocumentPage}
        />
      </div>
    </div>
  );
};

export default DocumentsPage;
