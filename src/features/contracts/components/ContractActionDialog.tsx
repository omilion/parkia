import { Dialog } from "../../../ui/Dialog";
import { cn } from "../../../lib/utils";

import { useContractsPageContext } from "../hooks/useContractsController";
export default function ContractActionDialog() {
  const {
    contractAction,
    actionReason,
    setActionReason,
    actionDate,
    setActionDate,
    isActionSubmitting,
    closeActionDialog,
    handleContractAction,
    actionLabels,
  } = useContractsPageContext();
  return (
    <Dialog
      open
      onClose={closeActionDialog}
      dismissible={!isActionSubmitting}
      title="Accion del contrato"
    >
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-bold text-slate-900">
            {actionLabels[contractAction.action].title}
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            #{contractAction.contract.id.toString().padStart(3, "0")} ·{" "}
            {contractAction.contract.client_name} ·{" "}
            {contractAction.contract.space_name}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Fecha efectiva
            </label>
            <input
              aria-label="Fecha efectiva"
              type="date"
              value={actionDate}
              onChange={(e) => setActionDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Motivo
            </label>
            <textarea
              aria-label="Motivo"
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
              contractAction.action === "terminate"
                ? "bg-red-600 hover:bg-red-700"
                : contractAction.action === "reactivate"
                  ? "bg-emerald-700 hover:bg-emerald-700"
                  : "bg-amber-600 hover:bg-amber-700",
            )}
          >
            {isActionSubmitting
              ? "Procesando..."
              : actionLabels[contractAction.action].button}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
