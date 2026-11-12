import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "../../../ui/Dialog";
import { FieldError } from "../../../ui";
import { updateContractFormSchema } from "../../../../shared/schemas/contracts";
import { useContractsPageContext } from "../hooks/useContractsController";

const labelClass = "mb-2 block text-xs font-bold uppercase tracking-wider text-slate-600";
const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base md:text-sm outline-none transition-all focus:border-slate-900 focus:bg-white aria-[invalid=true]:border-red-500";

export default function EditingContractDialog() {
  const {
    editingContract,
    setEditingContract,
    isUpdatingContract,
    handleUpdateContract,
  } = useContractsPageContext();
  const form = useForm({
    resolver: zodResolver(updateContractFormSchema),
    defaultValues: {
      start_date: editingContract.start_date,
      end_date: editingContract.end_date || "",
      monthly_fee: editingContract.monthly_fee,
      billing_day: editingContract.billing_day,
      deposit_amount: editingContract.deposit_amount || 0,
      billing_document_type: editingContract.billing_document_type || "boleta",
      notes: editingContract.notes || "",
      reason: "",
    },
  });
  const { errors } = form.formState;
  const invalid = (name: keyof typeof errors) => (errors[name] ? true : undefined);
  return (
    <Dialog
      open
      onClose={() => setEditingContract(null)}
      dismissible={!isUpdatingContract}
      title="Editar terminos del contrato"
    >
      <form noValidate onSubmit={form.handleSubmit(handleUpdateContract)} className="space-y-5">
        <div className="mb-5">
          <h3 className="text-lg font-bold text-slate-900">
            Editar terminos del contrato
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            #CON-2026-{editingContract.id.toString().padStart(3, "0")} -{" "}
            {editingContract.client_name} - {editingContract.space_name}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="contract-edit-start" className={labelClass}>Fecha de inicio</label>
            <input id="contract-edit-start" type="date" aria-invalid={invalid("start_date")} {...form.register("start_date")} className={inputClass} />
            <FieldError error={errors.start_date} />
          </div>
          <div>
            <label htmlFor="contract-edit-end" className={labelClass}>Fecha termino</label>
            <input id="contract-edit-end" type="date" aria-invalid={invalid("end_date")} {...form.register("end_date")} className={inputClass} />
            <FieldError error={errors.end_date} />
          </div>
          <div>
            <label htmlFor="contract-edit-fee" className={labelClass}>Tarifa mensual</label>
            <input id="contract-edit-fee" type="number" inputMode="numeric" min="1" aria-invalid={invalid("monthly_fee")} {...form.register("monthly_fee")} className={inputClass} />
            <FieldError error={errors.monthly_fee} />
          </div>
          <div>
            <label htmlFor="contract-edit-day" className={labelClass}>Dia de cobro</label>
            <input id="contract-edit-day" type="number" inputMode="numeric" min="1" max="31" aria-invalid={invalid("billing_day")} {...form.register("billing_day")} className={inputClass} />
            <FieldError error={errors.billing_day} />
          </div>
          <div>
            <label htmlFor="contract-edit-deposit" className={labelClass}>Garantia / deposito</label>
            <input id="contract-edit-deposit" type="number" inputMode="numeric" min="0" aria-invalid={invalid("deposit_amount")} {...form.register("deposit_amount")} className={inputClass} />
            <FieldError error={errors.deposit_amount} />
          </div>
          <div>
            <label htmlFor="contract-edit-document" className={labelClass}>Documento de cobro</label>
            <select id="contract-edit-document" {...form.register("billing_document_type")} className={inputClass}>
              <option value="boleta">Boleta</option>
              <option value="factura_exenta">Factura exenta</option>
              <option value="factura_afecta">Factura afecta</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="contract-edit-notes" className={labelClass}>Notas</label>
            <textarea id="contract-edit-notes" rows={3} {...form.register("notes")} className={`${inputClass} resize-none`} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="contract-edit-reason" className={labelClass}>Motivo del cambio</label>
            <textarea
              id="contract-edit-reason"
              rows={3}
              aria-invalid={invalid("reason")}
              {...form.register("reason")}
              className={`${inputClass} resize-none`}
              placeholder="Ajuste solicitado por cliente, cambio comercial aprobado, correccion administrativa..."
            />
            <FieldError error={errors.reason} />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => setEditingContract(null)}
            disabled={isUpdatingContract}
            className="flex-1 rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isUpdatingContract}
            className="flex-1 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:opacity-50"
          >
            {isUpdatingContract ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
