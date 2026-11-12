import { invalidatedDomains } from "../../../lib/useApiMutation";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contractFormSchema, type ContractFormValues } from "../../../../shared/schemas/contracts";
import type { Branch, Client, PaginatedResponse, Space } from "../../../types";
import { apiFetchJson } from "../../../lib/api";
import { Button, Field, Input, MoneyInput, Select, Textarea, LoadingState } from "../../../ui";

export function ContractWizard({
  branches,
  initialBranchId,
  onCreated,
  onCancel,
}: {
  branches: Branch[];
  initialBranchId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const prefix = useId();
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState("");
  const [client, setClient] = useState<Client | null>(null);
  const [branch, setBranch] = useState(initialBranchId);
  const cache = useQueryClient();
  const form = useForm<ContractFormValues>({
    resolver: zodResolver(contractFormSchema),
    defaultValues: {
      client_id: 0,
      space_id: 0,
      start_date: new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Santiago",
      }).format(new Date()),
      end_date: "",
      monthly_fee: 0,
      billing_day: 5,
      deposit_amount: 0,
      billing_document_type: "boleta",
      notes: "",
    },
  });
  const clientsQuery = useQuery({
    queryKey: ["clients", "lookup", search],
    enabled: search.trim().length >= 2,
    queryFn: ({ signal }) =>
      apiFetchJson<PaginatedResponse<Client>>(
        `/api/clients?${new URLSearchParams({ search: search.trim(), page: "1", pageSize: "25" })}`,
        { signal },
      ),
  });
  const spacesQuery = useQuery({
    queryKey: ["spaces", "available", branch],
    queryFn: ({ signal }) =>
      apiFetchJson<Space[]>(
        `/api/spaces/available${branch === "all" ? "" : `?branch_id=${branch}`}`,
        { signal },
      ),
  });
  const mutation = useMutation({
    meta: { invalidates: invalidatedDomains("/api/contracts") },
    mutationFn: (values: ContractFormValues) =>
      apiFetchJson("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      onCreated();
    },
  });
  const next = async () => {
    const fields: Array<keyof ContractFormValues> =
      step === 0
        ? ["client_id", "space_id"]
        : [
            "start_date",
            "end_date",
            "monthly_fee",
            "billing_day",
            "deposit_amount",
            "billing_document_type",
          ];
    if (await form.trigger(fields)) setStep((current) => current + 1);
  };
  const values = form.watch();
  const selectedSpace = spacesQuery.data?.find(
    (space) => space.id === values.space_id,
  );
  return (
    <form
      aria-label="Nuevo contrato por pasos"
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (step < 2) void next();
        else
          void form.handleSubmit(async (data) => {
            try {
              await mutation.mutateAsync(data);
            } catch {}
          })(event);
      }}
    >
      <ol
        aria-label="Pasos del contrato"
        className="grid grid-cols-3 gap-2 text-xs font-semibold"
      >
        {["Cliente y plaza", "Condiciones", "Confirmación"].map(
          (label, index) => (
            <li
              key={label}
              aria-current={step === index ? "step" : undefined}
              className={
                step === index
                  ? "rounded-xl bg-indigo-50 p-3 text-indigo-800"
                  : "rounded-xl bg-slate-100 p-3 text-slate-600"
              }
            >
              {index + 1}. {label}
            </li>
          ),
        )}
      </ol>
      {step === 0 && (
        <div className="space-y-4">
          <Field
            label="Buscar cliente por RUT o nombre"
            htmlFor={`${prefix}-search`}
            error={form.formState.errors.client_id?.message}
          >
            <Input
              id={`${prefix}-search`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          {client ? (
            <div className="rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900">
              <p className="font-bold">{client.name}</p>
              <p>{client.rut}</p>
              <Button
                variant="ghost"
                onClick={() => {
                  setClient(null);
                  form.setValue("client_id", 0);
                }}
              >
                Cambiar cliente
              </Button>
            </div>
          ) : (
            <div className="max-h-52 overflow-y-auto">
              {clientsQuery.isFetching ? (
                <LoadingState rows={1} />
              ) : (
                clientsQuery.data?.items.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => {
                      setClient(person);
                      form.setValue("client_id", person.id, {
                        shouldValidate: true,
                      });
                    }}
                    className="block min-h-12 w-full rounded-xl border-b border-slate-200 p-3 text-left text-sm hover:bg-slate-50"
                  >
                    <strong>{person.name}</strong>
                    <span className="block text-slate-600">{person.rut}</span>
                  </button>
                ))
              )}
              {search.length >= 2 && clientsQuery.data?.items.length === 0 && (
                <p className="text-sm text-slate-600">
                  No hay clientes para esa búsqueda.
                </p>
              )}
            </div>
          )}
          <Field label="Sucursal" htmlFor={`${prefix}-branch`}>
            <Select
              id={`${prefix}-branch`}
              value={branch}
              onChange={(event) => {
                setBranch(event.target.value);
                form.setValue("space_id", 0);
              }}
            >
              <option value="all">Todas las sucursales</option>
              {branches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Plaza disponible"
            htmlFor={`${prefix}-space`}
            error={form.formState.errors.space_id?.message}
          >
            <Select
              id={`${prefix}-space`}
              value={values.space_id || ""}
              onChange={(event) => {
                const space = spacesQuery.data?.find(
                  (item) => item.id === Number(event.target.value),
                );
                form.setValue("space_id", space?.id || 0, {
                  shouldValidate: true,
                });
                form.setValue("monthly_fee", space?.price || 0);
              }}
            >
              <option value="">Selecciona una plaza</option>
              {spacesQuery.data?.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                  {space.branch_name ? ` - ${space.branch_name}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          {(clientsQuery.error || spacesQuery.error) && (
            <p role="alert" className="text-sm text-red-800">
              {clientsQuery.error?.message || spacesQuery.error?.message}
            </p>
          )}
        </div>
      )}
      {step === 1 && (
        <div className="space-y-4">
          <Field
            label="Fecha de inicio"
            htmlFor={`${prefix}-start`}
            error={form.formState.errors.start_date?.message}
          >
            <Input
              id={`${prefix}-start`}
              type="date"
              {...form.register("start_date")}
            />
          </Field>
          <Field
            label="Fecha de término (opcional)"
            htmlFor={`${prefix}-end`}
            error={form.formState.errors.end_date?.message}
          >
            <Input
              id={`${prefix}-end`}
              type="date"
              {...form.register("end_date")}
            />
          </Field>
          <Field
            label="Tarifa mensual"
            htmlFor={`${prefix}-fee`}
            error={form.formState.errors.monthly_fee?.message}
          >
            <Controller
              control={form.control}
              name="monthly_fee"
              render={({ field }) => (
                <MoneyInput
                  id={`${prefix}-fee`}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                />
              )}
            />
          </Field>
          <Field
            label="Día de cobro"
            htmlFor={`${prefix}-day`}
            error={form.formState.errors.billing_day?.message}
          >
            <Input
              id={`${prefix}-day`}
              type="number"
              min="1"
              max="31"
              {...form.register("billing_day", { valueAsNumber: true })}
            />
          </Field>
          <Field
            label="Garantía / depósito"
            htmlFor={`${prefix}-deposit`}
            error={form.formState.errors.deposit_amount?.message}
          >
            <Controller
              control={form.control}
              name="deposit_amount"
              render={({ field }) => (
                <MoneyInput
                  id={`${prefix}-deposit`}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                />
              )}
            />
          </Field>
          <Field label="Documento de cobro" htmlFor={`${prefix}-dte`}>
            <Select
              id={`${prefix}-dte`}
              {...form.register("billing_document_type")}
            >
              <option value="boleta">Boleta</option>
              <option value="factura_exenta">Factura exenta</option>
              <option value="factura_afecta">Factura afecta</option>
            </Select>
          </Field>
          <Field label="Notas internas" htmlFor={`${prefix}-notes`}>
            <Textarea id={`${prefix}-notes`} {...form.register("notes")} />
          </Field>
        </div>
      )}
      {step === 2 && (
        <dl className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
          <div>
            <dt className="text-slate-600">Cliente</dt>
            <dd className="font-bold">{client?.name}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Plaza</dt>
            <dd>{selectedSpace?.name}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Vigencia</dt>
            <dd>
              {values.start_date} → {values.end_date || "Indefinido"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">Tarifa mensual</dt>
            <dd className="font-bold">
              ${values.monthly_fee.toLocaleString("es-CL")}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">Día de cobro</dt>
            <dd>{values.billing_day}</dd>
          </div>
        </dl>
      )}
      {mutation.error && (
        <p role="alert" className="text-sm text-red-800">
          {mutation.error.message}
        </p>
      )}
      <div className="sticky bottom-0 flex gap-3 border-t border-slate-200 bg-white py-3">
        {step > 0 ? (
          <Button
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => setStep((current) => current - 1)}
          >
            Volver
          </Button>
        ) : (
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" loading={mutation.isPending} fullWidth>
          {step === 2 ? "Generar contrato" : "Continuar"}
        </Button>
      </div>
    </form>
  );
}
