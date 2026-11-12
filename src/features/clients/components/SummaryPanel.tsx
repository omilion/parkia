import { Clock, CreditCard, MapPin } from "lucide-react";

import { cn } from "../../../lib/utils";

const InfoTile = ({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) => (
  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 min-w-0">
    <div className="flex items-center gap-2 text-slate-600">
      <Icon className="w-4 h-4" />
      <p className="text-xs font-bold uppercase tracking-wider">{label}</p>
    </div>
    <p className="text-sm font-semibold text-slate-800 mt-2 break-words">
      {value}
    </p>
  </div>
);

import { useClientDetailViewContext } from "../hooks/useClientDetailController";
export default function SummaryPanel() {
  const { data } = useClientDetailViewContext();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-50 p-4 rounded-2xl">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
            Contratos Activos
          </p>
          <p className="text-xl font-bold">{data.summary.activeContracts}</p>
        </div>
        <div className="bg-slate-50 p-4 rounded-2xl">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
            Deuda Total
          </p>
          <p
            className={cn(
              "text-xl font-bold",
              data.summary.totalDebt > 0 ? "text-red-700" : "text-emerald-800",
            )}
          >
            ${Number(data.summary.totalDebt || 0).toLocaleString()}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-1">
            Pendiente
          </p>
          <p className="text-lg font-bold text-amber-700">
            ${Number(data.summary.pendingDebt || 0).toLocaleString()}
          </p>
        </div>
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl">
          <p className="text-xs font-bold text-red-700 uppercase tracking-wider mb-1">
            Vencido
          </p>
          <p className="text-lg font-bold text-red-700">
            ${Number(data.summary.overdueDebt || 0).toLocaleString()}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InfoTile
          icon={MapPin}
          label="Dirección"
          value={
            [data.client.address, data.client.commune, data.client.city]
              .filter(Boolean)
              .join(", ") || "Sin dirección"
          }
        />
        <InfoTile
          icon={CreditCard}
          label="Contacto facturación"
          value={
            data.client.billing_contact_name ||
            data.client.billing_contact_email ||
            "Sin contacto definido"
          }
        />
      </div>
      <div className="bg-slate-900 text-white p-6 rounded-2xl">
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm font-bold opacity-60">Último Acceso</p>
          <Clock className="w-4 h-4 opacity-60" />
        </div>
        <p className="text-lg font-bold">
          {data.access[0]
            ? new Date(data.access[0].timestamp).toLocaleString()
            : "Sin registros"}
        </p>
        <p className="text-xs opacity-60 mt-1">
          {data.access[0] ? `En ${data.access[0].space_name}` : ""}
        </p>
      </div>
    </div>
  );
}
