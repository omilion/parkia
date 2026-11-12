import { DataView } from "../../../ui/DataView";

import { AnimatePresence } from "motion/react";
import { Archive, Ban, CheckCircle2, Download, FileText, Printer, Search, UploadCloud, XCircle } from "lucide-react";
import { Contract } from "../../../types";

import PaginationControls from "../../../components/ui/PaginationControls";
import Toast from "../../../components/ui/Toast";

import { cn } from "../../../lib/utils";
const CONTRACT_PAGE_SIZE = 25;

import { lazy, Suspense } from "react";
import { useContractsController, ContractsPageContext } from "../hooks/useContractsController";
import { LoadingState } from "../../../ui/LoadingState";
const CreateContractSheet = lazy(
  () => import("../components/CreateContractSheet"),
);
const ContractDetailSheet = lazy(
  () => import("../components/ContractDetailSheet"),
);
const EditingContractDialog = lazy(
  () => import("../components/EditingContractDialog"),
);
const ContractActionDialog = lazy(
  () => import("../components/ContractActionDialog"),
);
const RenewingContractDialog = lazy(
  () => import("../components/RenewingContractDialog"),
);
const ContractUploadDialog = lazy(
  () => import("../components/ContractUploadDialog"),
);
const ContractsPage = () => {
  const controller = useContractsController();
  const {
    setIsDrawerOpen,
    toast,
    setToast,
    searchContract,
    setSearchContract,
    contractStatus,
    setContractStatus,
    contractPage,
    setContractPage,
    contractAction,
    setContractAction,
    showExpiringOnly,
    setShowExpiringOnly,
    selectedBranchId,
    setSelectedBranchId,
    renewingContract,
    setRenewingContract,
    contractUpload,
    setContractUpload,
    isGeneratingPdfId,
    editingContract,
    contractTotal,
    branches,
    isLoading,
    loadError,
    openContractDetail,
    isExpiringContract,
    filteredContracts,
    handleGeneratePdfDocument,
  } = controller;
  return (
    <ContractsPageContext.Provider value={controller}>
      <Suspense fallback={<LoadingState />}>
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
                Administrador de Contratos
              </h2>
              <p className="text-slate-600 mt-1">
                Gestiona arriendos, tarifas y vigencias.
              </p>
            </div>
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold shadow-lg shadow-slate-200 hover:bg-slate-800 transition-all flex items-center gap-2"
            >
              <FileText className="w-5 h-5" />
              Generar Nuevo Contrato
            </button>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="max-w-md bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                  <Search className="w-5 h-5 text-slate-600" />
                  <input
                    aria-label="Buscar por cliente, espacio o contrato..."
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
                  aria-label="Todos los estados"
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
                  aria-label="Todas las sucursales"
                  value={selectedBranchId}
                  onChange={(e) => {
                    setSelectedBranchId(e.target.value);
                    setContractPage(1);
                  }}
                  className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 outline-none transition-all hover:bg-slate-50"
                >
                  <option value="all">Todas las sucursales</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setShowExpiringOnly((value) => !value);
                    setContractPage(1);
                  }}
                  className={cn(
                    "w-fit rounded-xl px-4 py-2 text-xs font-bold transition-all",
                    showExpiringOnly
                      ? "bg-amber-100 text-amber-700"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {showExpiringOnly
                    ? "Mostrando próximos a vencer"
                    : "Filtrar próximos a vencer"}
                </button>
              </div>
            </div>
            {loadError && (
              <p role="alert" className="p-4 text-sm text-red-700">
                {loadError}
              </p>
            )}
            <DataView<Contract>
              caption="Contratos"
              className="md:[&_th]:px-3 md:[&_td]:px-3 xl:[&_th]:px-4 xl:[&_td]:px-4"
              items={loadError ? [] : filteredContracts}
              getKey={(contract) => contract.id}
              loading={isLoading}
              emptyMessage={loadError || "No hay contratos para mostrar."}
              columns={[
                {
                  key: "client",
                  label: "Cliente",
                  primary: true,
                  render: (contract) => (
                    <button
                      type="button"
                      onClick={() => openContractDetail(contract.id)}
                      className="min-h-11 text-left font-bold text-indigo-700 hover:underline"
                    >
                      {contract.client_name || `Contrato #${contract.id}`}
                    </button>
                  ),
                },
                {
                  key: "id",
                  label: "Contrato",
                  render: (contract) => `#${contract.id}`,
                },
                {
                  key: "space",
                  label: "Plaza",
                  render: (contract) => (
                    <span>
                      {contract.space_name}
                      {contract.branch_name && (
                        <span className="block text-xs text-slate-600">
                          {contract.branch_name}
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: "fee",
                  label: "Tarifa",
                  render: (contract) => (
                    <strong>
                      ${contract.monthly_fee.toLocaleString("es-CL")}
                    </strong>
                  ),
                },
                {
                  key: "status",
                  label: "Estado",
                  render: (contract) =>
                    contract.status === "active"
                      ? "Activo"
                      : contract.status === "terminated"
                        ? "Terminado"
                        : "Suspendido",
                },
                {
                  key: "dates",
                  label: "Vigencia",
                  render: (contract) => (
                    <span>
                      Desde{" "}
                      {new Date(contract.start_date).toLocaleDateString(
                        "es-CL",
                      )}
                      <span className="block">
                        {contract.end_date
                          ? `Hasta ${new Date(contract.end_date).toLocaleDateString("es-CL")}`
                          : "Indefinido"}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "actions",
                  label: "Acciones",
                  fullWidthOnMobile: true,
                  render: (contract) => (
                    <div className="flex flex-wrap justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openContractDetail(contract.id)}
                        className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Ver detalle
                      </button>
                      {isExpiringContract(contract) && (
                        <button
                          type="button"
                          onClick={() => setRenewingContract(contract)}
                          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-amber-800 hover:bg-amber-50"
                        >
                          Renovar
                        </button>
                      )}
                      <a
                        href={`/api/contracts/${contract.id}/print`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Imprimir contrato ${contract.id}`}
                        title="Imprimir contrato"
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                      >
                        <Printer className="h-5 w-5" aria-hidden="true" />
                      </a>
                      <a
                        href={`/api/contracts/${contract.id}/pdf`}
                        aria-label={`Descargar PDF del contrato ${contract.id}`}
                        title="Descargar PDF"
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                      >
                        <Download className="h-5 w-5" aria-hidden="true" />
                      </a>
                      <button
                        type="button"
                        onClick={() => handleGeneratePdfDocument(contract)}
                        disabled={isGeneratingPdfId === contract.id}
                        aria-label={`Generar y archivar PDF del contrato ${contract.id}`}
                        title="Generar y archivar PDF"
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                      >
                        <Archive className="h-5 w-5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setContractUpload(contract)}
                        aria-label={`Adjuntar contrato firmado ${contract.id}`}
                        title="Adjuntar contrato firmado"
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-blue-700 hover:bg-blue-50"
                      >
                        <UploadCloud className="h-5 w-5" aria-hidden="true" />
                      </button>
                      {contract.status === "active" && (
                        <button
                          type="button"
                          onClick={() =>
                            setContractAction({ contract, action: "suspend" })
                          }
                          aria-label={`Suspender contrato ${contract.id}`}
                          title="Suspender contrato"
                          className="flex h-11 w-11 items-center justify-center rounded-lg text-amber-800 hover:bg-amber-50"
                        >
                          <Ban className="h-5 w-5" aria-hidden="true" />
                        </button>
                      )}
                      {contract.status === "suspended" && (
                        <button
                          type="button"
                          onClick={() =>
                            setContractAction({
                              contract,
                              action: "reactivate",
                            })
                          }
                          aria-label={`Reactivar contrato ${contract.id}`}
                          title="Reactivar contrato"
                          className="flex h-11 w-11 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-50"
                        >
                          <CheckCircle2
                            className="h-5 w-5"
                            aria-hidden="true"
                          />
                        </button>
                      )}
                      {contract.status !== "terminated" && (
                        <button
                          type="button"
                          onClick={() =>
                            setContractAction({ contract, action: "terminate" })
                          }
                          aria-label={`Terminar contrato ${contract.id}`}
                          title="Terminar contrato"
                          className="flex h-11 w-11 items-center justify-center rounded-lg text-red-700 hover:bg-red-50"
                        >
                          <XCircle className="h-5 w-5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
            <PaginationControls
              page={contractPage}
              pageSize={CONTRACT_PAGE_SIZE}
              total={contractTotal}
              onPageChange={setContractPage}
            />
          </div>

          <CreateContractSheet />

          <ContractDetailSheet />

          <AnimatePresence>
            {editingContract && <EditingContractDialog />}
          </AnimatePresence>

          <AnimatePresence>
            {contractAction && <ContractActionDialog />}
          </AnimatePresence>

          <AnimatePresence>
            {renewingContract && <RenewingContractDialog />}
          </AnimatePresence>

          <AnimatePresence>
            {contractUpload && <ContractUploadDialog />}
          </AnimatePresence>
        </div>
      </Suspense>
    </ContractsPageContext.Provider>
  );
};
export default ContractsPage;
