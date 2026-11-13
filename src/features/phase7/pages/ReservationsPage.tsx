import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Plus, XCircle } from "lucide-react";
import { reservationCreateSchema } from "../../../../shared/schemas/phase7";
import { apiFetchJson } from "../../../lib/api";
import { useApiMutation } from "../../../lib/useApiMutation";

type ReservationRow = {
  id: number;
  plate: string;
  visitor_name: string | null;
  space_code: string | null;
  starts_at: string;
  ends_at: string;
  status: "confirmed" | "checked_in" | "cancelled" | "completed";
  qr_token: string;
};

export default function ReservationsPage() {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const apiWrite = useApiMutation("ReservationsPage.tsx");

  const reservationsQuery = useQuery<{ reservations: ReservationRow[] }>({
    queryKey: ["/api/reservations"],
    queryFn: () => apiFetchJson<{ reservations: ReservationRow[] }>("/api/reservations"),
  });

  const form = useForm({
    resolver: zodResolver(reservationCreateSchema),
    defaultValues: {
      plate: "",
      visitor_name: "",
      starts_at: "",
      ends_at: "",
      notes: "",
    },
  });

  const handleCreate = async (values: Record<string, unknown>) => {
    setErrorMsg(null);
    setFeedback(null);
    const res = await apiWrite.request("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(values),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string; reservation?: ReservationRow };
    if (!res.ok) {
      setErrorMsg(data.message || "No se pudo crear la reserva.");
      return;
    }
    setFeedback(`Reserva ${data.reservation?.qr_token || ""} creada correctamente.`);
    form.reset();
    await reservationsQuery.refetch();
  };

  const handleAction = async (id: number, action: "check-in" | "cancel") => {
    setErrorMsg(null);
    const res = await apiWrite.request(`/api/reservations/${id}/${action}`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      setErrorMsg(err.message || "No se pudo actualizar la reserva.");
      return;
    }
    await reservationsQuery.refetch();
  };

  const rows = reservationsQuery.data?.reservations ?? [];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
          <CalendarClock className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Reservas de estacionamiento</h1>
          <p className="text-sm text-slate-500">Agenda anticipada de plazas con código QR y control de superposición.</p>
        </div>
      </div>

      {errorMsg && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {errorMsg}
        </div>
      )}
      {feedback && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {feedback}
        </div>
      )}

      <form
        onSubmit={form.handleSubmit(handleCreate)}
        className="rounded-2xl border border-slate-200 bg-white p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5 items-end"
      >
        <div>
          <label htmlFor="res-plate" className="block text-xs font-semibold text-slate-700 mb-1">
            Patente
          </label>
          <input
            id="res-plate"
            type="text"
            placeholder="ABCD12"
            {...form.register("plate")}
            className="w-full min-h-10 rounded-xl border border-slate-300 px-3 text-sm uppercase"
          />
        </div>
        <div>
          <label htmlFor="res-visitor" className="block text-xs font-semibold text-slate-700 mb-1">
            Conductor / Visita
          </label>
          <input
            id="res-visitor"
            type="text"
            placeholder="Nombre opcional"
            {...form.register("visitor_name")}
            className="w-full min-h-10 rounded-xl border border-slate-300 px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="res-start" className="block text-xs font-semibold text-slate-700 mb-1">
            Inicio
          </label>
          <input
            id="res-start"
            type="datetime-local"
            {...form.register("starts_at")}
            className="w-full min-h-10 rounded-xl border border-slate-300 px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="res-end" className="block text-xs font-semibold text-slate-700 mb-1">
            Término
          </label>
          <input
            id="res-end"
            type="datetime-local"
            {...form.register("ends_at")}
            className="w-full min-h-10 rounded-xl border border-slate-300 px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="inline-flex items-center justify-center gap-2 min-h-10 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          <Plus className="w-4 h-4" />
          Reservar
        </button>
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Reservas registradas ({rows.length})</h2>
        </div>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Aún no hay reservas registradas.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map(row => (
              <div key={row.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {row.plate} {row.visitor_name ? `· ${row.visitor_name}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    QR: <span className="font-mono">{row.qr_token}</span> · {row.starts_at} → {row.ends_at} · Estado:{" "}
                    <span className="font-semibold">{row.status}</span>
                  </p>
                </div>
                {row.status === "confirmed" && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAction(row.id, "check-in")}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Check-in
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAction(row.id, "cancel")}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

