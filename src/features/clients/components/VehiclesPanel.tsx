import { Archive, Car, Plus } from "lucide-react";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FieldError, formInputClass, formLabelClass } from "../../../ui";
import { upsertVehicleSchema } from "../../../../shared/schemas/clients";
import { useClientDetailViewContext } from "../hooks/useClientDetailController";
const vehicleFields = [
  ["plate", "Patente"],
  ["brand", "Marca"],
  ["model", "Modelo"],
  ["color", "Color"],
] as const;

function VehicleForm() {
  const { isSavingVehicle, handleCreateVehicle } = useClientDetailViewContext();
  const form = useForm({
    resolver: zodResolver(upsertVehicleSchema),
    defaultValues: { plate: "", brand: "", model: "", color: "", notes: "" },
  });
  const { errors } = form.formState;
  return (
    <form
      noValidate
      aria-label="Agregar vehículo"
      onSubmit={form.handleSubmit(async values => {
        if (await handleCreateVehicle(values)) form.reset();
      })}
      className="border border-slate-100 rounded-2xl p-4 space-y-4"
    >
      <p className="text-sm font-bold flex items-center gap-2">
        <Car className="w-4 h-4 text-slate-600" aria-hidden="true" /> Agregar vehículo
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {vehicleFields.map(([name, label]) => (
          <div key={name}>
            <label htmlFor={`vehicle-${name}`} className={formLabelClass}>{label}</label>
            <input
              id={`vehicle-${name}`}
              aria-invalid={errors[name] ? true : undefined}
              {...form.register(name, name === "plate" ? { setValueAs: value => String(value ?? "").trim().toUpperCase() } : undefined)}
              className={`${formInputClass}${name === "plate" ? " uppercase" : ""}`}
            />
            <FieldError error={errors[name]} />
          </div>
        ))}
        <div className="sm:col-span-2">
          <label htmlFor="vehicle-notes" className={formLabelClass}>Notas</label>
          <input id="vehicle-notes" {...form.register("notes")} className={formInputClass} />
        </div>
      </div>
      <button
        type="submit"
        disabled={isSavingVehicle}
        className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-50"
      >
        <Plus className="w-4 h-4 inline mr-2" aria-hidden="true" />
        {isSavingVehicle ? "Guardando..." : "Agregar vehículo"}
      </button>
    </form>
  );
}

export default function VehiclesPanel() {
  const { data, handleDeleteVehicle } = useClientDetailViewContext();
  return (
    <div className="space-y-5">
      <VehicleForm />
      <div className="space-y-3">
        {(data.vehicles || []).length === 0 ? (
          <p className="text-center py-8 text-slate-600 italic">
            Sin vehículos registrados
          </p>
        ) : (
          data.vehicles.map((vehicle: any) => (
            <div
              key={vehicle.id}
              className="flex items-center justify-between border border-slate-100 rounded-2xl p-4"
            >
              <div>
                <p className="text-sm font-black uppercase tracking-wider">
                  {vehicle.plate}
                </p>
                <p className="text-xs text-slate-600">
                  {[vehicle.brand, vehicle.model, vehicle.color]
                    .filter(Boolean)
                    .join(" · ") || "Sin detalle"}
                </p>
                {vehicle.notes && (
                  <p className="text-xs text-slate-600 mt-1">{vehicle.notes}</p>
                )}
              </div>
              <button
                onClick={() => handleDeleteVehicle(vehicle.id, vehicle.plate)}
                className="p-2 text-red-500 hover:bg-red-50 rounded-xl"
                title="Dar de baja vehículo"
                aria-label={`Dar de baja vehículo ${vehicle.plate}`}
              >
                <Archive className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
