import ClientCreateForm from "../components/ClientCreateForm";
import ClientDetailView from "../components/ClientDetailView";
import { useApiMutation } from "../../../lib/useApiMutation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetchJson } from "../../../lib/api";
import { DataView } from "../../../ui/DataView";
import { FilterBar } from "../../../ui/FilterBar";
import React, { useEffect, useState } from "react";
import { ChevronRight, Download, Search, UploadCloud, Users } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useSearchParams } from "react-router-dom";
import type { Client, PaginatedResponse } from "../../../types";
import Drawer from "../../../components/ui/Drawer";
import PaginationControls from "../../../components/ui/PaginationControls";
import Toast from "../../../components/ui/Toast";

const CLIENT_PAGE_SIZE = 25;

const ClientsPage = () => {
  const apiWrite = useApiMutation("features/clients/pages");
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [clientPage, setClientPage] = useState(1);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const importInputRef = React.useRef<HTMLInputElement | null>(null);

  const queryClient = useQueryClient();
  const params = new URLSearchParams({
    page: String(clientPage),
    pageSize: String(CLIENT_PAGE_SIZE),
  });
  if (includeArchived) params.set("includeArchived", "true");
  if (searchTerm.trim()) params.set("search", searchTerm.trim());
  if (filterType !== "all") params.set("type", filterType);
  if (filterStatus !== "all") params.set("status", filterStatus);
  const clientsQuery = useQuery({
    queryKey: ["clients", params.toString()],
    queryFn: ({ signal }) =>
      apiFetchJson<PaginatedResponse<Client>>(`/api/clients?${params}`, {
        signal,
      }),
  });
  const clients = clientsQuery.data?.items ?? [];
  const clientTotal = clientsQuery.data?.total ?? 0;
  const fetchClients = () =>
    queryClient.invalidateQueries({ queryKey: ["clients"] });

  useEffect(() => {
    const requestedClientId = Number(searchParams.get("id") || 0);
    setSelectedClientId(
      Number.isFinite(requestedClientId) && requestedClientId > 0
        ? requestedClientId
        : null,
    );
  }, [searchParams]);

  const openClientDetail = (clientId: number) => {
    setSelectedClientId(clientId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("id", String(clientId));
      return next;
    });
  };

  const closeClientDetail = () => {
    setSelectedClientId(null);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("id");
        return next;
      },
      { replace: true },
    );
  };

  const filteredClients = clients;

  const handleImportClients = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setToast({ message: "Seleccione un archivo CSV.", type: "error" });
      return;
    }

    setIsImporting(true);
    try {
      const csvText = await file.text();
      const res = await apiWrite.request("/api/clients/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const result = await res.json();
      if (!res.ok)
        throw new Error(result.error || "No se pudo importar clientes");

      const skippedText =
        result.skipped > 0 ? `, ${result.skipped} omitidos` : "";
      setToast({
        message: `${result.imported} clientes importados${skippedText}`,
        type: result.skipped > 0 ? "error" : "success",
      });
      fetchClients();
    } catch (error: any) {
      setToast({
        message: error.message || "No se pudo importar clientes",
        type: "error",
      });
    } finally {
      setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const downloadClientTemplate = async () => {
    try {
      const res = await fetch("/api/import/templates/clients.csv");
      if (!res.ok) throw new Error("No se pudo descargar la plantilla");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "clients.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error: any) {
      setToast({
        message: error.message || "No se pudo descargar la plantilla",
        type: "error",
      });
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <AnimatePresence>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Directorio de Clientes
          </h2>
          <p className="text-slate-600 mt-1">
            Gestiona personas naturales y empresas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Importar clientes desde CSV"
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
            <Download className="w-4 h-4 text-slate-600" />
            Plantilla CSV
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={isImporting}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <UploadCloud className="w-4 h-4 text-slate-600" />
            {isImporting ? "Importando..." : "Carga Masiva (.csv)"}
          </button>
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="px-6 py-3 bg-emerald-700 text-white rounded-2xl font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center gap-2"
          >
            <Users className="w-5 h-5" />
            Nuevo Cliente
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex-1 min-w-[300px] bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3 focus-within:border-slate-400 transition-colors">
          <Search className="w-5 h-5 text-slate-600" />
          <input
            type="text"
            aria-label="Buscar clientes"
            placeholder="Buscar por RUT, Nombre o Email..."
            className="bg-transparent border-none outline-none text-sm w-full"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setClientPage(1);
            }}
          />
        </div>
        <FilterBar
          activeCount={
            Number(filterType !== "all") +
            Number(filterStatus !== "all") +
            Number(includeArchived)
          }
          onClear={() => {
            setFilterType("all");
            setFilterStatus("all");
            setIncludeArchived(false);
            setClientPage(1);
          }}
        >
          <select
            aria-label="Tipo de cliente"
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
            aria-label="Estado del cliente"
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
        </FilterBar>
      </div>

      <DataView<Client>
        loading={clientsQuery.isPending}
        caption="Clientes"
        items={filteredClients}
        getKey={(client) => client.id}
        emptyMessage={
          clientsQuery.error?.message ||
          "No hay clientes para los filtros seleccionados"
        }
        columns={[
          {
            key: "name",
            label: "Nombre / Razon Social",
            primary: true,
            render: (client) => (
              <button
                type="button"
                onClick={() => openClientDetail(client.id)}
                className="min-h-11 text-left font-bold text-indigo-700 hover:underline"
              >
                {client.name}
              </button>
            ),
          },
          {
            key: "rut",
            label: "RUT",
            render: (client) => <span className="font-mono">{client.rut}</span>,
          },
          {
            key: "contact",
            label: "Contacto",
            render: (client) => (
              <span className="break-all">
                {client.phone}
                <span className="block">{client.email}</span>
              </span>
            ),
          },
          {
            key: "products",
            label: "Productos",
            render: (client) => client.products || "Sin productos",
          },
          {
            key: "debt",
            label: "Deuda / Estado",
            render: (client) => (
              <span
                className={
                  Number(client.total_debt || 0) > 0
                    ? "font-bold text-red-700"
                    : "font-bold text-emerald-700"
                }
              >
                ${Number(client.total_debt || 0).toLocaleString("es-CL")} -{" "}
                {client.status === "archived"
                  ? "Archivado"
                  : Number(client.total_debt || 0) > 0
                    ? "Con saldo"
                    : "Al dia"}
              </span>
            ),
          },
          {
            key: "view",
            label: "Ficha",
            hideOnMobile: true,
            render: (client) => (
              <button
                type="button"
                onClick={() => openClientDetail(client.id)}
                aria-label={`Ver ficha de ${client.name}`}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            ),
          },
        ]}
      />
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
        <ClientCreateForm
          onCancel={() => setIsDrawerOpen(false)}
          onCreated={(name) => {
            setIsDrawerOpen(false);
            setToast({
              message: `Cliente ${name} creado exitosamente`,
              type: "success",
            });
          }}
        />
      </Drawer>

      <ClientDetailView
        clientId={selectedClientId}
        onClose={closeClientDetail}
        onChanged={fetchClients}
      />
    </div>
  );
};

export default ClientsPage;
