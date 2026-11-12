import { cn } from "../../../lib/utils";

const InfoValue = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-slate-50 rounded-xl p-3">
    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
      {label}
    </p>
    <p className="text-sm font-bold text-slate-800 mt-1">{value}</p>
  </div>
);
import { useClientDetailViewContext } from "../hooks/useClientDetailController";
export default function ContractsPanel() {
  const { data, expandedContractId, setExpandedContractId } =
    useClientDetailViewContext();
  return (
    <div className="space-y-4">
      {data.contracts.map((c: any) => (
        <div
          key={c.id}
          className="border border-slate-100 p-4 rounded-2xl hover:border-slate-200 transition-all"
        >
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-bold">{c.space_name}</p>
              <p className="text-xs text-slate-600 uppercase tracking-wider font-bold">
                Estacionamiento
                {c.plates && (
                  <span className="ml-2 font-mono bg-slate-100 px-1 py-0.5 rounded border-[0.5px] border-slate-200">
                    {c.plates}
                  </span>
                )}
              </p>
            </div>
            <span
              className={cn(
                "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                c.status === "active"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-600",
              )}
            >
              {c.status}
            </span>
          </div>
          <div className="flex justify-between items-end">
            <div>
              <p className="text-xs text-slate-600 font-medium">Tarifa</p>
              <p className="text-sm font-bold">
                ${c.monthly_fee.toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <p
                className={cn(
                  "text-sm font-bold",
                  Number(c.pending_amount || 0) > 0
                    ? "text-red-700"
                    : "text-emerald-800",
                )}
              >
                ${Number(c.pending_amount || 0).toLocaleString()}
              </p>
              <p className="text-xs text-slate-600 uppercase font-bold">
                Saldo
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  setExpandedContractId(
                    expandedContractId === c.id ? null : c.id,
                  )
                }
                className="text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-2 rounded-xl"
              >
                {expandedContractId === c.id ? "Ocultar ficha" : "Ver ficha"}
              </button>
              <a
                href={`/api/contracts/${c.id}/pdf`}
                className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-xl"
              >
                PDF
              </a>
            </div>
          </div>
          {expandedContractId === c.id && (
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
              <InfoValue label="Inicio" value={c.start_date} />
              <InfoValue label="Término" value={c.end_date || "Indefinido"} />
              <InfoValue label="Día cobro" value={String(c.billing_day)} />
              <InfoValue
                label="Garantía"
                value={`$${Number(c.deposit_amount || 0).toLocaleString()}`}
              />
              <InfoValue label="Documento" value={c.billing_document_type} />
              <InfoValue
                label="Docs adjuntos"
                value={String(c.documents_count || 0)}
              />
              <div className="col-span-2">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Notas
                </p>
                <p className="text-sm text-slate-600 mt-1">
                  {c.notes || "Sin notas registradas."}
                </p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
