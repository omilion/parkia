import { z } from 'zod';
export const manualPaymentFieldsSchema = z.object({
  method: z.enum(['cash', 'transfer', 'card', 'automatic']),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Selecciona una fecha válida'),
  reference: z.string().trim(), note: z.string().trim().min(3, 'Explica el pago con al menos 3 caracteres').max(500),
});
export type ManualPaymentValues = z.infer<typeof manualPaymentFieldsSchema>;
