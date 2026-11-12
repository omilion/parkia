import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { cn } from "../../../lib/utils";

import { useClientDetailViewContext } from "../hooks/useClientDetailController";
export default function AccessPanel() {
  const { data } = useClientDetailViewContext();
  return (
    <div className="space-y-4">
      {data.access.map((a: any) => (
        <div
          key={a.id}
          className="flex items-center justify-between p-4 border-b border-slate-50"
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center",
                a.access_type === "entry"
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-blue-50 text-blue-600",
              )}
            >
              {a.access_type === "entry" ? (
                <ArrowDownRight className="w-4 h-4" />
              ) : (
                <ArrowUpRight className="w-4 h-4" />
              )}
            </div>
            <div>
              <p className="text-sm font-bold">{a.space_name}</p>
              <p className="text-xs text-slate-600">
                {new Date(a.timestamp).toLocaleString()}
              </p>
            </div>
          </div>
          <p className="text-xs font-bold uppercase text-slate-600">
            {a.access_type === "entry" ? "Entrada" : "Salida"}
          </p>
        </div>
      ))}
    </div>
  );
}
