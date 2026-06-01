import React, { useEffect, useState } from 'react';
import { Archive, ArrowDownRight, ArrowUpRight, Building2, Car, ChevronRight, Clock, CreditCard, Download, Edit3, FileText, MapPin, Plus, Search, UploadCloud, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import type { Client, PaginatedResponse } from '../types';
import Drawer from '../components/ui/Drawer';
import PaginationControls from '../components/ui/PaginationControls';
import Toast from '../components/ui/Toast';
import { cn } from '../lib/utils';
import { validateRut } from '../lib/rut';

const CLIENT_PAGE_SIZE = 25;

const ClientsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [clientPage, setClientPage] = useState(1);
  const [clientTotal, setClientTotal] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const importInputRef = React.useRef<HTMLInputElement | null>(null);

  const fetchClients = async () => {
    const params = new URLSearchParams({
      page: String(clientPage),
      pageSize: String(CLIENT_PAGE_SIZE),
    });
    if (includeArchived) params.set('includeArchived', 'true');
    if (searchTerm.trim()) params.set('search', searchTerm.trim());
    if (filterType !== 'all') params.set('type', filterType);
    if (filterStatus !== 'all') params.set('status', filterStatus);

    const res = await fetch(`/api/clients?${params.toString()}`);
    const data = await res.json() as PaginatedResponse<Client>;
    setClients(data.items || []);
    setClientTotal(Number(data.total || 0));
  };

  useEffect(() => {
    fetchClients().catch(() => {
      setClients([]);
      setClientTotal(0);
    });
  }, [includeArchived, searchTerm, filterType, filterStatus, clientPage]);

  useEffect(() => {
    const requestedClientId = Number(searchParams.get('id') || 0);
    setSelectedClientId(Number.isFinite(requestedClientId) && requestedClientId > 0 ? requestedClientId : null);
  }, [searchParams]);

  const openClientDetail = (clientId: number) => {
    setSelectedClientId(clientId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('id', String(clientId));
      return next;
    });
  };

  const closeClientDetail = () => {
    setSelectedClientId(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('id');
      return next;
    }, { replace: true });
  };

  const filteredClients = clients;

  const handleCreateClient = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    if (!validateRut(data.rut.toString())) {
      setToast({ message: 'RUT inválido. Verifique el formato y dígito verificador.', type: 'error' });
      return;
    }

    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setToast({ message: `Cliente ${data.name} creado exitosamente`, type: 'success' });
      setIsDrawerOpen(false);
      fetchClients();
    } else {
      const err = await res.json();
      setToast({ message: err.error || 'Error al crear cliente', type: 'error' });
    }
  };

  const handleImportClients = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setToast({ message: 'Seleccione un archivo CSV.', type: 'error' });
      return;
    }

    setIsImporting(true);
    try {
      const csvText = await file.text();
      const res = await fetch('/api/clients/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'No se pudo importar clientes');

      const skippedText = result.skipped > 0 ? `, ${result.skipped} omitidos` : '';
      setToast({ message: `${result.imported} clientes importados${skippedText}`, type: result.skipped > 0 ? 'error' : 'success' });
      fetchClients();
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo importar clientes', type: 'error' });
    } finally {
      setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const downloadClientTemplate = async () => {
    try {
      const res = await fetch('/api/import/templates/clients.csv');
      if (!res.ok) throw new Error('No se pudo descargar la plantilla');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'clients.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo descargar la plantilla', type: 'error' });
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Directorio de Clientes</h2>
          <p className="text-slate-500 mt-1">Gestiona personas naturales y empresas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => handleImportClients(e.target.files?.[0])}
          />
          <button
            onClick={downloadClientTemplate}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4 text-slate-400" />
            Plantilla CSV
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={isImporting}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <UploadCloud className="w-4 h-4 text-slate-400" />
            {isImporting ? 'Importando...' : 'Carga Masiva (.csv)'}
          </button>
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center gap-2"
          >
            <Users className="w-5 h-5" />
            Nuevo Cliente
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex-1 min-w-[300px] bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3 focus-within:border-slate-400 transition-colors">
          <Search className="w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por RUT, Nombre o Email..."
            className="bg-transparent border-none outline-none text-sm w-full"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setClientPage(1);
            }}
          />
        </div>
        <select
          className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none"
          value={filterType}
          onChange={(e) => {
            setFilterType(e.target.value);
            setClientPage(1);
          }}
        >
          <option value="all">Todos los tipos</option>
          <option value="natural">Persona Natural</option>
          <option value="company">Empresa</option>
        </select>
        <select
          className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none"
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value);
            setClientPage(1);
          }}
        >
          <option value="all">Todos los estados</option>
          <option value="active">Con contrato activo</option>
          <option value="inactive">Sin contrato</option>
          <option value="overdue">Deudores</option>
          <option value="archived">Archivados</option>
        </select>
        <label className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold text-slate-600">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => {
              setIncludeArchived(event.target.checked);
              setClientPage(1);
            }}
            className="rounded border-slate-300"
          />
          Ver archivados
        </label>
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">RUT</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Nombre / Razón Social</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Contacto</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Productos</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Deuda / Estado</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredClients.map(client => (
              <tr
                key={client.id}
                className={cn("hover:bg-slate-50/50 transition-colors group cursor-pointer", client.status === 'archived' && "opacity-60")}
                onClick={() => openClientDetail(client.id)}
              >
                <td className="px-6 py-4 text-sm font-mono text-slate-500">
                  <p>{client.rut}</p>
                  {client.plates && <p className="text-[10px] bg-slate-100 flex items-center justify-center rounded-sm w-fit px-1 leading-none h-4 mt-1 border-[0.5px] border-slate-300 uppercase">{client.plates.split(',')[0]}</p>}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold",
                      client.type === 'company' ? "bg-indigo-100 text-indigo-600" : "bg-blue-100 text-blue-600"
                    )}>
                      {client.type === 'company' ? 'E' : 'P'}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{client.name}</p>
                      {client.status === 'archived' && <p className="text-[10px] font-bold text-slate-400 uppercase">Archivado</p>}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <p className="text-xs font-medium text-slate-900">{client.phone}</p>
                  <p className="text-xs text-slate-500">{client.email}</p>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {client.products ? Array.from(new Set(client.products.split(',').map(p => p.trim()).filter(Boolean))).map(p => (
                      <span key={p} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold uppercase tracking-wider">
                        {p}
                      </span>
                    )) : <span className="text-xs text-slate-300 italic">Sin productos</span>}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <p className={cn("text-sm font-black", Number(client.total_debt || 0) > 0 ? "text-red-600" : "text-emerald-600")}>
                    ${Number(client.total_debt || 0).toLocaleString()}
                  </p>
                  <p className="text-[10px] font-bold uppercase text-slate-400">
                    {Number(client.total_debt || 0) > 0 ? 'Con saldo' : 'Al dia'}
                  </p>
                </td>
                <td className="px-6 py-4 text-right">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      openClientDetail(client.id);
                    }}
                    title="Ver ficha del cliente"
                    aria-label={`Ver ficha de ${client.name}`}
                    className="text-slate-400 hover:text-slate-900 p-2 rounded-lg hover:bg-white transition-all shadow-sm"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationControls
        page={clientPage}
        pageSize={CLIENT_PAGE_SIZE}
        total={clientTotal}
        onPageChange={setClientPage}
      />

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Registrar Nuevo Cliente"
      >
        <form onSubmit={handleCreateClient} className="space-y-6">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tipo de Cliente</label>
              <div className="grid grid-cols-2 gap-4">
                <label className="relative flex items-center justify-center p-4 border-2 border-slate-100 rounded-2xl cursor-pointer hover:border-slate-200 transition-all has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white">
                  <input type="radio" name="type" value="natural" defaultChecked className="sr-only" />
                  <span className="text-sm font-bold">Persona Natural</span>
                </label>
                <label className="relative flex items-center justify-center p-4 border-2 border-slate-100 rounded-2xl cursor-pointer hover:border-slate-200 transition-all has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white">
                  <input type="radio" name="type" value="company" className="sr-only" />
                  <span className="text-sm font-bold">Empresa</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nombre Completo / Razón Social</label>
                <input name="name" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" placeholder="Ej: Juan Pérez o Hazlo Mejor SpA" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">RUT</label>
                <input name="rut" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" placeholder="12.345.678-9" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Teléfono</label>
                <input name="phone" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" placeholder="+569..." />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Correo Electrónico</label>
                <input name="email" type="email" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" placeholder="ejemplo@correo.com" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Patente (Opcional)</label>
                <input name="plate" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" placeholder="ABCD-12" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Dirección</label>
                <input name="address" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" placeholder="Av. Principal 123" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Comuna</label>
                <input name="commune" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Ciudad</label>
                <input name="city" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Giro / Actividad</label>
                <input name="business_activity" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" placeholder="Obligatorio para empresas" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Representante</label>
                <input name="legal_representative_name" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">RUT Rep.</label>
                <input name="legal_representative_rut" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Contacto Facturación</label>
                <input name="billing_contact_name" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Email Fact.</label>
                <input name="billing_contact_email" type="email" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tel. Fact.</label>
                <input name="billing_contact_phone" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Notas</label>
                <textarea name="notes" rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none" />
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100 flex gap-4">
            <button type="button" onClick={() => setIsDrawerOpen(false)} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
            <button type="submit" className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all">Guardar Cliente</button>
          </div>
        </form>
      </Drawer>

      <ClientDetailView
        clientId={selectedClientId}
        onClose={closeClientDetail}
        onChanged={fetchClients}
      />
    </div>
  );
};

