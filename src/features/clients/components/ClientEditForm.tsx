import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FieldError, formInputClass, formLabelClass } from "../../../ui";
import { clientEditFormSchema } from "../../../../shared/schemas/clients";
import { useClientDetailViewContext } from "../hooks/useClientDetailController";

type TextName =
  | "name" | "rut" | "phone" | "email" | "address" | "commune" | "city" | "business_activity"
  | "legal_representative_name" | "legal_representative_rut" | "billing_contact_name"
  | "billing_contact_email" | "billing_contact_phone";

const fields: Array<{ name: TextName; label: string; type?: string; wide?: boolean }> = [
  { name: "name", label: "Nombre / Razón Social", wide: true },
  { name: "rut", label: "RUT" },
  { name: "phone", label: "Teléfono", type: "tel" },
  { name: "email", label: "Correo", type: "email" },
  { name: "address", label: "Dirección", wide: true },
  { name: "commune", label: "Comuna" },
  { name: "city", label: "Ciudad" },
  { name: "business_activity", label: "Giro / Actividad", wide: true },
  { name: "legal_representative_name", label: "Representante legal" },
  { name: "legal_representative_rut", label: "RUT representante" },
  { name: "billing_contact_name", label: "Contacto facturación", wide: true },
  { name: "billing_contact_email", label: "Email facturación", type: "email" },
  { name: "billing_contact_phone", label: "Teléfono facturación", type: "tel" },
];

/** Edición de los datos del cliente con validación de RUT y correos. */
export default function ClientEditForm() {
  const { data, isSavingClient, handleUpdateClient } = useClientDetailViewContext();
  const client = data.client;
  const form = useForm({
    resolver: zodResolver(clientEditFormSchema),
    defaultValues: {
      ...Object.fromEntries(fields.map(field => [field.name, client[field.name] || ""])),
      type: client.type || "natural",
      notes: client.notes || "",
    },
  });
  const { errors } = form.formState;
  return (
    <form noValidate aria-label="Datos del cliente" onSubmit={form.handleSubmit(handleUpdateClient)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.slice(0, 2).map(field => (
          <div key={field.name} className={field.wide ? "sm:col-span-2" : undefined}>
            <label htmlFor={`client-edit-${field.name}`} className={formLabelClass}>{field.label}</label>
            <input id={`client-edit-${field.name}`} type={field.type || "text"} aria-invalid={errors[field.name] ? true : undefined} {...form.register(field.name)} className={formInputClass} />
            <FieldError error={errors[field.name]} />
          </div>
        ))}
        <div>
          <label htmlFor="client-edit-type" className={formLabelClass}>Tipo</label>
          <select id="client-edit-type" {...form.register("type")} className={formInputClass}>
            <option value="natural">Persona Natural</option>
            <option value="company">Empresa</option>
          </select>
        </div>
        {fields.slice(2).map(field => (
          <div key={field.name} className={field.wide ? "sm:col-span-2" : undefined}>
            <label htmlFor={`client-edit-${field.name}`} className={formLabelClass}>{field.label}</label>
            <input id={`client-edit-${field.name}`} type={field.type || "text"} aria-invalid={errors[field.name] ? true : undefined} {...form.register(field.name)} className={formInputClass} />
            <FieldError error={errors[field.name]} />
          </div>
        ))}
        <div className="sm:col-span-2">
          <label htmlFor="client-edit-notes" className={formLabelClass}>Notas</label>
          <textarea id="client-edit-notes" {...form.register("notes")} rows={4} className={`${formInputClass} resize-none`} />
        </div>
      </div>
      <button
        type="submit"
        disabled={isSavingClient}
        className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-50"
      >
        {isSavingClient ? "Guardando..." : "Guardar datos del cliente"}
      </button>
    </form>
  );
}
