import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CreditCard, Receipt } from "lucide-react";
import { oneclickEnrollSchema, type OneclickEnrollInput } from "../../../../shared/schemas/billing";
import { apiFetchJson } from "../../../lib/api";
import { useApiMutation } from "../../../lib/useApiMutation";

type BillingSummary = {
  subscription: {
    subscription_id: number;
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
    grace_until: string | null;
    plan_code: string;
    plan_name: string;
    price_clp: number;
    price_uf_centis: number;
  } | null;
  uf_rate: {
    rate_date: string;
    value_clp: number;
    source: string;
    usable: boolean;
  };
  estimated_amount_clp: number;
  next_charge: { date: string; estimated_amount_clp: number } | null;
  oneclick_available: boolean;
  oneclick_simulated: boolean;
  oneclick: {
    id: number;
    card_type: string;
    card_last4: string;
    email: string;
    activated_at: string;
  } | null;
  invoices: Array<{
    id: number;
    period_start: string | null;
    period_end: string | null;
    uf_date: string;
    uf_value_clp: number;
    amount_uf_centis: number;
    amount_clp: number;
    status: string;
    buy_order: string;
    authorization_code: string | null;
    dte_folio: number | null;
    dte_status: string | null;
    created_at: string;
  }>;
  platform_dte_configured: boolean;
};

export default function SubscriptionPage() {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const summaryQuery = useQuery<BillingSummary>({
    queryKey: ["/api/billing/subscription"],
    queryFn: () => apiFetchJson<BillingSummary>("/api/billing/subscription"),
  });

  const enrollMutation = useApiMutation("SubscriptionPage.tsx");

  const enrollForm = useForm<OneclickEnrollInput>({
    resolver: zodResolver(oneclickEnrollSchema),
    defaultValues: { email: "" },
  });

  const onEnrollOneclick = enrollForm.handleSubmit(async (values) => {
    setErrorMsg(null);
    setFeedback(null);
    try {
      const start = await enrollMutation.json<{ token: string; url_webpay: string }>(
        "/api/billing/oneclick/enroll",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values.email ? { email: values.email } : {}),
        },
      );
      const finished = await enrollMutation.json<{ approved: boolean; card_type: string; card_last4: string }>(
        "/api/billing/oneclick/finish",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: start.token }),
        },
      );
      if (finished.approved) {
        setFeedback(`Tarjeta ${finished.card_type} terminada en ${finished.card_last4} inscrita.`);
      }
      await summaryQuery.refetch();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo inscribir la tarjeta.");
    }
  });

  const data = summaryQuery.data;
  const sub = data?.subscription;
  const ufPlan = sub && sub.price_uf_centis > 0 ? (sub.price_uf_centis / 100).toFixed(2) : null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <CreditCard className="h-6 w-6 text-indigo-600" />
          Suscripción
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Tu plan, tu medio de pago y el historial de cobros. Parkia realiza el cobro automáticamente al terminar cada período.
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {errorMsg}
        </div>
      )}
      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {feedback}
        </div>
      )}

      {data && !data.oneclick_available && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          El pago con tarjeta aún no está habilitado. Coordina el pago de tu suscripción con Parkia.
        </div>
      )}
      {data && data.oneclick_available && data.oneclick_simulated && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          Ambiente de pruebas: la inscripción de tarjeta y los cobros son simulados.
        </div>
      )}

      {data && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase text-slate-500">Plan actual</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{sub?.plan_name || "Sin plan"}</div>
            <div className="mt-1 text-sm text-slate-600">
              Estado: <span className="font-semibold">{sub?.status || "-"}</span>
            </div>
            {sub?.current_period_end && (
              <div className="mt-1 text-xs text-slate-500">Vence: {sub.current_period_end}</div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase text-slate-500">Valor UF y monto mensual</div>
            <div className="mt-1 text-xl font-bold text-slate-900">
              {ufPlan ? `${ufPlan} UF` : `$${(sub?.price_clp || 0).toLocaleString("es-CL")}`}
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Equivalente hoy: <span className="font-semibold">${data.estimated_amount_clp.toLocaleString("es-CL")}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {data.uf_rate.usable
                ? `UF del ${data.uf_rate.rate_date}: $${data.uf_rate.value_clp.toLocaleString("es-CL")}`
                : "Monto referencial: el valor de la UF del día aún no está disponible."}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium uppercase text-slate-500">Medio de pago</div>
            {data.oneclick ? (
              <>
                <div className="mt-1 text-xl font-bold text-slate-900">
                  {data.oneclick.card_type} •••• {data.oneclick.card_last4}
                </div>
                <div className="mt-1 text-xs text-slate-500">{data.oneclick.email}</div>
              </>
            ) : (
              <div className="mt-1 text-sm text-amber-700">Sin tarjeta inscrita</div>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Inscribir o cambiar tarjeta</h2>
          <form onSubmit={onEnrollOneclick} className="mt-4 space-y-4">
            <div>
              <label htmlFor="oneclick-email" className="block text-sm font-medium text-slate-700">
                Correo para comprobantes (opcional)
              </label>
              <input
                id="oneclick-email"
                type="email"
                placeholder="finanzas@empresa.cl"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                {...enrollForm.register("email")}
              />
            </div>
            <button
              type="submit"
              disabled={enrollMutation.isPending || (data ? !data.oneclick_available : false)}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4" />
              {enrollMutation.isPending ? "Inscribiendo..." : "Inscribir tarjeta"}
            </button>
          </form>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <CalendarClock className="h-5 w-5 text-slate-600" aria-hidden="true" />
            Próximo cobro
          </h2>
          {data?.next_charge ? (
            <>
              <p className="mt-2 text-2xl font-bold text-slate-900">{data.next_charge.date}</p>
              <p className="mt-1 text-sm text-slate-600">
                Monto estimado: <span className="font-semibold">${data.next_charge.estimated_amount_clp.toLocaleString("es-CL")}</span>
                {ufPlan ? " (se calcula con la UF del día del cobro)" : ""}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-600">Aún no hay un cobro programado.</p>
          )}
          <p className="mt-3 text-sm text-slate-600">
            {data?.oneclick
              ? "Parkia cobrará automáticamente a tu tarjeta inscrita ese día. No necesitas hacer nada."
              : "Inscribe una tarjeta para que Parkia pueda cobrar automáticamente, o coordina el pago por transferencia con Parkia."}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Receipt className="h-5 w-5 text-slate-600" />
          Historial de cobros de suscripción
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-4">Orden</th>
                <th className="py-2 pr-4">Fecha UF</th>
                <th className="py-2 pr-4">UF</th>
                <th className="py-2 pr-4">Total CLP</th>
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2">DTE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.invoices || []).map((inv) => (
                <tr key={inv.id}>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-700">{inv.buy_order}</td>
                  <td className="py-2 pr-4 text-slate-600">{inv.uf_date}</td>
                  <td className="py-2 pr-4 text-slate-600">{(inv.amount_uf_centis / 100).toFixed(2)} UF</td>
                  <td className="py-2 pr-4 font-medium text-slate-900">${inv.amount_clp.toLocaleString("es-CL")}</td>
                  <td className="py-2 pr-4">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {inv.status}
                    </span>
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {inv.dte_folio ? `Folio ${inv.dte_folio}` : inv.dte_status || "-"}
                  </td>
                </tr>
              ))}
              {(!data?.invoices || data.invoices.length === 0) && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-500">
                    No hay cobros registrados aún.
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

