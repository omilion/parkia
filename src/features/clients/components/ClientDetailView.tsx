import { Tabs } from "../../../ui/Tabs";
import { Edit3 } from "lucide-react";

import Drawer from "../../../components/ui/Drawer";

import { cn } from "../../../lib/utils";

import { lazy, Suspense } from "react";
import { useClientDetailController, ClientDetailViewContext } from "../hooks/useClientDetailController";
import { LoadingState } from "../../../ui/LoadingState";
const SummaryPanel = lazy(() => import("../components/SummaryPanel"));
const DataPanel = lazy(() => import("../components/DataPanel"));
const VehiclesPanel = lazy(() => import("../components/VehiclesPanel"));
const ContractsPanel = lazy(() => import("../components/ContractsPanel"));
const PaymentsPanel = lazy(() => import("../components/PaymentsPanel"));
const DocumentsPanel = lazy(() => import("../components/DocumentsPanel"));
const AccessPanel = lazy(() => import("../components/AccessPanel"));
const ClientDetailView = ({
  clientId,
  onClose,
  onChanged,
}: {
  clientId: number | null;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const controller = useClientDetailController({
    clientId,
    onClose,
    onChanged,
  });
  const {
    data,
    detailQuery,
    fetchClientDetail,
    activeTab,
    setActiveTab,
    isEditingClient,
    setIsEditingClient,
    isSavingClient,
    clientActionError,
    handleClientStatus,
  } = controller;
  if (!clientId) return null;
  return (
    <ClientDetailViewContext.Provider value={controller}>
      <Suspense fallback={<LoadingState />}>
        <Drawer
          isOpen={!!clientId}
          onClose={onClose}
          title="Ficha Integral del Cliente"
        >
          {!data ? (
            detailQuery.error ? (
              <div role="alert" className="space-y-3 p-4 text-red-800">
                <p>{detailQuery.error.message}</p>
                <button
                  type="button"
                  onClick={fetchClientDetail}
                  className="min-h-11 px-4"
                >
                  Reintentar
                </button>
              </div>
            ) : (
              <LoadingState />
            )
          ) : (
            <div className="space-y-8">
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center text-3xl font-bold text-slate-600">
                  {data.client.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-2xl font-bold">{data.client.name}</h4>
                  <p className="text-slate-600 font-mono text-sm">
                    {data.client.rut}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold uppercase tracking-wider">
                      {data.client.type === "company"
                        ? "Empresa"
                        : "Persona Natural"}
                    </span>
                    <span
                      className={cn(
                        "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                        data.summary.totalDebt === 0
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-red-100 text-red-700",
                      )}
                    >
                      {data.summary.totalDebt === 0 ? "Al día" : "Con deuda"}
                    </span>
                    {data.client.status === "archived" && (
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold uppercase tracking-wider">
                        Archivado
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setIsEditingClient(!isEditingClient)}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 inline-flex items-center gap-2"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    {isEditingClient ? "Cerrar edición" : "Editar"}
                  </button>
                  {data.client.status === "archived" ? (
                    <button
                      onClick={() => handleClientStatus("active")}
                      disabled={isSavingClient}
                      className="px-3 py-2 rounded-xl border border-emerald-200 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                    >
                      Reactivar
                    </button>
                  ) : null}
                </div>
              </div>

              {clientActionError && (
                <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                  {clientActionError}
                </p>
              )}

              <Tabs
                label="Ficha del cliente"
                value={activeTab}
                onValueChange={setActiveTab}
                items={[
                  { value: "summary", label: "Resumen" },
                  { value: "data", label: "Datos" },
                  { value: "vehicles", label: "Vehículos" },
                  { value: "contracts", label: "Contratos" },
                  { value: "payments", label: "Pagos" },
                  { value: "documents", label: "Documentos" },
                  { value: "access", label: "Accesos" },
                ]}
              />

              <div className="min-h-[400px]">
                {activeTab === "summary" && <SummaryPanel />}

                {activeTab === "data" && <DataPanel />}

                {activeTab === "vehicles" && <VehiclesPanel />}

                {activeTab === "contracts" && <ContractsPanel />}

                {activeTab === "payments" && <PaymentsPanel />}

                {activeTab === "documents" && <DocumentsPanel />}

                {activeTab === "access" && <AccessPanel />}
              </div>
            </div>
          )}
        </Drawer>
      </Suspense>
    </ClientDetailViewContext.Provider>
  );
};
export default ClientDetailView;