const ClientDetailView = ({ clientId, onClose, onChanged }: { clientId: number | null, onClose: () => void, onChanged: () => void }) => {
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [documentLabel, setDocumentLabel] = useState('');
  const [documentType, setDocumentType] = useState('other');
  const [documentStatus, setDocumentStatus] = useState('received');
  const [documentExpiresAt, setDocumentExpiresAt] = useState('');
  const [documentNotes, setDocumentNotes] = useState('');
  const [documentStatusFilter, setDocumentStatusFilter] = useState('all');
  const [selectedDocumentName, setSelectedDocumentName] = useState('');
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [isEditingClient, setIsEditingClient] = useState(false);
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [clientActionError, setClientActionError] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [isSavingVehicle, setIsSavingVehicle] = useState(false);
  const [expandedContractId, setExpandedContractId] = useState<number | null>(null);

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
    reader.onerror = () => reject(new Error('No se pudo leer el documento'));
    reader.readAsDataURL(file);
  });

  const fetchClientDetail = () => {
    if (!clientId) return;
    fetch(`/api/clients/${clientId}`).then(res => res.json()).then(setData);
  };

  useEffect(() => {
    if (clientId) {
      fetchClientDetail();
      setActiveTab('summary');
      setIsEditingClient(false);
      setClientActionError('');
      setArchiveReason('');
      setExpandedContractId(null);
    } else {
      setData(null);
    }
  }, [clientId]);

  const handleUploadDocument = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!clientId) return;

    const formData = new FormData(e.currentTarget);
    const file = formData.get('document');
    if (!(file instanceof File) || file.size === 0) {
      setDocumentError('Seleccione un archivo.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setDocumentError('El archivo no puede superar 5MB.');
      return;
    }

    setIsUploadingDocument(true);
    setDocumentError('');
    try {
      const payload = await fileToPayload(file);
      const res = await fetch(`/api/documents/client/${clientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: documentLabel,
          document_type: documentType,
          status: documentStatus,
          expires_at: documentExpiresAt,
          notes: documentNotes,
          ...payload,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'No se pudo guardar el documento');
      }
      setDocumentLabel('');
      setDocumentType('other');
      setDocumentStatus('received');
      setDocumentExpiresAt('');
      setDocumentNotes('');
      setSelectedDocumentName('');
      e.currentTarget.reset();
      fetchClientDetail();
    } catch (error: any) {
      setDocumentError(error.message || 'No se pudo guardar el documento');
    } finally {
      setIsUploadingDocument(false);
    }
  };

  const updateDocumentStatus = async (documentId: number, status: string) => {
    setDocumentError('');
    const payload: Record<string, string> = { status };
    if (status === 'rejected') {
      const reason = window.prompt('Motivo de observación del documento');
      if (!reason?.trim()) {
        setDocumentError('Observar un documento requiere motivo.');
        return;
      }
      payload.rejection_reason = reason;
      payload.notes = reason;
    }
    const res = await fetch(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      fetchClientDetail();
      return;
    }
    const err = await res.json();
    setDocumentError(err.error || 'No se pudo actualizar el documento');
  };

  const handleUpdateClient = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!clientId) return;
    const formData = new FormData(e.currentTarget);
    const payload = Object.fromEntries(formData.entries());

    if (payload.rut && !validateRut(String(payload.rut))) {
      setClientActionError('RUT inválido. Verifique el formato y dígito verificador.');
      return;
    }

    setIsSavingClient(true);
    setClientActionError('');
    const res = await fetch(`/api/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setIsEditingClient(false);
      fetchClientDetail();
      onChanged();
    } else {
      const err = await res.json();
      setClientActionError(err.error || 'No se pudo actualizar el cliente');
    }
    setIsSavingClient(false);
  };

  const handleClientStatus = async (status: 'active' | 'archived') => {
    if (!clientId) return;
    setIsSavingClient(true);
    setClientActionError('');
    const res = await fetch(`/api/clients/${clientId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reason: archiveReason || (status === 'active' ? 'Reactivación administrativa' : '') }),
    });
    if (res.ok) {
      setArchiveReason('');
      fetchClientDetail();
      onChanged();
    } else {
      const err = await res.json();
      setClientActionError(err.error || 'No se pudo cambiar el estado del cliente');
    }
    setIsSavingClient(false);
  };

  const handleCreateVehicle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!clientId) return;
    const formData = new FormData(e.currentTarget);
    setIsSavingVehicle(true);
    setClientActionError('');
    const res = await fetch(`/api/clients/${clientId}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(formData.entries())),
    });
    if (res.ok) {
      e.currentTarget.reset();
      fetchClientDetail();
      onChanged();
    } else {
      const err = await res.json();
      setClientActionError(err.error || 'No se pudo agregar el vehículo');
    }
    setIsSavingVehicle(false);
  };

  const handleDeleteVehicle = async (vehicleId: number, plate: string) => {
    if (!clientId) return;
    const reason = window.prompt(`Motivo para dar de baja el vehiculo ${plate}`);
    if (!reason?.trim()) {
      setClientActionError('La baja de un vehiculo requiere motivo.');
      return;
    }
    setClientActionError('');
    const res = await fetch(`/api/clients/${clientId}/vehicles/${vehicleId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (res.ok) {
      fetchClientDetail();
      onChanged();
    } else {
      const err = await res.json();
      setClientActionError(err.error || 'No se pudo dar de baja el vehículo');
    }
  };

  const documents = data?.documents ?? [];
  const filteredDocuments = documents.filter((document: any) =>
    documentStatusFilter === 'all' || document.status === documentStatusFilter
  );
  const pendingDocuments = documents.filter((document: any) => document.status === 'pending' || document.status === 'rejected').length;
  const expiredDocuments = documents.filter((document: any) =>
    document.status === 'expired' || (document.expires_at && new Date(document.expires_at) < new Date())
  ).length;

  const documentStatusLabel: Record<string, string> = {
    pending: 'Pendiente',
    received: 'Recibido',
    approved: 'Aprobado',
    rejected: 'Observado',
    expired: 'Vencido',
  };

  const documentTypeLabel: Record<string, string> = {
    contract: 'Contrato',
    identity: 'Identidad',
    mandate: 'Mandato',
    receipt: 'Comprobante',
    other: 'Otro',
  };

  if (!clientId) return null;

  return (
    <Drawer isOpen={!!clientId} onClose={onClose} title="Ficha Integral del Cliente">
      {!data ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="space-y-8">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center text-3xl font-bold text-slate-400">
              {data.client.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-2xl font-bold">{data.client.name}</h4>
              <p className="text-slate-500 font-mono text-sm">{data.client.rut}</p>
              <div className="flex gap-2 mt-2">
                <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                  {data.client.type === 'company' ? 'Empresa' : 'Persona Natural'}
                </span>
                <span className={cn(
                  "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                  data.summary.totalDebt === 0 ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                )}>
                  {data.summary.totalDebt === 0 ? 'Al día' : 'Con deuda'}
                </span>
                {data.client.status === 'archived' && (
                  <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                    Archivado
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => setIsEditingClient(!isEditingClient)} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 inline-flex items-center gap-2">
                <Edit3 className="w-3.5 h-3.5" />
                {isEditingClient ? 'Cerrar edición' : 'Editar'}
              </button>
              {data.client.status === 'archived' ? (
                <button onClick={() => handleClientStatus('active')} disabled={isSavingClient} className="px-3 py-2 rounded-xl border border-emerald-200 text-xs font-bold text-emerald-700 hover:bg-emerald-50">
                  Reactivar
                </button>
              ) : null}
            </div>
          </div>

          {clientActionError && <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{clientActionError}</p>}

          <div className="flex border-b border-slate-100 gap-6 overflow-x-auto" role="tablist" aria-label="Ficha del cliente">
            {[
              { id: 'summary', label: 'Resumen' },
              { id: 'data', label: 'Datos' },
              { id: 'vehicles', label: 'Vehículos' },
              { id: 'contracts', label: 'Contratos' },
              { id: 'payments', label: 'Pagos' },
              { id: 'documents', label: 'Documentos' },
              { id: 'access', label: 'Accesos' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={cn(
                  "pb-4 text-sm font-bold transition-all relative whitespace-nowrap",
                  activeTab === tab.id ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
                )}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
                )}
              </button>
            ))}
          </div>

          <div className="min-h-[400px]">
            {activeTab === 'summary' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-4 rounded-2xl">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Contratos Activos</p>
                    <p className="text-xl font-bold">{data.summary.activeContracts}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Deuda Total</p>
                    <p className={cn("text-xl font-bold", data.summary.totalDebt > 0 ? "text-red-600" : "text-emerald-600")}>
                      ${Number(data.summary.totalDebt || 0).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl">
                    <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">Pendiente</p>
                    <p className="text-lg font-bold text-amber-700">${Number(data.summary.pendingDebt || 0).toLocaleString()}</p>
                  </div>
                  <div className="bg-red-50 border border-red-100 p-4 rounded-2xl">
                    <p className="text-xs font-bold text-red-600 uppercase tracking-wider mb-1">Vencido</p>
                    <p className="text-lg font-bold text-red-700">${Number(data.summary.overdueDebt || 0).toLocaleString()}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <InfoTile icon={MapPin} label="Dirección" value={[data.client.address, data.client.commune, data.client.city].filter(Boolean).join(', ') || 'Sin dirección'} />
                  <InfoTile icon={CreditCard} label="Contacto facturación" value={data.client.billing_contact_name || data.client.billing_contact_email || 'Sin contacto definido'} />
                </div>
                <div className="bg-slate-900 text-white p-6 rounded-2xl">
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-sm font-bold opacity-60">Último Acceso</p>
                    <Clock className="w-4 h-4 opacity-60" />
                  </div>
                  <p className="text-lg font-bold">
                    {data.access[0] ? new Date(data.access[0].timestamp).toLocaleString() : 'Sin registros'}
                  </p>
                  <p className="text-xs opacity-60 mt-1">
                    {data.access[0] ? `En ${data.access[0].space_name}` : ''}
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'data' && (
              <div className="space-y-6">
                {isEditingClient ? (
                  <form onSubmit={handleUpdateClient} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <TextField name="name" label="Nombre / Razón Social" defaultValue={data.client.name} required className="col-span-2" />
                      <TextField name="rut" label="RUT" defaultValue={data.client.rut} required />
                      <label>
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tipo</span>
                        <select name="type" defaultValue={data.client.type} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                          <option value="natural">Persona Natural</option>
                          <option value="company">Empresa</option>
                        </select>
                      </label>
                      <TextField name="phone" label="Teléfono" defaultValue={data.client.phone || ''} />
                      <TextField name="email" label="Correo" type="email" defaultValue={data.client.email || ''} />
                      <TextField name="address" label="Dirección" defaultValue={data.client.address || ''} className="col-span-2" />
                      <TextField name="commune" label="Comuna" defaultValue={data.client.commune || ''} />
                      <TextField name="city" label="Ciudad" defaultValue={data.client.city || ''} />
                      <TextField name="business_activity" label="Giro / Actividad" defaultValue={data.client.business_activity || ''} className="col-span-2" />
                      <TextField name="legal_representative_name" label="Representante legal" defaultValue={data.client.legal_representative_name || ''} />
                      <TextField name="legal_representative_rut" label="RUT representante" defaultValue={data.client.legal_representative_rut || ''} />
                      <TextField name="billing_contact_name" label="Contacto facturación" defaultValue={data.client.billing_contact_name || ''} className="col-span-2" />
                      <TextField name="billing_contact_email" label="Email facturación" type="email" defaultValue={data.client.billing_contact_email || ''} />
                      <TextField name="billing_contact_phone" label="Teléfono facturación" defaultValue={data.client.billing_contact_phone || ''} />
                      <label className="col-span-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Notas</span>
                        <textarea name="notes" defaultValue={data.client.notes || ''} rows={4} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none resize-none" />
                      </label>
                    </div>
                    <button type="submit" disabled={isSavingClient} className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-50">
                      {isSavingClient ? 'Guardando...' : 'Guardar datos del cliente'}
                    </button>
                  </form>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoTile icon={Building2} label="Tipo / Giro" value={`${data.client.type === 'company' ? 'Empresa' : 'Persona Natural'}${data.client.business_activity ? ` · ${data.client.business_activity}` : ''}`} />
                    <InfoTile icon={MapPin} label="Dirección" value={[data.client.address, data.client.commune, data.client.city].filter(Boolean).join(', ') || 'Sin dirección'} />
                    <InfoTile icon={Users} label="Representante legal" value={[data.client.legal_representative_name, data.client.legal_representative_rut].filter(Boolean).join(' · ') || 'Sin representante'} />
                    <InfoTile icon={CreditCard} label="Facturación" value={[data.client.billing_contact_name, data.client.billing_contact_email, data.client.billing_contact_phone].filter(Boolean).join(' · ') || 'Sin contacto'} />
                    <div className="md:col-span-2 bg-slate-50 border border-slate-100 rounded-2xl p-4">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Notas</p>
                      <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{data.client.notes || 'Sin notas comerciales u operativas.'}</p>
                    </div>
                  </div>
                )}

                {data.client.status !== 'archived' && (
                  <div className="border border-red-100 bg-red-50 rounded-2xl p-4 space-y-3">
                    <p className="text-sm font-bold text-red-800 flex items-center gap-2"><Archive className="w-4 h-4" /> Archivar cliente</p>
                    <p className="text-xs text-red-700">Solo se permite si no tiene contratos activos o suspendidos.</p>
                    <textarea value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} rows={2} placeholder="Motivo de archivo" className="w-full bg-white border border-red-100 rounded-xl px-3 py-2 text-xs outline-none resize-none" />
                    <button onClick={() => handleClientStatus('archived')} disabled={isSavingClient || archiveReason.trim().length < 3} className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold disabled:opacity-50">
                      Archivar
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'vehicles' && (
              <div className="space-y-5">
                <form onSubmit={handleCreateVehicle} className="border border-slate-100 rounded-2xl p-4 space-y-4">
                  <p className="text-sm font-bold flex items-center gap-2"><Car className="w-4 h-4 text-slate-400" /> Agregar vehículo</p>
                  <div className="grid grid-cols-2 gap-3">
                    <TextField name="plate" label="Patente" required />
                    <TextField name="brand" label="Marca" />
                    <TextField name="model" label="Modelo" />
                    <TextField name="color" label="Color" />
                    <TextField name="notes" label="Notas" className="col-span-2" />
                  </div>
                  <button type="submit" disabled={isSavingVehicle} className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-50">
                    <Plus className="w-4 h-4 inline mr-2" />
                    {isSavingVehicle ? 'Guardando...' : 'Agregar vehículo'}
                  </button>
                </form>
                <div className="space-y-3">
                  {(data.vehicles || []).length === 0 ? (
                    <p className="text-center py-8 text-slate-400 italic">Sin vehículos registrados</p>
                  ) : (
                    data.vehicles.map((vehicle: any) => (
                      <div key={vehicle.id} className="flex items-center justify-between border border-slate-100 rounded-2xl p-4">
                        <div>
                          <p className="text-sm font-black uppercase tracking-wider">{vehicle.plate}</p>
                          <p className="text-xs text-slate-500">{[vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(' · ') || 'Sin detalle'}</p>
                          {vehicle.notes && <p className="text-xs text-slate-400 mt-1">{vehicle.notes}</p>}
                        </div>
                        <button onClick={() => handleDeleteVehicle(vehicle.id, vehicle.plate)} className="p-2 text-red-500 hover:bg-red-50 rounded-xl" title="Dar de baja vehículo" aria-label={`Dar de baja vehículo ${vehicle.plate}`}>
                          <Archive className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === 'contracts' && (
              <div className="space-y-4">
                {data.contracts.map((c: any) => (
                  <div key={c.id} className="border border-slate-100 p-4 rounded-2xl hover:border-slate-200 transition-all">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-sm font-bold">{c.space_name}</p>
                        <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">
                          {c.space_type}
                          {c.plates && <span className="ml-2 font-mono bg-slate-100 px-1 py-0.5 rounded border-[0.5px] border-slate-200">{c.plates}</span>}
                        </p>
                      </div>
                      <span className={cn(
                        "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                        c.status === 'active' ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"
                      )}>
                        {c.status}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-xs text-slate-400 font-medium">Tarifa</p>
                        <p className="text-sm font-bold">${c.monthly_fee.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className={cn("text-sm font-bold", Number(c.pending_amount || 0) > 0 ? "text-red-600" : "text-emerald-600")}>${Number(c.pending_amount || 0).toLocaleString()}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Saldo</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setExpandedContractId(expandedContractId === c.id ? null : c.id)} className="text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-2 rounded-xl">
                          {expandedContractId === c.id ? 'Ocultar ficha' : 'Ver ficha'}
                        </button>
                        <a href={`/api/contracts/${c.id}/pdf`} className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-xl">PDF</a>
                      </div>
                    </div>
                    {expandedContractId === c.id && (
                      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                        <InfoValue label="Inicio" value={c.start_date} />
                        <InfoValue label="Término" value={c.end_date || 'Indefinido'} />
                        <InfoValue label="Día cobro" value={String(c.billing_day)} />
                        <InfoValue label="Garantía" value={`$${Number(c.deposit_amount || 0).toLocaleString()}`} />
                        <InfoValue label="Documento" value={c.billing_document_type} />
                        <InfoValue label="Docs adjuntos" value={String(c.documents_count || 0)} />
                        <div className="col-span-2">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Notas</p>
                          <p className="text-sm text-slate-600 mt-1">{c.notes || 'Sin notas registradas.'}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'payments' && (
              <div className="space-y-4">
                {data.payments.length === 0 ? (
                  <p className="text-center py-10 text-slate-400 italic">Sin historial de pagos</p>
                ) : (
                  data.payments.map((p: any) => (
                    <div key={p.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl">
                      <div>
                        <p className="text-sm font-bold">${p.amount.toLocaleString()}</p>
                        <p className="text-xs text-slate-500">
                          Vence {p.due_date} · {p.space_name || `Contrato #${p.contract_id}`}
                        </p>
                        <p className="text-xs text-slate-400">
                          Abonado ${Number(p.allocated_amount || 0).toLocaleString()} · Saldo ${Number(p.remaining_amount || 0).toLocaleString()}
                        </p>
                      </div>
                      <span className={cn(
                        "px-2 py-1 rounded-lg text-[10px] font-bold uppercase",
                        p.status === 'paid' ? "bg-emerald-100 text-emerald-600" : p.status === 'overdue' ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
                      )}>
                        {p.status === 'paid' ? 'Pagado' : p.status === 'overdue' ? 'Vencido' : 'Pendiente'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="space-y-6">
                <form onSubmit={handleUploadDocument} className="space-y-4 border border-slate-100 rounded-2xl p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nombre del Documento</label>
                      <input
                        value={documentLabel}
                        onChange={(e) => setDocumentLabel(e.target.value)}
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
                        placeholder="Contrato firmado, cédula, mandato..."
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tipo</label>
                      <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                        <option value="contract">Contrato</option>
                        <option value="identity">Identidad</option>
                        <option value="mandate">Mandato</option>
                        <option value="receipt">Comprobante</option>
                        <option value="other">Otro</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Estado</label>
                      <select value={documentStatus} onChange={(e) => setDocumentStatus(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                        <option value="pending">Pendiente</option>
                        <option value="received">Recibido</option>
                        <option value="approved">Aprobado</option>
                        <option value="rejected">Observado</option>
                        <option value="expired">Vencido</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Vencimiento</label>
                      <input
                        type="date"
                        value={documentExpiresAt}
                        onChange={(e) => setDocumentExpiresAt(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Notas de Seguimiento</label>
                      <textarea
                        value={documentNotes}
                        onChange={(e) => setDocumentNotes(e.target.value)}
                        rows={2}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
                        placeholder="Qué falta, quién debe corregirlo o comentario de revisión..."
                      />
                    </div>
                  </div>
                  <label className="border-2 border-dashed border-slate-200 rounded-2xl p-5 flex items-center justify-between gap-4 hover:border-slate-400 transition-all cursor-pointer bg-slate-50/50">
                    <div className="flex items-center gap-3 min-w-0">
                      <UploadCloud className="w-8 h-8 text-slate-300 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{selectedDocumentName || 'Seleccionar archivo'}</p>
                        <p className="text-xs text-slate-400">PDF, JPG o PNG hasta 5MB</p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-slate-500">Examinar</span>
                    <input
                      type="file"
                      name="document"
                      accept="application/pdf,image/jpeg,image/png"
                      className="sr-only"
                      onChange={(event) => setSelectedDocumentName(event.target.files?.[0]?.name || '')}
                    />
                  </label>
                  {documentError && <p className="text-xs font-medium text-red-600">{documentError}</p>}
                  <button
                    type="submit"
                    disabled={isUploadingDocument}
                    className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all disabled:opacity-50"
                  >
                    {isUploadingDocument ? 'Subiendo...' : 'Guardar Documento'}
                  </button>
                </form>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                    <p className="text-xs font-bold text-amber-600 uppercase tracking-wider">Pendientes / Observados</p>
                    <p className="text-2xl font-bold text-amber-700 mt-1">{pendingDocuments}</p>
                  </div>
                  <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
                    <p className="text-xs font-bold text-red-600 uppercase tracking-wider">Vencidos</p>
                    <p className="text-2xl font-bold text-red-700 mt-1">{expiredDocuments}</p>
                  </div>
                </div>

                <select
                  value={documentStatusFilter}
                  onChange={(e) => setDocumentStatusFilter(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none"
                >
                  <option value="all">Todos los documentos</option>
                  <option value="pending">Pendientes</option>
                  <option value="received">Recibidos</option>
                  <option value="approved">Aprobados</option>
                  <option value="rejected">Observados</option>
                  <option value="expired">Vencidos</option>
                </select>

                <div className="space-y-3">
                  {filteredDocuments.length === 0 ? (
                    <p className="text-center py-10 text-slate-400 italic">Sin documentos cargados</p>
                  ) : (
                    filteredDocuments.map((document: any) => (
                      <div key={document.id} className="flex items-center justify-between p-4 border border-slate-100 rounded-2xl">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-500 shrink-0">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-bold truncate">{document.label}</p>
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                                document.status === 'approved' ? "bg-emerald-100 text-emerald-600" :
                                  document.status === 'rejected' || document.status === 'expired' ? "bg-red-100 text-red-600" :
                                    document.status === 'pending' ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-600"
                              )}>
                                {documentStatusLabel[document.status] || document.status}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 truncate">
                              {documentTypeLabel[document.document_type] || 'Otro'} · {document.file_name}
                            </p>
                            {document.expires_at && (
                              <p className="text-xs text-slate-400">Vence: {new Date(document.expires_at).toLocaleDateString()}</p>
                            )}
                            {document.notes && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{document.notes}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <select
                            value={document.status}
                            onChange={(e) => updateDocumentStatus(document.id, e.target.value)}
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
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === 'access' && (
              <div className="space-y-4">
                {data.access.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between p-4 border-b border-slate-50">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center",
                        a.access_type === 'entry' ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"
                      )}>
                        {a.access_type === 'entry' ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-bold">{a.space_name}</p>
                        <p className="text-xs text-slate-500">{new Date(a.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                    <p className="text-xs font-bold uppercase text-slate-400">{a.access_type === 'entry' ? 'Entrada' : 'Salida'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
};

const TextField = ({
  name,
  label,
  defaultValue = '',
  type = 'text',
  required = false,
  className = '',
}: {
  name: string,
  label: string,
  defaultValue?: string,
  type?: string,
  required?: boolean,
  className?: string,
}) => (
  <label className={className}>
    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">{label}</span>
    <input
      name={name}
      type={type}
      required={required}
      defaultValue={defaultValue}
      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
    />
  </label>
);

const InfoTile = ({ icon: Icon, label, value }: { icon: any, label: string, value: string }) => (
  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 min-w-0">
    <div className="flex items-center gap-2 text-slate-400">
      <Icon className="w-4 h-4" />
      <p className="text-xs font-bold uppercase tracking-wider">{label}</p>
    </div>
    <p className="text-sm font-semibold text-slate-800 mt-2 break-words">{value}</p>
  </div>
);

const InfoValue = ({ label, value }: { label: string, value: string }) => (
  <div className="bg-slate-50 rounded-xl p-3">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
    <p className="text-sm font-bold text-slate-800 mt-1">{value}</p>
  </div>
);

export default ClientsPage;

