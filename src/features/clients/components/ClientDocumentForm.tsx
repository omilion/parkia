import { UploadCloud } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FieldError, formInputClass, formLabelClass } from "../../../ui";
import { documentFieldsSchema } from "../../../../shared/schemas/documents";
import { useClientDetailViewContext } from "../hooks/useClientDetailController";

/** Carga de un documento del cliente (contrato, identidad, mandato...). */
export default function ClientDocumentForm() {
  const { selectedDocumentName, setSelectedDocumentName, isUploadingDocument, documentError, handleUploadDocument } =
    useClientDetailViewContext();
  const [file, setFile] = useState<File | null>(null);
  const form = useForm({
    resolver: zodResolver(documentFieldsSchema),
    defaultValues: { label: "", document_type: "other" as const, status: "received" as const, expires_at: "", notes: "" },
  });
  const { errors } = form.formState;
  return (
    <form
      noValidate
      aria-label="Nuevo documento"
      onSubmit={form.handleSubmit(async values => {
        if (await handleUploadDocument(values, file)) {
          form.reset();
          setFile(null);
        }
      })}
      className="space-y-4 border border-slate-100 rounded-2xl p-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label htmlFor="client-doc-label" className={formLabelClass}>Nombre del Documento</label>
          <input
            id="client-doc-label"
            aria-invalid={errors.label ? true : undefined}
            {...form.register("label")}
            className={formInputClass}
            placeholder="Contrato firmado, cédula, mandato..."
          />
          <FieldError error={errors.label} />
        </div>
        <div>
          <label htmlFor="client-doc-type" className={formLabelClass}>Tipo</label>
          <select id="client-doc-type" {...form.register("document_type")} className={formInputClass}>
            <option value="contract">Contrato</option>
            <option value="identity">Identidad</option>
            <option value="mandate">Mandato</option>
            <option value="receipt">Comprobante</option>
            <option value="other">Otro</option>
          </select>
        </div>
        <div>
          <label htmlFor="client-doc-status" className={formLabelClass}>Estado</label>
          <select id="client-doc-status" {...form.register("status")} className={formInputClass}>
            <option value="pending">Pendiente</option>
            <option value="received">Recibido</option>
            <option value="approved">Aprobado</option>
            <option value="rejected">Observado</option>
            <option value="expired">Vencido</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="client-doc-expires" className={formLabelClass}>Vencimiento</label>
          <input id="client-doc-expires" type="date" aria-invalid={errors.expires_at ? true : undefined} {...form.register("expires_at")} className={formInputClass} />
          <FieldError error={errors.expires_at} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="client-doc-notes" className={formLabelClass}>Notas de Seguimiento</label>
          <textarea
            id="client-doc-notes"
            {...form.register("notes")}
            rows={2}
            className={`${formInputClass} resize-none`}
            placeholder="Qué falta, quién debe corregirlo o comentario de revisión..."
          />
        </div>
      </div>
      <label className="border-2 border-dashed border-slate-200 rounded-2xl p-5 flex items-center justify-between gap-4 hover:border-slate-400 transition-all cursor-pointer bg-slate-50/50 focus-within:border-slate-900">
        <div className="flex items-center gap-3 min-w-0">
          <UploadCloud className="w-8 h-8 text-slate-300 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 truncate">
              {selectedDocumentName || "Seleccionar archivo"}
            </p>
            <p className="text-xs text-slate-600">PDF, JPG o PNG hasta 5MB</p>
          </div>
        </div>
        <span className="text-xs font-bold text-slate-600">Examinar</span>
        <input
          type="file"
          aria-label="Archivo del documento"
          accept="application/pdf,image/jpeg,image/png"
          className="sr-only"
          onChange={(event) => {
            const selected = event.target.files?.[0] || null;
            setFile(selected);
            setSelectedDocumentName(selected?.name || "");
          }}
        />
      </label>
      {documentError && (
        <p role="alert" className="text-xs font-medium text-red-700">{documentError}</p>
      )}
      <button
        type="submit"
        disabled={isUploadingDocument}
        className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all disabled:opacity-50"
      >
        {isUploadingDocument ? "Subiendo..." : "Guardar Documento"}
      </button>
    </form>
  );
}
