import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Car, CheckCircle2, CreditCard, FileText, LogOut, Mail, Receipt } from "lucide-react";
import { portalRequestLinkSchema, type PortalRequestLinkInput } from "../../../../shared/schemas/portal";
import { useApiMutation } from "../../../lib/useApiMutation";

type PortalData = {
  client: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
    rut: string | null;
    financial_status: string;
  } | null;
  contracts: Array<{
    id: number;
    start_date: string;
    end_date: string | null;
    monthly_fee: number;
    billing_day: number;
    status: string;
  }>;
  payments: Array<{
    id: number;
    contract_id: number;
    amount: number;
    due_date: string;
    payment_date: string | null;
    status: string;
    method: string | null;
    reference: string | null;
  }>;
  invoices: Array<{
    id: number;
    folio: number;
    type: string;
    amount: number;
    date: string;
    status_sii: string;
  }>;
  documents: Array<{
    id: number;
    label: string;
    document_type: string;
    status: string;
    file_name: string;
  }>;
  vehicles: Array<{
    id: number;
    plate: string;
    brand: string | null;
    model: string | null;
    color: string | null;
  }>;
};

export default function PortalPage() {
  const apiWrite = useApiMutation("PortalPage.tsx");
  const [portalData, setPortalData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const form = useForm<PortalRequestLinkInput>({
    resolver: zodResolver(portalRequestLinkSchema),
    defaultValues: { email: "" },
  });

  const loadPortalMe = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portal/me", { credentials: "include" });
      if (res.ok) {
        setPortalData((await res.json()) as PortalData);
      } else {
        setPortalData(null);
      }
    } catch {
      setPortalData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      void loadPortalMe();
      return;
    }

    void (async () => {
      try {
        const res = await apiWrite.request("/api/portal/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          window.history.replaceState({}, "", "/portal");
          await loadPortalMe();
        } else {
          setErrorMsg("El enlace mágico expiró o ya fue utilizado.");
          setLoading(false);
        }
      } catch {
        setErrorMsg("No se pudo validar el enlace mágico.");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRequestLink = async (values: PortalRequestLinkInput) => {
    setErrorMsg(null);
    setStatusMessage(null);
    const res = await apiWrite.request("/api/portal/auth/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(values),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) {
      setErrorMsg(data.message || "No pudimos enviar el enlace.");
      return;
    }
    setStatusMessage(data.message || "Revisa tu correo para ingresar.");
    form.reset();
  };

  const handlePayCuota = async (paymentId: number) => {
    setErrorMsg(null);
    const res = await apiWrite.request(`/api/portal/payments/${paymentId}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ method: "card" }),
    });
    if (!res.ok) {
      setErrorMsg("No se pudo registrar el pago de la cuota.");
      return;
    }
    setStatusMessage(`Cuota #${paymentId} pagada correctamente.`);
    await loadPortalMe();
  };

  const handleLogout = async () => {
    await apiWrite.request("/api/portal/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    setPortalData(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white text-sm font-semibold">
        Cargando portal de abonado...
      </div>
    );
  }

  if (!portalData?.client) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Portal del abonado</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Ingresa con enlace mágico</h1>
            <p className="mt-1 text-sm text-slate-600">
              Revisa tus cuotas, paga en línea y descarga tus boletas y documentos sin contraseña.
            </p>
          </div>

          {errorMsg && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {errorMsg}
            </div>
          )}
          {statusMessage && (
            <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {statusMessage}
            </div>
          )}

          <form onSubmit={form.handleSubmit(handleRequestLink)} className="space-y-4">
            <div>
              <label htmlFor="portal-email" className="block text-xs font-semibold text-slate-700 mb-1">
                Correo registrado
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  id="portal-email"
                  type="email"
                  placeholder="abonado@empresa.cl"
                  {...form.register("email")}
                  className="w-full min-h-11 rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                />
              </div>
              {form.formState.errors.email && (
                <p className="mt-1 text-xs text-rose-600">{form.formState.errors.email.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={form.formState.isSubmitting}
              className="w-full min-h-11 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-60"
            >
              Enviar enlace de acceso
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-950 text-white px-4 sm:px-8 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-300">Portal del Abonado</p>
            <h1 className="text-lg sm:text-xl font-bold">{portalData.client.name}</h1>
            <p className="text-xs text-slate-300">
              {portalData.client.rut || "Sin RUT"} · {portalData.client.email || ""}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            <LogOut className="w-4 h-4" />
            Salir
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 sm:p-8 space-y-6">
        {errorMsg && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {errorMsg}
          </div>
        )}
        {statusMessage && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {statusMessage}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">Cuotas y pagos</h2>
          </div>
          {portalData.payments.length === 0 ? (
            <p className="text-sm text-slate-500">No tienes cuotas registradas.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {portalData.payments.map(payment => {
                const payable = payment.status === "pending" || payment.status === "overdue";
                return (
                  <div key={payment.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        ${payment.amount.toLocaleString("es-CL")} CLP · Vence {payment.due_date}
                      </p>
                      <p className="text-xs text-slate-500">
                        Estado: {payment.status}
                        {payment.payment_date ? ` · Pagado el ${payment.payment_date}` : ""}
                      </p>
                    </div>
                    {payable ? (
                      <button
                        type="button"
                        onClick={() => void handlePayCuota(payment.id)}
                        className="min-h-9 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500"
                      >
                        Pagar cuota
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Pagada
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-900">Boletas y facturas</h2>
            </div>
            {portalData.invoices.length === 0 ? (
              <p className="text-sm text-slate-500">Sin documentos tributarios emitidos.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {portalData.invoices.map(inv => (
                  <li key={inv.id} className="py-2 flex items-center justify-between">
                    <span>
                      {inv.type} #{inv.folio}
                    </span>
                    <span className="font-semibold">${inv.amount.toLocaleString("es-CL")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Car className="w-4 h-4 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-900">Vehículos autorizados</h2>
            </div>
            {portalData.vehicles.length === 0 ? (
              <p className="text-sm text-slate-500">Sin vehículos activos.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {portalData.vehicles.map(v => (
                  <li key={v.id} className="py-2 flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900">{v.plate}</span>
                    <span className="text-slate-500">
                      {[v.brand, v.model, v.color].filter(Boolean).join(" ") || "Vehículo registrado"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">Documentos del abonado</h2>
          </div>
          {portalData.documents.length === 0 ? (
            <p className="text-sm text-slate-500">No hay documentos adjuntos.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {portalData.documents.map(doc => (
                <li key={doc.id} className="py-2 flex items-center justify-between">
                  <span>{doc.label}</span>
                  <span className="text-xs text-slate-500">{doc.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

