import { cn } from "../../../lib/utils";

import { useClientDetailViewContext } from "../hooks/useClientDetailController";
export default function PaymentsPanel() {
  const { data } = useClientDetailViewContext();
  return (
    <div className="space-y-4">
      {data.payments.length === 0 ? (
        <p className="text-center py-10 text-slate-600 italic">
          Sin historial de pagos
        </p>
      ) : (
        data.payments.map((p: any) => (
          <div
            key={p.id}
            className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl"
          >
            <div>
              <p className="text-sm font-bold">${p.amount.toLocaleString()}</p>
              <p className="text-xs text-slate-600">
                Vence {p.due_date} ·{" "}
                {p.space_name || `Contrato #${p.contract_id}`}
              </p>
              <p className="text-xs text-slate-600">
                Abonado ${Number(p.allocated_amount || 0).toLocaleString()} ·
                Saldo ${Number(p.remaining_amount || 0).toLocaleString()}
              </p>
            </div>
            <span
              className={cn(
                "px-2 py-1 rounded-lg text-xs font-bold uppercase",
                p.status === "paid"
                  ? "bg-emerald-100 text-emerald-800"
                  : p.status === "overdue"
                    ? "bg-red-100 text-red-700"
                    : "bg-amber-100 text-amber-800",
              )}
            >
              {p.status === "paid"
                ? "Pagado"
                : p.status === "overdue"
                  ? "Vencido"
                  : "Pendiente"}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
