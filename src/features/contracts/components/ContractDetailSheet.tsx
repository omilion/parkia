import { Link } from "react-router-dom";

import { Download } from "lucide-react";

import Drawer from "../../../components/ui/Drawer";

import { cn } from "../../../lib/utils";

const formatCurrency = (value: number | null | undefined) =>
  `$${Number(value || 0).toLocaleString()}`;
const DetailTile = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 rounded-xl bg-slate-50 p-3 text-slate-900">
    <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
      {label}
    </p>
    <p className="mt-1 break-words text-sm font-bold">{value}</p>
  </div>
);
import { useContractsPageContext } from "../hooks/useContractsController";
export default function ContractDetailSheet() {
  const {
    selectedContractId,
    contractDetail,
    isDetailLoading,
    detailError,
    setEditingContract,
    closeContractDetail,
  } = useContractsPageContext();
  return (
    <Drawer
      isOpen={Boolean(selectedContractId)}
      onClose={closeContractDetail}
      title="Detalle del Contrato"
    >
      {isDetailLoading && (
        <p className="py-10 text-center text-sm text-slate-600">
          Cargando detalle...
        </p>
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
                <p className="text-xs font-bold uppercase tracking-wider opacity-60">
                  #CON-2026-
                  {contractDetail.contract.id.toString().padStart(3, "0")}
                </p>
                <h3 className="mt-1 text-xl font-bold">
                  {contractDetail.contract.client_name}
                </h3>
                <p className="mt-1 text-sm opacity-70">
                  {contractDetail.contract.space_name} · Estacionamiento
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span
                  className={cn(
                    "rounded-lg px-2 py-1 text-xs font-bold uppercase tracking-wider",
                    contractDetail.contract.status === "active"
                      ? "bg-emerald-400/20 text-emerald-100"
                      : contractDetail.contract.status === "terminated"
                        ? "bg-white/10 text-slate-200"
                        : "bg-amber-400/20 text-amber-100",
                  )}
                >
                  {contractDetail.contract.status === "active"
                    ? "Activo"
                    : contractDetail.contract.status === "terminated"
                      ? "Terminado"
                      : "Suspendido"}
                </span>
                {contractDetail.contract.status !== "terminated" && (
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
              <DetailTile
                label="Tarifa"
                value={formatCurrency(contractDetail.contract.monthly_fee)}
              />
              <DetailTile
                label="Saldo pendiente"
                value={formatCurrency(
                  contractDetail.payments.reduce(
                    (sum, payment) =>
                      sum + Number(payment.remaining_amount || 0),
                    0,
                  ),
                )}
              />
              <DetailTile
                label="Inicio"
                value={contractDetail.contract.start_date}
              />
              <DetailTile
                label="Termino"
                value={contractDetail.contract.end_date || "Indefinido"}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <section className="rounded-2xl border border-slate-100 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-sm font-bold uppercase tracking-wider text-slate-600">
                  Cliente
                </h4>
                <Link
                  to={`/clients?id=${contractDetail.contract.client_id}`}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200"
                >
                  Abrir ficha
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <DetailTile
                  label="RUT"
                  value={contractDetail.contract.client_rut || "Sin RUT"}
                />
                <DetailTile
                  label="Tipo"
                  value={contractDetail.contract.client_type || "Sin tipo"}
                />
                <DetailTile
                  label="Email"
                  value={contractDetail.contract.client_email || "Sin email"}
                />
                <DetailTile
                  label="Telefono"
                  value={contractDetail.contract.client_phone || "Sin telefono"}
                />
              </div>
              <p className="mt-3 text-sm text-slate-600">
                {contractDetail.contract.client_address ||
                  "Sin direccion registrada."}
              </p>
            </section>

            <section className="rounded-2xl border border-slate-100 p-4">
              <h4 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-600">
                Espacio y condiciones
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <DetailTile
                  label="Espacio"
                  value={contractDetail.contract.space_name || "Sin espacio"}
                />
                <DetailTile
                  label="Sucursal"
                  value={contractDetail.contract.branch_name || "Sin sucursal"}
                />
                <DetailTile
                  label="Precio base"
                  value={formatCurrency(contractDetail.contract.space_price)}
                />
                <DetailTile
                  label="Dia cobro"
                  value={String(contractDetail.contract.billing_day)}
                />
                <DetailTile
                  label="Garantia"
                  value={formatCurrency(contractDetail.contract.deposit_amount)}
                />
                <DetailTile
                  label="Documento"
                  value={contractDetail.contract.billing_document_type}
                />
                <DetailTile
                  label="Patentes"
                  value={contractDetail.contract.plates || "Sin patentes"}
                />
              </div>
              <p className="mt-3 text-sm text-slate-600">
                {contractDetail.contract.notes || "Sin notas registradas."}
              </p>
            </section>
          </div>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-600">
                Pagos
              </h4>
              <span className="text-xs font-bold text-slate-600">
                {contractDetail.payments.length} registros
              </span>
            </div>
            {contractDetail.payments.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-600">
                Sin pagos asociados.
              </p>
            ) : (
              contractDetail.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 p-4"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      #PAG-{payment.id.toString().padStart(4, "0")} ·{" "}
                      {formatCurrency(payment.amount)}
                    </p>
                    <p className="text-xs text-slate-600">
                      Vence {payment.due_date} · Abonado{" "}
                      {formatCurrency(payment.allocated_amount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={cn(
                        "text-sm font-bold",
                        Number(payment.remaining_amount || 0) > 0
                          ? "text-red-700"
                          : "text-emerald-800",
                      )}
                    >
                      {formatCurrency(payment.remaining_amount)}
                    </p>
                    <p className="text-xs font-bold uppercase text-slate-600">
                      {payment.status}
                    </p>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-600">
                Documentos
              </h4>
              <span className="text-xs font-bold text-slate-600">
                {contractDetail.documents.length} archivos
              </span>
            </div>
            {contractDetail.documents.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-600">
                Sin documentos del contrato.
              </p>
            ) : (
              contractDetail.documents.map((document) => (
                <div
                  key={document.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {document.label}
                    </p>
                    <p className="truncate text-xs text-slate-600">
                      {document.document_type} · {document.file_name}
                    </p>
                  </div>
                  <a
                    href={`/api/documents/${document.id}/download`}
                    className="rounded-lg p-2 text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900"
                    aria-label={`Descargar ${document.label}`}
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              ))
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-600">
                Auditoria
              </h4>
              <span className="text-xs font-bold text-slate-600">
                {contractDetail.audit.length} eventos
              </span>
            </div>
            {contractDetail.audit.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-600">
                Sin auditoria disponible.
              </p>
            ) : (
              contractDetail.audit.map((event) => (
                <div
                  key={event.id}
                  className="rounded-2xl border border-slate-100 p-4"
                >
                  <p className="text-sm font-bold text-slate-900">
                    {event.action}
                  </p>
                  <p className="text-xs text-slate-600">
                    {new Date(event.created_at).toLocaleString()} ·{" "}
                    {event.staff_name || event.staff_email || "Sistema"}
                  </p>
                </div>
              ))
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
