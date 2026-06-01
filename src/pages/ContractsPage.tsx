import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { Archive, Ban, CheckCircle2, ChevronRight, Download, Eye, FileText, Printer, Search, UploadCloud, X, XCircle } from 'lucide-react';
import { Branch, Client, Contract, DocumentRecord, PaginatedResponse, Payment, Space } from '../types';
import Drawer from '../components/ui/Drawer';
import PaginationControls from '../components/ui/PaginationControls';
import Toast from '../components/ui/Toast';
import { apiFetchJson } from '../lib/api';
import { cn } from '../lib/utils';

const CONTRACT_PAGE_SIZE = 25;

type ContractDetail = {
  contract: Contract & {
    client_rut?: string | null;
    client_email?: string | null;
    client_phone?: string | null;
    client_type?: string | null;
    client_address?: string | null;
    client_business_activity?: string | null;
    billing_contact_name?: string | null;
    billing_contact_email?: string | null;
    billing_contact_phone?: string | null;
    space_price?: number | null;
  };
  payments: Array<Payment & { allocated_amount?: number; remaining_amount?: number }>;
  documents: DocumentRecord[];
  audit: Array<{
    id: number;
    action: string;
    created_at: string;
    staff_name?: string | null;
    staff_email?: string | null;
    metadata?: string | null;
  }>;
};

const formatCurrency = (value: number | null | undefined) => `$${Number(value || 0).toLocaleString()}`;

const ContractsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [availableSpaces, setAvailableSpaces] = useState<Space[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [searchContract, setSearchContract] = useState('');
  const [contractStatus, setContractStatus] = useState('all');
  const [contractPage, setContractPage] = useState(1);
  const [contractTotal, setContractTotal] = useState(0);
  const [searchClient, setSearchClient] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contractAction, setContractAction] = useState<{ contract: Contract, action: 'suspend' | 'reactivate' | 'terminate' } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionDate, setActionDate] = useState('');
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);
  const [showExpiringOnly, setShowExpiringOnly] = useState(() => new URLSearchParams(window.location.search).get('filter') === 'expiring');
  const [selectedBranchId, setSelectedBranchId] = useState('all');
  const [renewingContract, setRenewingContract] = useState<Contract | null>(null);
  const [newEndDate, setNewEndDate] = useState('');
  const [isRenewing, setIsRenewing] = useState(false);
  const [contractUpload, setContractUpload] = useState<Contract | null>(null);
  const [signedFileName, setSignedFileName] = useState('');
  const [isUploadingSigned, setIsUploadingSigned] = useState(false);
  const [isGeneratingPdfId, setIsGeneratingPdfId] = useState<number | null>(null);
  const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
  const [contractDetail, setContractDetail] = useState<ContractDetail | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [editingContract, setEditingContract] = useState<ContractDetail['contract'] | null>(null);
  const [isUpdatingContract, setIsUpdatingContract] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const contractParams = new URLSearchParams({
        page: String(contractPage),
        pageSize: String(CONTRACT_PAGE_SIZE),
      });
      if (searchContract.trim()) contractParams.set('search', searchContract.trim());
      if (contractStatus !== 'all') contractParams.set('status', contractStatus);
      if (showExpiringOnly) contractParams.set('expiring', 'true');
      if (selectedBranchId !== 'all') contractParams.set('branch_id', selectedBranchId);
      const spaceParams = new URLSearchParams();
      if (selectedBranchId !== 'all') spaceParams.set('branch_id', selectedBranchId);
      const [cRes, clRes, sRes, bRes] = await Promise.all([
        fetch(`/api/contracts?${contractParams.toString()}`),
        fetch('/api/clients'),
        fetch(`/api/spaces/available${spaceParams.toString() ? `?${spaceParams.toString()}` : ''}`),
        fetch('/api/branches')
      ]);
      if (!cRes.ok || !clRes.ok || !sRes.ok || !bRes.ok) throw new Error('No se pudo cargar contratos');
      const contractData = await cRes.json() as PaginatedResponse<Contract>;
      setContracts(contractData.items || []);
      setContractTotal(Number(contractData.total || 0));
      setClients(await clRes.json());
      setAvailableSpaces(await sRes.json());
      setBranches(await bRes.json());
    } catch {
      setLoadError('No se pudo cargar la información de contratos.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [searchContract, contractStatus, showExpiringOnly, contractPage, selectedBranchId]);

  const fetchContractDetail = async (contractId: number) => {
    setIsDetailLoading(true);
    setDetailError('');
    setContractDetail(null);
    try {
      const detail = await apiFetchJson<ContractDetail>(`/api/contracts/${contractId}/detail`);
      setContractDetail(detail);
    } catch (error: any) {
      setDetailError(error.message || 'No se pudo cargar el detalle del contrato');
    } finally {
      setIsDetailLoading(false);
    }
  };

  useEffect(() => {
    const requestedContractId = Number(searchParams.get('id') || 0);
    if (Number.isFinite(requestedContractId) && requestedContractId > 0) {
      setSelectedContractId(requestedContractId);
      fetchContractDetail(requestedContractId);
      return;
    }

    setSelectedContractId(null);
    setContractDetail(null);
    setDetailError('');
  }, [searchParams]);

  const openContractDetail = (contractId: number) => {
    setSelectedContractId(contractId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('id', String(contractId));
      return next;
    });
  };

  const closeContractDetail = () => {
    setSelectedContractId(null);
    setContractDetail(null);
    setDetailError('');
    setEditingContract(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('id');
      return next;
    }, { replace: true });
  };

  const handleCreateContract = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedClient || !selectedSpace) return;

    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const data = {
      ...Object.fromEntries(formData.entries()),
      client_id: selectedClient.id,
      monthly_fee: Number(formData.get('monthly_fee')),
      billing_day: Number(formData.get('billing_day')),
      deposit_amount: Number(formData.get('deposit_amount') || 0)
    };

    try {
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (res.ok) {
        const result = await res.json();
        const receivableCount = Number(result.receivables?.created || 0);
        setToast({
          message: `Contrato CON-2026-${result.id.toString().padStart(3, '0')} generado con ${receivableCount} cobro${receivableCount === 1 ? '' : 's'} programado${receivableCount === 1 ? '' : 's'}`,
          type: 'success'
        });
        setIsDrawerOpen(false);
        setSelectedClient(null);
        setSelectedSpace(null);
        setSearchClient('');
        fetchData();
      } else {
        const err = await res.json();
        setToast({ message: err.error || 'Error al generar contrato', type: 'error' });
      }
    } catch {
      setToast({ message: 'No se pudo conectar para generar el contrato', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredClients = clients.filter(c =>
    c.name.toLowerCase().includes(searchClient.toLowerCase()) ||
    c.rut.toLowerCase().includes(searchClient.toLowerCase())
  ).slice(0, 5);

  const isExpiringContract = (contract: Contract) => {
    if (contract.status !== 'active' || !contract.end_date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(contract.end_date);
    return endDate >= today && endDate <= new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  };

  const filteredContracts = contracts;

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedClient(null);
    setSelectedSpace(null);
    setSearchClient('');
  };

  const closeActionDialog = () => {
    setContractAction(null);
    setActionReason('');
    setActionDate('');
  };

  const closeRenewDialog = () => {
    setRenewingContract(null);
    setNewEndDate('');
  };

  const handleRenewContract = async () => {
    if (!renewingContract || !newEndDate) return;
    setIsRenewing(true);
    const res = await fetch(`/api/contracts/${renewingContract.id}/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_end_date: newEndDate }),
    });

    if (res.ok) {
      const result = await res.json();
      const receivableCount = Number(result.receivables?.created || 0);
      setToast({ message: `Contrato renovado correctamente. ${receivableCount} cobro${receivableCount === 1 ? '' : 's'} nuevo${receivableCount === 1 ? '' : 's'}.`, type: 'success' });
      closeRenewDialog();
      fetchData();
    } else {
      const err = await res.json();
      setToast({ message: err.error || 'No se pudo renovar el contrato', type: 'error' });
    }
    setIsRenewing(false);
  };

  const handleContractAction = async () => {
    if (!contractAction || actionReason.trim().length < 3) return;

    setIsActionSubmitting(true);
    const res = await fetch(`/api/contracts/${contractAction.contract.id}/${contractAction.action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: actionReason,
        effective_date: actionDate || undefined,
      }),
    });

    if (res.ok) {
      const label = contractAction.action === 'suspend' ? 'suspendido' : contractAction.action === 'reactivate' ? 'reactivado' : 'terminado';
      setToast({ message: `Contrato ${label} correctamente`, type: 'success' });
      closeActionDialog();
      fetchData();
    } else {
      const err = await res.json();
      setToast({ message: err.error || 'No se pudo actualizar el contrato', type: 'error' });
    }
    setIsActionSubmitting(false);
  };

  const handleUpdateContract = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingContract) return;

    const formData = new FormData(e.currentTarget);
    const payload = {
      start_date: String(formData.get('start_date') || ''),
      end_date: String(formData.get('end_date') || ''),
      monthly_fee: Number(formData.get('monthly_fee')),
      billing_day: Number(formData.get('billing_day')),
      deposit_amount: Number(formData.get('deposit_amount') || 0),
      billing_document_type: String(formData.get('billing_document_type') || 'boleta'),
      notes: String(formData.get('notes') || ''),
      reason: String(formData.get('reason') || ''),
    };

    setIsUpdatingContract(true);
    try {
      const res = await fetch(`/api/contracts/${editingContract.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'No se pudo actualizar el contrato');
      }

      const result = await res.json();
      const receivables = result.receivables;
      const receivableSummary = receivables
        ? ` Cobros: ${Number(receivables.created || 0)} creados, ${Number(receivables.updated || 0)} actualizados, ${Number(receivables.cancelled || 0)} cancelados.`
        : '';
      setToast({ message: `Contrato actualizado.${receivableSummary}`, type: 'success' });
      setEditingContract(null);
      fetchData();
      fetchContractDetail(editingContract.id);
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo actualizar el contrato', type: 'error' });
    } finally {
      setIsUpdatingContract(false);
    }
  };

  const actionLabels = {
    suspend: { title: 'Suspender contrato', button: 'Suspender', tone: 'amber' },
    reactivate: { title: 'Reactivar contrato', button: 'Reactivar', tone: 'emerald' },
    terminate: { title: 'Terminar contrato', button: 'Terminar', tone: 'red' },
  };

  const fileToPayload = (file: File) => new Promise<{ fileName: string, mimeType: string, dataBase64: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        fileName: file.name,
        mimeType: file.type,
        dataBase64: result.includes(',') ? result.split(',')[1] : result,
      });
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });

  const closeUploadDialog = () => {
    setContractUpload(null);
    setSignedFileName('');
  };

  const handleSignedUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!contractUpload) return;
    const formData = new FormData(e.currentTarget);
    const file = formData.get('signed_contract');
    if (!(file instanceof File) || file.size === 0) {
      setToast({ message: 'Seleccione el contrato firmado.', type: 'error' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setToast({ message: 'El archivo no puede superar 5MB.', type: 'error' });
      return;
    }

    setIsUploadingSigned(true);
    try {
      const payload = await fileToPayload(file);
      const res = await fetch(`/api/documents/contract/${contractUpload.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Contrato firmado',
          document_type: 'contract',
          status: 'approved',
          notes: `Contrato CON-2026-${contractUpload.id.toString().padStart(3, '0')} firmado`,
          ...payload,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'No se pudo guardar el contrato firmado');
      }
      setToast({ message: 'Contrato firmado adjuntado', type: 'success' });
      closeUploadDialog();
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo guardar el contrato firmado', type: 'error' });
    } finally {
      setIsUploadingSigned(false);
    }
  };

  const handleGeneratePdfDocument = async (contract: Contract) => {
    setIsGeneratingPdfId(contract.id);
    const res = await fetch(`/api/contracts/${contract.id}/generate-pdf`, { method: 'POST' });
    if (res.ok) {
      setToast({ message: 'PDF generado y archivado en documentos del contrato', type: 'success' });
    } else {
      const err = await res.json();
      setToast({ message: err.error || 'No se pudo generar el PDF', type: 'error' });
    }
    setIsGeneratingPdfId(null);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Administrador de Contratos</h2>
          <p className="text-slate-500 mt-1">Gestiona arriendos, tarifas y vigencias.</p>
        </div>
        <button
          onClick={() => setIsDrawerOpen(true)}
          className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold shadow-lg shadow-slate-200 hover:bg-slate-800 transition-all flex items-center gap-2"
        >
          <FileText className="w-5 h-5" />
          Generar Nuevo Contrato
        </button>
      </div>

      <div className="glass-card overflow-x-auto">
        <div className="p-4 border-b border-slate-100">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="max-w-md bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
              <Search className="w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por cliente, espacio o contrato..."
                className="bg-transparent border-none outline-none text-sm w-full"
                value={searchContract}
                onChange={(e) => {
                  setSearchContract(e.target.value);
                  setContractPage(1);
                }}
              />
            </div>
            <select
              value={contractStatus}
              onChange={(e) => {
                setContractStatus(e.target.value);
                setContractPage(1);
              }}
              className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 outline-none transition-all hover:bg-slate-50"
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="suspended">Suspendidos</option>
              <option value="terminated">Terminados</option>
            </select>
            <select
              value={selectedBranchId}
              onChange={(e) => {
                setSelectedBranchId(e.target.value);
                setSelectedSpace(null);
                setContractPage(1);
              }}
              className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 outline-none transition-all hover:bg-slate-50"
            >
              <option value="all">Todas las sucursales</option>
              {branches.map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setShowExpiringOnly(value => !value);
                setContractPage(1);
              }}
              className={cn(
                "w-fit rounded-xl px-4 py-2 text-xs font-bold transition-all",
                showExpiringOnly ? "bg-amber-100 text-amber-700" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              {showExpiringOnly ? 'Mostrando próximos a vencer' : 'Filtrar próximos a vencer'}
            </button>
          </div>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">ID</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Cliente</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Espacio</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Tarifa</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Estado</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Vigencia</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-sm text-slate-500">Cargando contratos...</td>
              </tr>
            )}
            {!isLoading && loadError && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-sm text-red-500">{loadError}</td>
              </tr>
            )}
            {!isLoading && !loadError && filteredContracts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-sm text-slate-500">No hay contratos para mostrar.</td>
              </tr>
            )}
            {!isLoading && !loadError && filteredContracts.map(contract => (
              <tr key={contract.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 text-sm font-mono text-slate-400">#CON-2026-{contract.id.toString().padStart(3, '0')}</td>
                <td className="px-6 py-4 text-sm font-bold">{contract.client_name}</td>
                <td className="px-6 py-4 text-sm font-medium text-slate-600">
                  <p>{contract.space_name}</p>
                  {contract.branch_name && <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{contract.branch_name}</p>}
                </td>
                <td className="px-6 py-4 text-sm font-bold">${contract.monthly_fee.toLocaleString()}</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                    contract.status === 'active' ? "bg-emerald-100 text-emerald-600" :
                      contract.status === 'terminated' ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-600"
                  )}>
                    {contract.status === 'active' ? 'Activo' : contract.status === 'terminated' ? 'Terminado' : 'Suspendido'}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-500">
                  <p>Desde {new Date(contract.start_date).toLocaleDateString()}</p>
                  {contract.end_date ? (
                    <p className={cn("text-xs font-bold", isExpiringContract(contract) ? "text-amber-600" : "text-slate-400")}>
                      Hasta {new Date(contract.end_date).toLocaleDateString()}
                    </p>
                  ) : (
                    <p className="text-xs font-bold text-slate-400">Indefinido</p>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => openContractDetail(contract.id)}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-100"
                      title="Ver detalle"
                      aria-label={`Ver detalle del contrato ${contract.id}`}
                    >
                      <Eye className="h-4 w-4" />
                      Ver detalle
                    </button>
                    {isExpiringContract(contract) && (
                      <button
                        onClick={() => setRenewingContract(contract)}
                        className="px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-50 rounded-lg transition-all"
                      >
                        Renovar
                      </button>
                    )}
                    <a
                      href={`/api/contracts/${contract.id}/print`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-all"
                      title="Imprimir contrato"
                      aria-label={`Imprimir contrato ${contract.id}`}
                    >
                      <Printer className="w-4 h-4" />
                    </a>
                    <a
                      href={`/api/contracts/${contract.id}/pdf`}
                      className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-all"
                      title="Descargar PDF"
                      aria-label={`Descargar PDF del contrato ${contract.id}`}
                    >
                      <Download className="w-4 h-4" />
                    </a>
                    <button
                      onClick={() => handleGeneratePdfDocument(contract)}
                      disabled={isGeneratingPdfId === contract.id}
                      className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all disabled:opacity-50"
                      title="Generar y archivar PDF"
                      aria-label={`Generar y archivar PDF del contrato ${contract.id}`}
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setContractUpload(contract)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                      title="Adjuntar contrato firmado"
                      aria-label={`Adjuntar contrato firmado ${contract.id}`}
                    >
                      <UploadCloud className="w-4 h-4" />
                    </button>
                    {contract.status === 'active' && (
                      <button
                        onClick={() => setContractAction({ contract, action: 'suspend' })}
                        className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                        title="Suspender contrato"
                        aria-label={`Suspender contrato ${contract.id}`}
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                    )}
                    {contract.status === 'suspended' && (
                      <button
                        onClick={() => setContractAction({ contract, action: 'reactivate' })}
                        className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                        title="Reactivar contrato"
                        aria-label={`Reactivar contrato ${contract.id}`}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    )}
                    {contract.status !== 'terminated' && (
                      <button
                        onClick={() => setContractAction({ contract, action: 'terminate' })}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Terminar contrato"
                        aria-label={`Terminar contrato ${contract.id}`}
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <PaginationControls
          page={contractPage}
          pageSize={CONTRACT_PAGE_SIZE}
          total={contractTotal}
          onPageChange={setContractPage}
        />
      </div>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        title="Generar Nuevo Contrato"
      >
        <form onSubmit={handleCreateContract} className="space-y-6">
          <div className="space-y-6">
            <div className="relative">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Seleccionar Cliente</label>
              {!selectedClient ? (
                <>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3 focus-within:border-slate-900 transition-all">
                    <Search className="w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar por RUT o Nombre..."
                      className="bg-transparent border-none outline-none text-sm w-full"
                      value={searchClient}
                      onChange={(e) => setSearchClient(e.target.value)}
                    />
                  </div>
                  {searchClient.length >= 2 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl z-10 overflow-hidden">
                      {filteredClients.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedClient(c)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between group"
                        >
                          <div>
                            <p className="text-sm font-bold group-hover:text-blue-600">{c.name}</p>
                            <p className="text-xs text-slate-500">{c.rut}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-300" />
                        </button>
                      ))}
                      {filteredClients.length === 0 && (
                        <div className="p-4 text-center text-sm text-slate-400">No se encontraron clientes</div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-slate-900 text-white p-4 rounded-2xl flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">{selectedClient.name}</p>
                    <p className="text-xs opacity-60">{selectedClient.rut}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedClient(null)}
                    className="p-2 hover:bg-white/10 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Sucursal</label>
                <select
                  value={selectedBranchId}
                  onChange={(e) => {
                    setSelectedBranchId(e.target.value);
                    setSelectedSpace(null);
                    setContractPage(1);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
                >
                  <option value="all">Todas las sucursales</option>
                  {branches.map(branch => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Espacio Disponible</label>
                <select
                  name="space_id"
                  required
                  value={selectedSpace?.id ?? ''}
                  onChange={(e) => {
                    const space = availableSpaces.find(s => s.id === Number(e.target.value)) ?? null;
                    setSelectedSpace(space);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
                >
                  <option value="">Seleccione un espacio...</option>
                  {availableSpaces.map(s => (
                    <option key={s.id} value={s.id}>
                      {[s.name, s.branch_name].filter(Boolean).join(' - ')} (Estac.) - ${s.price.toLocaleString()}
                    </option>
                  ))}
                </select>
                {availableSpaces.length === 0 && (
                  <p className="mt-2 text-xs font-medium text-amber-600">No hay espacios disponibles para nuevos contratos.</p>
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Fecha de Inicio</label>
                <input type="date" name="start_date" required defaultValue={new Date().toISOString().split('T')[0]} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Fecha Término (Opcional)</label>
                <input type="date" name="end_date" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tarifa Mensual ($)</label>
                <input
                  key={selectedSpace?.id ?? 'no-space'}
                  type="number"
                  name="monthly_fee"
                  required
                  min="1"
                  defaultValue={selectedSpace?.price ?? ''}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
                  placeholder="45000"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Día de Cobro</label>
                <input type="number" name="billing_day" required defaultValue="5" min="1" max="28" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Garantía / Depósito ($)</label>
                <input type="number" name="deposit_amount" min="0" defaultValue="0" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Documento de Cobro</label>
                <select name="billing_document_type" defaultValue="boleta" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                  <option value="boleta">Boleta</option>
                  <option value="factura_exenta">Factura exenta</option>
                  <option value="factura_afecta">Factura afecta</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Notas Internas</label>
                <textarea name="notes" rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none" placeholder="Condiciones especiales, entrega de llaves, observaciones de cobranza..." />
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100 flex gap-4">
            <button type="button" onClick={closeDrawer} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
            <button type="submit" disabled={isSubmitting || !selectedClient || !selectedSpace} className="flex-[2] py-4 bg-emerald-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50">
              {isSubmitting ? 'Generando...' : 'Generar Contrato'}
            </button>
          </div>
        </form>
      </Drawer>

      <Drawer
        isOpen={Boolean(selectedContractId)}
        onClose={closeContractDetail}
        title="Detalle del Contrato"
      >
        {isDetailLoading && (
          <p className="py-10 text-center text-sm text-slate-500">Cargando detalle...</p>
        )}

        {!isDetailLoading && detailError && (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
            <p className="text-sm font-bold text-red-700">{detailError}</p>
          </div>
        )}

        {!isDetailLoading && !detailError && contractDetail && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-slate-900 p-5 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider opacity-60">#CON-2026-{contractDetail.contract.id.toString().padStart(3, '0')}</p>
                  <h3 className="mt-1 text-xl font-bold">{contractDetail.contract.client_name}</h3>
                  <p className="mt-1 text-sm opacity-70">{contractDetail.contract.space_name} · Estacionamiento</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={cn(
                    "rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider",
                    contractDetail.contract.status === 'active' ? "bg-emerald-400/20 text-emerald-100" :
                      contractDetail.contract.status === 'terminated' ? "bg-white/10 text-slate-200" : "bg-amber-400/20 text-amber-100"
                  )}>
                    {contractDetail.contract.status === 'active' ? 'Activo' : contractDetail.contract.status === 'terminated' ? 'Terminado' : 'Suspendido'}
                  </span>
                  {contractDetail.contract.status !== 'terminated' && (
                    <button
                      type="button"
                      onClick={() => setEditingContract(contractDetail.contract)}
                      className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-white/20"
                    >
                      Editar terminos
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <DetailTile label="Tarifa" value={formatCurrency(contractDetail.contract.monthly_fee)} />
                <DetailTile label="Saldo pendiente" value={formatCurrency(contractDetail.payments.reduce((sum, payment) => sum + Number(payment.remaining_amount || 0), 0))} />
                <DetailTile label="Inicio" value={contractDetail.contract.start_date} />
                <DetailTile label="Termino" value={contractDetail.contract.end_date || 'Indefinido'} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <section className="rounded-2xl border border-slate-100 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">Cliente</h4>
                  <Link
                    to={`/clients?id=${contractDetail.contract.client_id}`}
                    className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200"
                  >
                    Abrir ficha
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <DetailTile label="RUT" value={contractDetail.contract.client_rut || 'Sin RUT'} />
                  <DetailTile label="Tipo" value={contractDetail.contract.client_type || 'Sin tipo'} />
                  <DetailTile label="Email" value={contractDetail.contract.client_email || 'Sin email'} />
                  <DetailTile label="Telefono" value={contractDetail.contract.client_phone || 'Sin telefono'} />
                </div>
                <p className="mt-3 text-sm text-slate-600">{contractDetail.contract.client_address || 'Sin direccion registrada.'}</p>
              </section>

              <section className="rounded-2xl border border-slate-100 p-4">
                <h4 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">Espacio y condiciones</h4>
                <div className="grid grid-cols-2 gap-3">
                  <DetailTile label="Espacio" value={contractDetail.contract.space_name || 'Sin espacio'} />
                  <DetailTile label="Sucursal" value={contractDetail.contract.branch_name || 'Sin sucursal'} />
                  <DetailTile label="Precio base" value={formatCurrency(contractDetail.contract.space_price)} />
                  <DetailTile label="Dia cobro" value={String(contractDetail.contract.billing_day)} />
                  <DetailTile label="Garantia" value={formatCurrency(contractDetail.contract.deposit_amount)} />
                  <DetailTile label="Documento" value={contractDetail.contract.billing_document_type} />
                  <DetailTile label="Patentes" value={contractDetail.contract.plates || 'Sin patentes'} />
                </div>
                <p className="mt-3 text-sm text-slate-600">{contractDetail.contract.notes || 'Sin notas registradas.'}</p>
              </section>
            </div>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">Pagos</h4>
                <span className="text-xs font-bold text-slate-400">{contractDetail.payments.length} registros</span>
              </div>
              {contractDetail.payments.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-400">Sin pagos asociados.</p>
              ) : contractDetail.payments.map(payment => (
                <div key={payment.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 p-4">
                  <div>
                    <p className="text-sm font-bold text-slate-900">#PAG-{payment.id.toString().padStart(4, '0')} · {formatCurrency(payment.amount)}</p>
                    <p className="text-xs text-slate-500">Vence {payment.due_date} · Abonado {formatCurrency(payment.allocated_amount)}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-sm font-bold", Number(payment.remaining_amount || 0) > 0 ? "text-red-600" : "text-emerald-600")}>{formatCurrency(payment.remaining_amount)}</p>
                    <p className="text-[10px] font-bold uppercase text-slate-400">{payment.status}</p>
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">Documentos</h4>
                <span className="text-xs font-bold text-slate-400">{contractDetail.documents.length} archivos</span>
              </div>
              {contractDetail.documents.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-400">Sin documentos del contrato.</p>
              ) : contractDetail.documents.map(document => (
                <div key={document.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">{document.label}</p>
                    <p className="truncate text-xs text-slate-500">{document.document_type} · {document.file_name}</p>
                  </div>
                  <a
                    href={`/api/documents/${document.id}/download`}
                    className="rounded-lg p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-900"
                    aria-label={`Descargar ${document.label}`}
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              ))}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">Auditoria</h4>
                <span className="text-xs font-bold text-slate-400">{contractDetail.audit.length} eventos</span>
              </div>
              {contractDetail.audit.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-400">Sin auditoria disponible.</p>
              ) : contractDetail.audit.map(event => (
                <div key={event.id} className="rounded-2xl border border-slate-100 p-4">
                  <p className="text-sm font-bold text-slate-900">{event.action}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(event.created_at).toLocaleString()} · {event.staff_name || event.staff_email || 'Sistema'}
                  </p>
                </div>
              ))}
            </section>
          </div>
        )}
      </Drawer>

      <AnimatePresence>
        {editingContract && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={isUpdatingContract ? undefined : () => setEditingContract(null)} />
            <form onSubmit={handleUpdateContract} className="relative w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
              <div className="mb-5">
                <h3 className="text-lg font-bold text-slate-900">Editar terminos del contrato</h3>
                <p className="mt-1 text-sm text-slate-500">
                  #CON-2026-{editingContract.id.toString().padStart(3, '0')} - {editingContract.client_name} - {editingContract.space_name}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Fecha de inicio</label>
                  <input type="date" name="start_date" required defaultValue={editingContract.start_date} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Fecha termino</label>
                  <input type="date" name="end_date" defaultValue={editingContract.end_date || ''} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Tarifa mensual</label>
                  <input type="number" name="monthly_fee" required min="1" defaultValue={editingContract.monthly_fee} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Dia de cobro</label>
                  <input type="number" name="billing_day" required min="1" max="31" defaultValue={editingContract.billing_day} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Garantia / deposito</label>
                  <input type="number" name="deposit_amount" min="0" defaultValue={editingContract.deposit_amount || 0} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Documento de cobro</label>
                  <select name="billing_document_type" defaultValue={editingContract.billing_document_type} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white">
                    <option value="boleta">Boleta</option>
                    <option value="factura_exenta">Factura exenta</option>
                    <option value="factura_afecta">Factura afecta</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Notas</label>
                  <textarea name="notes" rows={3} defaultValue={editingContract.notes || ''} className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white" />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Motivo del cambio</label>
                  <textarea name="reason" rows={3} required minLength={3} className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white" placeholder="Ajuste solicitado por cliente, cambio comercial aprobado, correccion administrativa..." />
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button type="button" onClick={() => setEditingContract(null)} disabled={isUpdatingContract} className="flex-1 rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 disabled:opacity-50">
                  Cancelar
                </button>
                <button type="submit" disabled={isUpdatingContract} className="flex-1 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:opacity-50">
                  {isUpdatingContract ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {contractAction && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={isActionSubmitting ? undefined : closeActionDialog} />
            <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 space-y-5">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{actionLabels[contractAction.action].title}</h3>
                <p className="text-sm text-slate-500 mt-1">
                  #{contractAction.contract.id.toString().padStart(3, '0')} · {contractAction.contract.client_name} · {contractAction.contract.space_name}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Fecha efectiva</label>
                  <input
                    type="date"
                    value={actionDate}
                    onChange={(e) => setActionDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Motivo</label>
                  <textarea
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                    rows={4}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
                    placeholder="Ingrese el motivo operacional o administrativo..."
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeActionDialog}
                  disabled={isActionSubmitting}
                  className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleContractAction}
                  disabled={isActionSubmitting || actionReason.trim().length < 3}
                  className={cn(
                    "flex-1 py-3 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50",
                    contractAction.action === 'terminate' ? "bg-red-600 hover:bg-red-700" :
                      contractAction.action === 'reactivate' ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-600 hover:bg-amber-700"
                  )}
                >
                  {isActionSubmitting ? 'Procesando...' : actionLabels[contractAction.action].button}
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {renewingContract && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={isRenewing ? undefined : closeRenewDialog} />
            <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Renovar contrato</h3>
                <p className="mt-1 text-sm text-slate-500">
                  #CON-2026-{renewingContract.id.toString().padStart(3, '0')} · {renewingContract.client_name} · {renewingContract.space_name}
                </p>
              </div>

              <div className="mt-5 rounded-2xl bg-amber-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Vencimiento actual</p>
                <p className="mt-1 text-lg font-bold text-amber-950">{renewingContract.end_date || 'Sin fecha'}</p>
              </div>

              <div className="mt-5">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Nueva fecha de término</label>
                <input
                  type="date"
                  value={newEndDate}
                  min={renewingContract.end_date || undefined}
                  onChange={(event) => setNewEndDate(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white"
                />
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={closeRenewDialog}
                  disabled={isRenewing}
                  className="flex-1 rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleRenewContract}
                  disabled={isRenewing || !newEndDate || Boolean(renewingContract.end_date && newEndDate <= renewingContract.end_date)}
                  className="flex-1 rounded-xl bg-amber-600 py-3 text-sm font-bold text-white transition-all hover:bg-amber-700 disabled:opacity-50"
                >
                  {isRenewing ? 'Renovando...' : 'Confirmar renovación'}
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {contractUpload && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={isUploadingSigned ? undefined : closeUploadDialog} />
            <form onSubmit={handleSignedUpload} className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 space-y-5">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Adjuntar contrato firmado</h3>
                <p className="text-sm text-slate-500 mt-1">
                  #CON-2026-{contractUpload.id.toString().padStart(3, '0')} · {contractUpload.client_name} · {contractUpload.space_name}
                </p>
              </div>

              <label className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center hover:border-slate-400 transition-all cursor-pointer bg-slate-50/50">
                <UploadCloud className="w-10 h-10 text-slate-300 mb-3" />
                <span className="text-sm font-bold text-slate-900">{signedFileName || 'Seleccionar archivo firmado'}</span>
                <span className="text-xs text-slate-400 mt-1">PDF, JPG o PNG hasta 5MB</span>
                <input
                  type="file"
                  name="signed_contract"
                  accept="application/pdf,image/jpeg,image/png"
                  className="sr-only"
                  onChange={(event) => setSignedFileName(event.target.files?.[0]?.name || '')}
                />
              </label>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeUploadDialog}
                  disabled={isUploadingSigned}
                  className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isUploadingSigned || !signedFileName}
                  className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all disabled:opacity-50"
                >
                  {isUploadingSigned ? 'Subiendo...' : 'Guardar firmado'}
                </button>
              </div>
            </form>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const DetailTile = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 rounded-xl bg-slate-50 p-3 text-slate-900">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    <p className="mt-1 break-words text-sm font-bold">{value}</p>
  </div>
);

export default ContractsPage;
