import { Dialog } from "../../../ui/Dialog";
import { useContractsPageContext } from "../hooks/useContractsController";
export default function RenewingContractDialog() {
  const {
    renewingContract,
    newEndDate,
    setNewEndDate,
    isRenewing,
    closeRenewDialog,
    handleRenewContract,
  } = useContractsPageContext();
  return (
    <Dialog
      open
      onClose={closeRenewDialog}
      dismissible={!isRenewing}
      title="Renovar contrato"
    >
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Renovar contrato</h3>
          <p className="mt-1 text-sm text-slate-600">
            #CON-2026-{renewingContract.id.toString().padStart(3, "0")} ·{" "}
            {renewingContract.client_name} · {renewingContract.space_name}
          </p>
        </div>

        <div className="mt-5 rounded-2xl bg-amber-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
            Vencimiento actual
          </p>
          <p className="mt-1 text-lg font-bold text-amber-950">
            {renewingContract.end_date || "Sin fecha"}
          </p>
        </div>

        <div className="mt-5">
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-600">
            Nueva fecha de término
          </label>
          <input
            aria-label="Nueva fecha de término"
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
            disabled={
              isRenewing ||
              !newEndDate ||
              Boolean(
                renewingContract.end_date &&
                  newEndDate <= renewingContract.end_date,
              )
            }
            className="flex-1 rounded-xl bg-amber-600 py-3 text-sm font-bold text-white transition-all hover:bg-amber-700 disabled:opacity-50"
          >
            {isRenewing ? "Renovando..." : "Confirmar renovación"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
