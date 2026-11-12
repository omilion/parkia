import { Archive, Building2, CreditCard, MapPin, Users } from "lucide-react";

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
import ClientEditForm from "./ClientEditForm";
export default function DataPanel() {
  const {
    data,
    isEditingClient,
    isSavingClient,
    archiveReason,
    setArchiveReason,
    handleClientStatus,
  } = useClientDetailViewContext();
  return (
    <div className="space-y-6">
      {isEditingClient ? (
        <ClientEditForm />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoTile
            icon={Building2}
            label="Tipo / Giro"
            value={`${data.client.type === "company" ? "Empresa" : "Persona Natural"}${data.client.business_activity ? ` · ${data.client.business_activity}` : ""}`}
          />
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
            icon={Users}
            label="Representante legal"
            value={
              [
                data.client.legal_representative_name,
                data.client.legal_representative_rut,
              ]
                .filter(Boolean)
                .join(" · ") || "Sin representante"
            }
          />
          <InfoTile
            icon={CreditCard}
            label="Facturación"
            value={
              [
                data.client.billing_contact_name,
                data.client.billing_contact_email,
                data.client.billing_contact_phone,
              ]
                .filter(Boolean)
                .join(" · ") || "Sin contacto"
            }
          />
          <div className="md:col-span-2 bg-slate-50 border border-slate-100 rounded-2xl p-4">
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Notas
            </p>
            <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">
              {data.client.notes || "Sin notas comerciales u operativas."}
            </p>
          </div>
        </div>
      )}

      {data.client.status !== "archived" && (
        <div className="border border-red-100 bg-red-50 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-red-800 flex items-center gap-2">
            <Archive className="w-4 h-4" /> Archivar cliente
          </p>
          <p className="text-xs text-red-700">
            Solo se permite si no tiene contratos activos o suspendidos.
          </p>
          <textarea
            aria-label="Motivo de archivo"
            value={archiveReason}
            onChange={(e) => setArchiveReason(e.target.value)}
            rows={2}
            placeholder="Motivo de archivo"
            className="w-full bg-white border border-red-100 rounded-xl px-3 py-2 text-xs outline-none resize-none"
          />
          <button
            onClick={() => handleClientStatus("archived")}
            disabled={isSavingClient || archiveReason.trim().length < 3}
            className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold disabled:opacity-50"
          >
            Archivar
          </button>
        </div>
      )}
    </div>
  );
}
