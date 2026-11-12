import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { clientFormSchema } from "../../../../shared/schemas/clients";
import { useApiMutation } from "../../../lib/useApiMutation";
export default function ClientCreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (name: string) => void;
}) {
  const apiWrite = useApiMutation("clients/create");
  const form = useForm({
    resolver: zodResolver(clientFormSchema),
    defaultValues: { type: "natural" },
  });
  return (
    <form
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await apiWrite.json("/api/clients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(values),
          });
          onCreated(values.name);
        } catch {
          /* Query muestra el error y conserva los datos. */
        }
      })}
      className="space-y-6"
    >
      <div className="space-y-4">
        <div>
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
            Tipo de Cliente
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="relative flex items-center justify-center p-4 border-2 border-slate-100 rounded-2xl cursor-pointer hover:border-slate-200 transition-all has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white">
              <input
                type="radio"
                {...form.register("type")}
                value="natural"
                defaultChecked
                className="sr-only"
              />
              <span className="text-sm font-bold">Persona Natural</span>
            </label>
            <label className="relative flex items-center justify-center p-4 border-2 border-slate-100 rounded-2xl cursor-pointer hover:border-slate-200 transition-all has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white">
              <input
                type="radio"
                {...form.register("type")}
                value="company"
                className="sr-only"
              />
              <span className="text-sm font-bold">Empresa</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Nombre Completo / Razón Social
            </label>
            <input
              aria-label="Nombre Completo / Razón Social"
              {...form.register("name")}
              required
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              placeholder="Ej: Juan Pérez o Hazlo Mejor SpA"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              RUT
            </label>
            <input
              aria-label="RUT"
              {...form.register("rut")}
              required
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              placeholder="12.345.678-9"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Teléfono
            </label>
            <input
              aria-label="Teléfono"
              {...form.register("phone")}
              required
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              placeholder="+569..."
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Correo Electrónico
            </label>
            <input
              aria-label="Correo Electrónico"
              {...form.register("email")}
              type="email"
              required
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              placeholder="ejemplo@correo.com"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Patente (Opcional)
            </label>
            <input
              aria-label="Patente (Opcional)"
              {...form.register("plate")}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              placeholder="ABCD-12"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Dirección
            </label>
            <input
              aria-label="Dirección"
              {...form.register("address")}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              placeholder="Av. Principal 123"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Comuna
            </label>
            <input
              aria-label="Comuna"
              {...form.register("commune")}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Ciudad
            </label>
            <input
              aria-label="Ciudad"
              {...form.register("city")}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Giro / Actividad
            </label>
            <input
              aria-label="Giro / Actividad"
              {...form.register("business_activity")}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              placeholder="Obligatorio para empresas"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Representante
            </label>
            <input
              aria-label="Representante"
              {...form.register("legal_representative_name")}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              RUT Rep.
            </label>
            <input
              aria-label="RUT Rep."
              {...form.register("legal_representative_rut")}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Contacto Facturación
            </label>
            <input
              aria-label="Contacto Facturación"
              {...form.register("billing_contact_name")}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Email Fact.
            </label>
            <input
              aria-label="Email Fact."
              {...form.register("billing_contact_email")}
              type="email"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Tel. Fact.
            </label>
            <input
              aria-label="Tel. Fact."
              {...form.register("billing_contact_phone")}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">
              Notas
            </label>
            <textarea
              aria-label="Notas"
              {...form.register("notes")}
              rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
            />
          </div>
        </div>
      </div>

      {Object.entries(form.formState.errors).map(([name, error]) => (
        <p key={name} role="alert" className="text-sm text-red-800">
          {String((error as { message?: string })?.message || name)}
        </p>
      ))}
      {apiWrite.error && (
        <p role="alert" className="text-sm text-red-800">
          {apiWrite.error.message}
        </p>
      )}
      <div className="pt-6 border-t border-slate-100 flex gap-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={apiWrite.isPending}
          className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all"
        >
          Guardar Cliente
        </button>
      </div>
    </form>
  );
}
