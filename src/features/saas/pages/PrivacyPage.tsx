import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { privacyTitularDeleteSchema, type PrivacyTitularDeleteInput } from "../../../../shared/schemas/privacy";
import { apiFetchJson } from "../../../lib/api";
import { useApiMutation } from "../../../lib/useApiMutation";

type ConsentRow = {
  id: number;
  subject_type: string;
  subject_identifier: string;
  purpose: string;
  policy_version: string;
  granted: number;
  created_at: string;
};

export default function PrivacyPage() {
  const [exportedData, setExportedData] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const consentsQuery = useQuery<{ consents: ConsentRow[] }>({
    queryKey: ["/api/privacy/consents"],
    queryFn: () => apiFetchJson<{ consents: ConsentRow[] }>("/api/privacy/consents"),
  });
  const deleteMutation = useApiMutation("PrivacyPage.tsx");

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<PrivacyTitularDeleteInput>({
    resolver: zodResolver(privacyTitularDeleteSchema),
    defaultValues: {
      rut: "",
      plate: "",
      email: "",
      reason: "Solicitud del titular (Ley 21.719)",
    },
  });

  async function handleExport() {
    setActionError(null);
    setActionMessage(null);
    const values = getValues();
    const params = new URLSearchParams();
    if (values.rut?.trim()) params.set("rut", values.rut.trim());
    if (values.plate?.trim()) params.set("plate", values.plate.trim());
    if (values.email?.trim()) params.set("email", values.email.trim());

    if (!params.toString()) {
      setActionError("Ingresa un RUT, patente o correo para exportar los datos del titular.");
      return;
    }

    const res = await fetch(`/api/privacy/titular/export?${params.toString()}`, {
      credentials: "include",
    });
    const payload = await res.json();
    if (!res.ok) {
      setActionError(payload?.error || "No se pudo exportar los datos del titular.");
      return;
    }
    setExportedData(JSON.stringify(payload, null, 2));
    setActionMessage("Exportación generada conforme a la Ley N° 21.719.");
  }

  const onAnonymize = handleSubmit(async (values) => {
    setActionError(null);
    setActionMessage(null);
    try {
      const data = await deleteMutation.json<{
        clients_anonymized: number;
        vehicles_anonymized: number;
        tickets_anonymized: number;
      }>("/api/privacy/titular/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(values.rut?.trim() ? { rut: values.rut.trim() } : {}),
          ...(values.plate?.trim() ? { plate: values.plate.trim() } : {}),
          ...(values.email?.trim() ? { email: values.email.trim() } : {}),
          reason: values.reason.trim(),
        }),
      });
      setActionMessage(
        `Anonimización completada: ${data.clients_anonymized} cliente(s), ${data.vehicles_anonymized} vehículo(s), ${data.tickets_anonymized} ticket(s). Documentos tributarios SII conservados.`,
      );
      await consentsQuery.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo ejecutar la anonimización.");
    }
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            Privacidad y Datos Personales (Ley 21.719)
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Atiende solicitudes ARCO+ de exportación o supresión/anonimización por titular conservando la trazabilidad tributaria SII.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {actionMessage}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Solicitud de titular (RUT, patente o correo)</h2>
        <form onSubmit={onAnonymize} className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="privacy-rut" className="block text-sm font-medium text-slate-700">
                RUT del titular
              </label>
              <input
                id="privacy-rut"
                type="text"
                placeholder="12.345.678-9"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                {...register("rut")}
              />
              {errors.rut && <p className="mt-1 text-xs text-red-600">{errors.rut.message}</p>}
            </div>
            <div>
              <label htmlFor="privacy-plate" className="block text-sm font-medium text-slate-700">
                Patente vehicular
              </label>
              <input
                id="privacy-plate"
                type="text"
                placeholder="ABCD12"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase"
                {...register("plate")}
              />
            </div>
            <div>
              <label htmlFor="privacy-email" className="block text-sm font-medium text-slate-700">
                Correo electrónico
              </label>
              <input
                id="privacy-email"
                type="email"
                placeholder="titular@ejemplo.cl"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                {...register("email")}
              />
              {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="privacy-reason" className="block text-sm font-medium text-slate-700">
              Motivo / respaldo de la solicitud
            </label>
            <input
              id="privacy-reason"
              type="text"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              {...register("reason")}
            />
            {errors.reason && <p className="mt-1 text-xs text-red-600">{errors.reason.message}</p>}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleExport()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Exportar datos (Portabilidad)
            </button>
            <button
              type="submit"
              disabled={deleteMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {deleteMutation.isPending ? "Anonimizando..." : "Anonimizar / suprimir datos"}
            </button>
          </div>
        </form>

        {exportedData && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-slate-700">Resultado de exportación (JSON)</h3>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
              {exportedData}
            </pre>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Registro de consentimientos</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-4">Tipo</th>
                <th className="py-2 pr-4">Titular</th>
                <th className="py-2 pr-4">Finalidad</th>
                <th className="py-2 pr-4">Versión política</th>
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(consentsQuery.data?.consents || []).map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-4 font-medium text-slate-700">{row.subject_type}</td>
                  <td className="py-2 pr-4 text-slate-600">{row.subject_identifier}</td>
                  <td className="py-2 pr-4 text-slate-600">{row.purpose}</td>
                  <td className="py-2 pr-4 text-slate-500">{row.policy_version}</td>
                  <td className="py-2 pr-4">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {row.granted ? "Otorgado" : "Revocado"}
                    </span>
                  </td>
                  <td className="py-2 text-slate-500">{row.created_at}</td>
                </tr>
              ))}
              {(!consentsQuery.data?.consents || consentsQuery.data.consents.length === 0) && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-500">
                    No hay consentimientos registrados aún.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

