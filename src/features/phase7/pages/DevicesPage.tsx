import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Camera, DoorOpen, KeyRound, Plus, Trash2 } from "lucide-react";
import { deviceCreateSchema } from "../../../../shared/schemas/devices";
import { apiFetchJson } from "../../../lib/api";
import { useApiMutation } from "../../../lib/useApiMutation";

type DeviceRow = {
  id: number;
  name: string;
  type: "lpr" | "barrier" | "totem" | "pos";
  direction: "entry" | "exit" | "both";
  vendor: "generic" | "hikvision" | "dahua" | "shelly";
  endpoint_url: string | null;
  api_key_prefix: string;
  status: "active" | "inactive";
  last_seen_at: string | null;
};

type DeviceEventRow = {
  id: number;
  device_name: string;
  device_type: string;
  event_type: string;
  plate: string | null;
  status: string;
  created_at: string;
};

export default function DevicesPage() {
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const devicesQuery = useQuery<{ devices: DeviceRow[] }>({
    queryKey: ["/api/devices"],
    queryFn: () => apiFetchJson<{ devices: DeviceRow[] }>("/api/devices"),
  });

  const eventsQuery = useQuery<{ events: DeviceEventRow[] }>({
    queryKey: ["/api/devices/events"],
    queryFn: () => apiFetchJson<{ events: DeviceEventRow[] }>("/api/devices/events"),
  });

  const createMutation = useApiMutation("DevicesPage.tsx");
  const commandMutation = useApiMutation("DevicesPage.tsx");
  const deleteMutation = useApiMutation("DevicesPage.tsx");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(deviceCreateSchema),
    defaultValues: {
      name: "",
      type: "lpr" as const,
      direction: "entry" as const,
      vendor: "hikvision" as const,
      endpoint_url: "",
    },
  });

  const onCreate = handleSubmit(async (values) => {
    setErrorMsg(null);
    setFeedback(null);
    setIssuedKey(null);
    try {
      const created = await createMutation.json<{ id: number; name: string; api_key: string }>("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      setIssuedKey(created.api_key);
      setFeedback(`Dispositivo "${created.name}" registrado.`);
      reset();
      await devicesQuery.refetch();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo registrar el dispositivo.");
    }
  });

  async function handleOpenBarrier(deviceId: number) {
    setErrorMsg(null);
    setFeedback(null);
    try {
      await commandMutation.json(`/api/devices/${deviceId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "open_barrier" }),
      });
      setFeedback("Comando de apertura de barrera enviado.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo enviar el comando.");
    }
  }

  async function handleDeactivate(deviceId: number) {
    setErrorMsg(null);
    try {
      await deleteMutation.json(`/api/devices/${deviceId}`, { method: "DELETE" });
      await devicesQuery.refetch();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo desactivar el dispositivo.");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Camera className="h-6 w-6 text-indigo-600" />
          Dispositivos, Cámaras LPR y Barreras
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Registra cámaras LPR (Hikvision/Dahua), tótems y relés de barrera (Shelly) con autenticación por clave de dispositivo.
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
      {issuedKey && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <KeyRound className="h-4 w-4" />
            Clave de dispositivo (guárdala ahora, no se volverá a mostrar):
          </div>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 font-mono text-xs text-slate-900">
            {issuedKey}
          </code>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Registrar dispositivo</h2>
        <form onSubmit={onCreate} className="mt-4 grid gap-4 md:grid-cols-5">
          <div className="md:col-span-2">
            <label htmlFor="device-name" className="block text-sm font-medium text-slate-700">
              Nombre
            </label>
            <input
              id="device-name"
              type="text"
              placeholder="Cámara Entrada Norte"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              {...register("name")}
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
          </div>

          <div>
            <label htmlFor="device-type" className="block text-sm font-medium text-slate-700">
              Tipo
            </label>
            <select id="device-type" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" {...register("type")}>
              <option value="lpr">Cámara LPR</option>
              <option value="barrier">Barrera / Relé</option>
              <option value="totem">Tótem</option>
              <option value="pos">POS</option>
            </select>
          </div>

          <div>
            <label htmlFor="device-direction" className="block text-sm font-medium text-slate-700">
              Dirección
            </label>
            <select id="device-direction" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" {...register("direction")}>
              <option value="entry">Entrada</option>
              <option value="exit">Salida</option>
              <option value="both">Ambos</option>
            </select>
          </div>

          <div>
            <label htmlFor="device-vendor" className="block text-sm font-medium text-slate-700">
              Adaptador
            </label>
            <select id="device-vendor" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" {...register("vendor")}>
              <option value="hikvision">Hikvision</option>
              <option value="dahua">Dahua</option>
              <option value="shelly">Shelly</option>
              <option value="generic">Genérico</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <label htmlFor="device-endpoint" className="block text-sm font-medium text-slate-700">
              URL relé local (opcional, para Shelly)
            </label>
            <input
              id="device-endpoint"
              type="url"
              placeholder="http://192.168.1.50/relay/0"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              {...register("endpoint_url")}
            />
            {errors.endpoint_url && <p className="mt-1 text-xs text-red-600">{errors.endpoint_url.message}</p>}
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {createMutation.isPending ? "Creando..." : "Registrar"}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Dispositivos configurados</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-4">Nombre</th>
                <th className="py-2 pr-4">Tipo / Adaptador</th>
                <th className="py-2 pr-4">Prefijo clave</th>
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(devicesQuery.data?.devices || []).map((dev) => (
                <tr key={dev.id}>
                  <td className="py-2 pr-4 font-medium text-slate-900">{dev.name}</td>
                  <td className="py-2 pr-4 text-slate-600">
                    {dev.type} · {dev.vendor} ({dev.direction})
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-500">{dev.api_key_prefix}…</td>
                  <td className="py-2 pr-4">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {dev.status}
                    </span>
                  </td>
                  <td className="flex items-center gap-2 py-2">
                    {dev.type === "barrier" && dev.status === "active" && (
                      <button
                        type="button"
                        onClick={() => void handleOpenBarrier(dev.id)}
                        className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                      >
                        <DoorOpen className="h-3.5 w-3.5" />
                        Abrir
                      </button>
                    )}
                    {dev.status === "active" && (
                      <button
                        type="button"
                        onClick={() => void handleDeactivate(dev.id)}
                        className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(!devicesQuery.data?.devices || devicesQuery.data.devices.length === 0) && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-500">
                    No hay dispositivos registrados aún.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Últimos eventos de dispositivos</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-4">Dispositivo</th>
                <th className="py-2 pr-4">Evento</th>
                <th className="py-2 pr-4">Patente</th>
                <th className="py-2">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(eventsQuery.data?.events || []).map((ev) => (
                <tr key={ev.id}>
                  <td className="py-2 pr-4 font-medium text-slate-800">{ev.device_name}</td>
                  <td className="py-2 pr-4 text-slate-600">{ev.event_type}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-700">{ev.plate || "-"}</td>
                  <td className="py-2 text-xs text-slate-500">{ev.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
