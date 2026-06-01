import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Download, FileText, Filter, RefreshCw, Search, UserCheck } from 'lucide-react';
import type { DocumentRecord, StaffUser } from '../types';
import PaginationControls from '../components/ui/PaginationControls';
import { cn } from '../lib/utils';

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
  const initialParams = new URLSearchParams(window.location.search);
  const initialCriticalFilter = initialParams.get('filter') === 'critical';
  const initialDocumentId = Number(initialParams.get('documentId') || 0) || null;
  const [documents, setDocuments] = useState<ReviewDocument[]>([]);
  const [assignees, setAssignees] = useState<Pick<StaffUser, 'id' | 'name' | 'email' | 'role'>[]>([]);
  const [summary, setSummary] = useState<ReviewResponse['summary']>({ pending: 0, rejected: 0, expired: 0, expiringSoon: 0 });
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [libraryScope, setLibraryScope] = useState<'critical' | 'all'>(initialCriticalFilter ? 'critical' : 'critical');
  const [documentPage, setDocumentPage] = useState(1);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [focusedDocumentId, setFocusedDocumentId] = useState<number | null>(initialDocumentId);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const fetchDocuments = async () => {
    setIsLoading(true);
    setLoadError('');
    const params = new URLSearchParams();
    params.set('scope', libraryScope);
    params.set('page', String(documentPage));
    params.set('pageSize', String(DOCUMENT_PAGE_SIZE));
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (searchTerm.trim()) params.set('search', searchTerm.trim());

    try {
      const [res, assigneesRes] = await Promise.all([
        fetch(`/api/documents/review?${params.toString()}`),
        fetch('/api/documents/assignees'),
      ]);
      if (!res.ok || !assigneesRes.ok) throw new Error('No se pudo cargar documentos');
      const data: ReviewResponse = await res.json();
      setDocuments(data.documents);
      setDocumentTotal(Number(data.total || 0));
      setSummary(data.summary);
      setAssignees(await assigneesRes.json());
    } catch {
      setLoadError('No se pudo cargar el tablero documental.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [statusFilter, typeFilter, searchTerm, libraryScope, documentPage]);

  const filteredDocuments = useMemo(() => {
    return documents.filter(document => {
      const matchesFocused = !focusedDocumentId || document.id === focusedDocumentId;
      return matchesFocused;
    });
  }, [documents, focusedDocumentId]);

  const hasActiveFilters = statusFilter !== 'all' || typeFilter !== 'all' || searchTerm.trim().length > 0 || libraryScope !== 'critical' || Boolean(focusedDocumentId);
  const clearFilters = () => {
    setStatusFilter('all');
    setTypeFilter('all');
    setSearchTerm('');
    setLibraryScope('critical');
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
    const res = await fetch(`/api/documents/${documentId}`, {
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
      await updateDocument(document.id, { status, rejection_reason: reason, notes: reason, next_action_at: document.next_action_at || new Date().toISOString().slice(0, 10) });
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
          <p className="text-slate-500 mt-1">Documentos pendientes, observados y vencidos.</p>
        </div>
        <button
          onClick={fetchDocuments}
          disabled={isLoading}
          className="px-5 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50"
        >
          <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          Actualizar
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="glass-card p-6 border-l-4 border-l-amber-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pendientes</p>
          <p className="text-3xl font-bold text-amber-600 mt-2">{summary.pending}</p>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-red-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Observados</p>
          <p className="text-3xl font-bold text-red-600 mt-2">{summary.rejected}</p>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-rose-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vencidos</p>
          <p className="text-3xl font-bold text-rose-600 mt-2">{summary.expired}</p>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-blue-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vencen en 30 días</p>
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
                <p className="text-xs text-slate-500 truncate">{document.client_name || 'Sin cliente asociado'}</p>
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
                libraryScope === option.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[280px] bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
          <Search className="w-5 h-5 text-slate-400" />
          <input
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
          <Filter className="w-4 h-4 text-slate-400" />
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setDocumentPage(1); }} className="bg-transparent border-none outline-none text-sm font-medium">
            <option value="all">{libraryScope === 'critical' ? 'Estados críticos' : 'Todos los estados'}</option>
            <option value="pending">Pendientes</option>
            {libraryScope === 'all' && <option value="received">Recibidos</option>}
            {libraryScope === 'all' && <option value="approved">Aprobados</option>}
            <option value="rejected">Observados</option>
            <option value="expired">Vencidos</option>
          </select>
        </div>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setDocumentPage(1); }} className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none">
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

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Documento</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Cliente / Origen</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Estado</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Vencimiento</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Responsable / Próxima acción</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">Cargando documentos...</td>
              </tr>
            )}
            {!isLoading && loadError && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-sm text-red-500">{loadError}</td>
              </tr>
            )}
            {!isLoading && !loadError && filteredDocuments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12">
                  <div className="mx-auto flex max-w-xl flex-col items-center text-center">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                      <CheckCircle2 className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-bold text-slate-900">
                      {hasActiveFilters ? 'No hay documentos para esos filtros.' : 'Documentos críticos al día.'}
                    </p>
                    <p className="mt-2 text-sm text-slate-500">
                      {hasActiveFilters
                        ? 'Limpia la búsqueda para volver al tablero crítico completo.'
                        : 'No hay documentos pendientes, observados o vencidos. Para cargar respaldos nuevos, entra a la ficha del cliente correspondiente.'}
                    </p>
                    <div className="mt-5 flex flex-wrap justify-center gap-3">
                      {hasActiveFilters && (
                        <button
                          type="button"
                          onClick={clearFilters}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                        >
                          Limpiar filtros
                        </button>
                      )}
                      <Link
                        to="/clients"
                        className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-slate-800"
                      >
                        Ir a clientes
                      </Link>
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {!isLoading && !loadError && filteredDocuments.map(document => {
              const clientId = getDocumentClientId(document);
              const contractId = getDocumentContractId(document);

              return (
              <tr key={document.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-500">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{document.label}</p>
                      <p className="text-xs text-slate-500">{typeLabel[document.document_type]} · {document.file_name}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm font-bold">{document.client_name || 'Sin cliente asociado'}</p>
                  <p className="text-xs text-slate-500">
                    {document.entity_type === 'client' ? 'Ficha cliente' : document.entity_type === 'contract' ? `Contrato #CON-${document.entity_id.toString().padStart(3, '0')}` : `Pago #PAG-${document.entity_id.toString().padStart(4, '0')}`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {clientId && (
                      <Link
                        to={`/clients?id=${clientId}`}
                        className="rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 transition-all hover:bg-slate-200"
                      >
                        Abrir cliente
                      </Link>
                    )}
                    {contractId && (
                      <Link
                        to={`/contracts?id=${contractId}`}
                        className="rounded-lg bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-700 transition-all hover:bg-blue-100"
                      >
                        Abrir contrato
                      </Link>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                    document.status === 'pending' ? "bg-amber-100 text-amber-600" :
                      document.status === 'rejected' ? "bg-red-100 text-red-600" :
                        document.status === 'approved' ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"
                  )}>
                    {statusLabel[document.status]}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {document.expires_at ? new Date(document.expires_at).toLocaleDateString() : 'Sin vencimiento'}
                </td>
                <td className="px-6 py-4 text-sm text-slate-500 min-w-[260px]">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-slate-300" />
                      <select
                        value={document.assigned_staff_id || ''}
                        onChange={(e) => updateDocument(document.id, { assigned_staff_id: e.target.value || null })}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold outline-none"
                      >
                        <option value="">Sin responsable</option>
                        {assignees.map(assignee => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}
                      </select>
                    </div>
                    <input
                      type="date"
                      value={document.next_action_at || ''}
                      onChange={(e) => updateDocument(document.id, { next_action_at: e.target.value || null })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold outline-none"
                    />
                    <p className="line-clamp-2 text-xs">{document.rejection_reason || document.notes || 'Sin notas'}</p>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex justify-end items-center gap-2">
                    <select
                      value={document.status}
                      onChange={(e) => updateStatus(document, e.target.value)}
                      className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                    >
                      <option value="pending">Pendiente</option>
                      <option value="received">Recibido</option>
                      <option value="approved">Aprobado</option>
                      <option value="rejected">Observado</option>
                      <option value="expired">Vencido</option>
                    </select>
                    <a
                      href={`/api/documents/${document.id}/download`}
                      className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                      aria-label={`Descargar ${document.label}`}
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
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
