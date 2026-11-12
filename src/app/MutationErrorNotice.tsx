import { useState } from "react";
import { useMutationState } from "@tanstack/react-query";
import { Button } from "../ui/Button";

export function MutationErrorNotice() {
  const [dismissed, setDismissed] = useState(0);
  const writes = useMutationState({
    select: (mutation) => ({
      status: mutation.state.status,
      submittedAt: mutation.state.submittedAt,
      message: mutation.state.error?.message,
    }),
  });
  const latest = [...writes].sort((a, b) => b.submittedAt - a.submittedAt)[0];
  if (!latest || latest.status !== "error" || latest.submittedAt <= dismissed)
    return null;
  return (
    <div
      role="alert"
      className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      <p>{latest.message || "No se pudo guardar la operación."}</p>
      <Button variant="ghost" onClick={() => setDismissed(latest.submittedAt)}>
        Cerrar aviso
      </Button>
    </div>
  );
}
