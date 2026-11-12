import { Download, FileText } from "lucide-react";

import { cn } from "../../../lib/utils";

import { useClientDetailViewContext } from "../hooks/useClientDetailController";
import ClientDocumentForm from "./ClientDocumentForm";
export default function DocumentsPanel() {
  const {
    documentStatusFilter,
    setDocumentStatusFilter,
    updateDocumentStatus,
    filteredDocuments,
    pendingDocuments,
    expiredDocuments,
    documentStatusLabel,
    documentTypeLabel,
  } = useClientDetailViewContext();
  return (
    <div className="space-y-6">
      <ClientDocumentForm />

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">
            Pendientes / Observados
          </p>
          <p className="text-2xl font-bold text-amber-700 mt-1">
            {pendingDocuments}
          </p>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
          <p className="text-xs font-bold text-red-700 uppercase tracking-wider">
            Vencidos
          </p>
          <p className="text-2xl font-bold text-red-700 mt-1">
            {expiredDocuments}
          </p>
        </div>
      </div>

      <select
        aria-label="Todos los documentos"
        value={documentStatusFilter}
        onChange={(e) => setDocumentStatusFilter(e.target.value)}
        className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none"
      >
        <option value="all">Todos los documentos</option>
        <option value="pending">Pendientes</option>
        <option value="received">Recibidos</option>
        <option value="approved">Aprobados</option>
        <option value="rejected">Observados</option>
        <option value="expired">Vencidos</option>
      </select>

      <div className="space-y-3">
        {filteredDocuments.length === 0 ? (
          <p className="text-center py-10 text-slate-600 italic">
            Sin documentos cargados
          </p>
        ) : (
          filteredDocuments.map((document: any) => (
            <div
              key={document.id}
              className="flex items-center justify-between p-4 border border-slate-100 rounded-2xl"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600 shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-bold truncate">
                      {document.label}
                    </p>
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider",
                        document.status === "approved"
                          ? "bg-emerald-100 text-emerald-800"
                          : document.status === "rejected" ||
                              document.status === "expired"
                            ? "bg-red-100 text-red-700"
                            : document.status === "pending"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {documentStatusLabel[document.status] || document.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 truncate">
                    {documentTypeLabel[document.document_type] || "Otro"} ·{" "}
                    {document.file_name}
                  </p>
                  {document.expires_at && (
                    <p className="text-xs text-slate-600">
                      Vence:{" "}
                      {new Date(document.expires_at).toLocaleDateString()}
                    </p>
                  )}
                  {document.notes && (
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                      {document.notes}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  aria-label="Pendiente"
                  value={document.status}
                  onChange={(e) =>
                    updateDocumentStatus(document.id, e.target.value)
                  }
                  className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                >
                  <option value="pending">Pendiente</option>
                  <option value="received">Recibido</option>
                  <option value="approved">Aprobado</option>
                  <option value="rejected">Observado</option>
                  <option value="expired">Vencido</option>
                </select>
                <a
                  href={`/api/documents/${document.id}/download`}
                  className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                >
                  <Download className="w-4 h-4" />
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
