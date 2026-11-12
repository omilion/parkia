import { z } from 'zod';

export const ticketEntrySchema = z.object({
  plate: z.string().trim().min(1, 'Ingresa la patente').max(12, 'La patente es demasiado larga'),
  space_id: z.coerce.number().int().positive().nullable().optional(),
  branch_id: z.coerce.number().int().positive().optional(),
});
export type TicketEntryValues = z.output<typeof ticketEntrySchema>;
export const ticketLookupSchema = ticketEntrySchema.pick({ plate: true });
export type TicketLookup = z.infer<typeof ticketLookupSchema>;
