import { useState } from "react";
import { UploadCloud } from "lucide-react";
import { Dialog } from "../../../ui/Dialog";
import { FieldError } from "../../../ui";
import { useContractsPageContext } from "../hooks/useContractsController";

/**
 * Formulario de un solo archivo: no tiene campos de texto que validar con Zod.
 * El tipo y el tamaño del archivo se validan con la misma regla que Documentos.
 */
export default function ContractUploadDialog() {
  const {
    contractUpload,
    signedFileName,
    setSignedFileName,
    isUploadingSigned,
    closeUploadDialog,
    handleSignedUpload,
  } = useContractsPageContext();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onClose={closeUploadDialog}
      dismissible={!isUploadingSigned}
      title="Adjuntar contrato firmado"
    >
      <form
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setFileError(await handleSignedUpload(file));
        }}
        className="space-y-5"
      >
        <div>
          <h3 className="text-lg font-bold text-slate-900">
            Adjuntar contrato firmado
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            #CON-2026-{contractUpload.id.toString().padStart(3, "0")} ·{" "}
            {contractUpload.client_name} · {contractUpload.space_name}
          </p>
        </div>

        <div>
          <label className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center hover:border-slate-400 transition-all cursor-pointer bg-slate-50/50 focus-within:border-slate-900">
            <UploadCloud className="w-10 h-10 text-slate-300 mb-3" aria-hidden="true" />
            <span className="text-sm font-bold text-slate-900">
              {signedFileName || "Seleccionar archivo firmado"}
            </span>
            <span className="text-xs text-slate-600 mt-1">
              PDF, JPG o PNG hasta 5MB
            </span>
            <input
              type="file"
              aria-label="Contrato firmado"
              aria-invalid={fileError ? true : undefined}
              accept="application/pdf,image/jpeg,image/png"
              className="sr-only"
              onChange={(event) => {
                const selected = event.target.files?.[0] || null;
                setFile(selected);
                setFileError(null);
                setSignedFileName(selected?.name || "");
              }}
            />
          </label>
          <FieldError error={fileError ? { message: fileError } : undefined} />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={closeUploadDialog}
            disabled={isUploadingSigned}
            className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isUploadingSigned || !signedFileName}
            className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all disabled:opacity-50"
          >
            {isUploadingSigned ? "Subiendo..." : "Guardar firmado"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
