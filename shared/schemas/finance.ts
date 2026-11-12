import { z } from 'zod';
import { dateString, optionalAmount, optionalDate, optionalEnum, optionalId, optionalText, positiveAmount, requiredText } from './common';

/** Reglas de Finanzas compartidas por los formularios y la API. */

export const paymentAdjustmentSchema = z.object({
  type: z.enum(['discount', 'waiver', 'fee']),
  amount: positiveAmount,
  reason: requiredText(3, 500, 'El motivo'),
});
export type PaymentAdjustmentValues = z.output<typeof paymentAdjustmentSchema>;

export const reverseAllocationSchema = z.object({
  note: requiredText(3, 500, 'El motivo'),
});
export type ReverseAllocationValues = z.output<typeof reverseAllocationSchema>;

export const collectionChannels = ['phone', 'email', 'whatsapp', 'in_person', 'other'] as const;
export const collectionActionSchema = z.object({
  channel: z.enum(collectionChannels),
  note: requiredText(3, 1000, 'La nota'),
  next_action_at: optionalDate,
});
export type CollectionActionValues = z.output<typeof collectionActionSchema>;

/** Campos que escribe el usuario al aplicar un abono; el pago lo agrega la pantalla. */
export const allocateMovementFieldsSchema = z.object({
  amount: positiveAmount,
  note: requiredText(3, 500, 'La nota'),
});
export type AllocateMovementValues = z.output<typeof allocateMovementFieldsSchema>;
export const allocateMovementSchema = allocateMovementFieldsSchema.extend({
  payment_id: z.coerce.number().int().positive(),
});

export const updateBankMovementSchema = z.object({
  date: dateString.optional(),
  description: optionalText,
  rut: optionalText,
  amount: positiveAmount.optional(),
  notes: optionalText,
});
/** En el formulario la fecha, la glosa, el RUT y el monto son obligatorios. */
export const bankMovementFormSchema = updateBankMovementSchema.extend({
  date: dateString,
  description: requiredText(1, 300, 'La glosa'),
  rut: requiredText(1, 20, 'El RUT'),
  amount: positiveAmount,
});
export type BankMovementFormValues = z.output<typeof bankMovementFormSchema>;

export const markBankMovementPartialSchema = z.object({
  note: requiredText(3, 500, 'La nota'),
});

export const expenseCategories = ['rent', 'maintenance', 'utilities', 'payroll', 'supplies', 'taxes', 'admin', 'other'] as const;
export const expenseDocumentTypes = ['invoice', 'receipt', 'ticket', 'internal', 'none'] as const;
export const expensePaymentMethods = ['cash', 'transfer', 'card', 'automatic', 'other'] as const;
export const expensePaymentStatuses = ['pending', 'paid', 'overdue', 'cancelled'] as const;

export const expenseReceiptSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  dataBase64: z.string().trim().min(1),
});

/** Campos del gasto que escribe el usuario (el comprobante se adjunta aparte). */
export const expenseFieldsSchema = z.object({
  date: dateString,
  category: z.enum(expenseCategories),
  branch_id: optionalId,
  cost_center: z.preprocess(value => (value === '' || value == null ? 'general' : value), z.string().trim().min(1).max(80)),
  supplier_name: requiredText(1, 160, 'El proveedor'),
  supplier_rut: optionalText,
  description: requiredText(1, 500, 'La descripción'),
  amount_net: optionalAmount,
  tax_amount: optionalAmount,
  amount_total: positiveAmount,
  document_type: z.enum(expenseDocumentTypes).default('invoice'),
  document_number: optionalText,
  payment_method: optionalEnum(expensePaymentMethods),
  payment_status: z.enum(expensePaymentStatuses).default('pending'),
  paid_at: optionalDate,
  due_date: optionalDate,
  notes: optionalText,
});
export type ExpenseFieldsValues = z.output<typeof expenseFieldsSchema>;

export const budgetFieldsSchema = z.object({
  category: z.enum(expenseCategories),
  planned_amount: z.coerce.number({ error: 'Ingresa un monto' }).min(0, 'El monto no puede ser negativo'),
  notes: optionalText,
});
export type BudgetFieldsValues = z.output<typeof budgetFieldsSchema>;
