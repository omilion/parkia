import { z } from "zod";
import { validateRut } from "../rut";
export const createClientSchema = z.object({
  name: z.string().trim().min(1),
  email: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  phone: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  rut: z.string().trim().min(1),
  type: z.enum(["natural", "company"]).default("natural"),
  plate: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  address: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  commune: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  city: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  business_activity: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  legal_representative_name: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  legal_representative_rut: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  billing_contact_name: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  billing_contact_email: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  billing_contact_phone: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
  notes: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().nullable().optional(),
  ),
});
export const clientFormSchema = createClientSchema.extend({
  rut: z
    .string()
    .trim()
    .refine(validateRut, "RUT invalido: verifica el digito verificador"),
  email: z.email("Correo invalido"),
  phone: z.string().trim().min(1, "Ingresa el telefono"),
});
export type ClientFormValues = z.infer<typeof clientFormSchema>;

/** Edición de la ficha: el RUT se valida y los contactos pueden quedar vacíos. */
export const clientEditFormSchema = createClientSchema.omit({ plate: true }).extend({
  rut: z
    .string()
    .trim()
    .refine(validateRut, "RUT invalido: verifica el digito verificador"),
  email: z.preprocess(
    (value) => (value === "" ? null : value),
    z.email("Correo invalido").nullable().optional(),
  ),
  billing_contact_email: z.preprocess(
    (value) => (value === "" ? null : value),
    z.email("Correo de facturación invalido").nullable().optional(),
  ),
});
export type ClientEditFormValues = z.output<typeof clientEditFormSchema>;

export const upsertVehicleSchema = z.object({
  plate: z.string().trim().min(2, "Ingresa la patente"),
  brand: z.preprocess((value) => (value === "" ? null : value), z.string().trim().nullable().optional()),
  model: z.preprocess((value) => (value === "" ? null : value), z.string().trim().nullable().optional()),
  color: z.preprocess((value) => (value === "" ? null : value), z.string().trim().nullable().optional()),
  notes: z.preprocess((value) => (value === "" ? null : value), z.string().trim().nullable().optional()),
});
export type VehicleValues = z.output<typeof upsertVehicleSchema>;
