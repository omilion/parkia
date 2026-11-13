import { z } from 'zod';
import { vehicleTypes } from './pricing';
import { ticketEntrySchema } from './tickets';

/**
 * Operaciones que el dispositivo del operador guarda sin conexión y envía luego al servidor.
 * Cada una lleva un `client_uuid` (idempotencia) y la hora del dispositivo (`occurred_at`).
 */

export const TICKET_TOKEN_PATTERN = /^t_[A-Za-z0-9_-]{20,48}$/;

const base = {
  client_uuid: z.string().uuid(),
  occurred_at: z.string().datetime({ offset: true }),
};

/** Un ticket se referencia por su id, o por el uuid de la entrada si ésta también se creó sin conexión. */
export const ticketRefSchema = z.object({
  id: z.number().int().positive().optional(),
  entry_uuid: z.string().uuid().optional(),
}).refine(value => (value.id === undefined) !== (value.entry_uuid === undefined), { message: 'Indica el id del ticket o el uuid de su entrada' });

export const entryOperationSchema = z.object({
  ...base,
  type: z.literal('entry'),
  plate: ticketEntrySchema.shape.plate,
  vehicle_type: z.enum(vehicleTypes).default('car'),
  branch_id: z.number().int().positive(),
  /** Token del QR de pago generado en el dispositivo para imprimirlo en el ticket antes de tener red. */
  public_token: z.string().regex(TICKET_TOKEN_PATTERN).optional(),
});

export const paymentOperationSchema = z.object({
  ...base,
  type: z.literal('payment'),
  ticket: ticketRefSchema,
  /** Sin conexión solo se acepta efectivo: la tarjeta necesita a la pasarela. */
  method: z.literal('cash'),
  amount: z.number().int().min(0),
});

export const exitOperationSchema = z.object({
  ...base,
  type: z.literal('exit'),
  ticket: ticketRefSchema,
});

export const operatorOperationSchema = z.discriminatedUnion('type', [entryOperationSchema, paymentOperationSchema, exitOperationSchema]);
export type OperatorOperation = z.output<typeof operatorOperationSchema>;
export type EntryOperation = z.output<typeof entryOperationSchema>;
export type PaymentOperation = z.output<typeof paymentOperationSchema>;
export type ExitOperation = z.output<typeof exitOperationSchema>;

export const syncRequestSchema = z.object({
  operations: z.array(operatorOperationSchema).min(1).max(100),
});

export type OperationStatus = 'applied' | 'duplicate' | 'rejected';
export type OperationResult = {
  client_uuid: string;
  type: OperatorOperation['type'];
  status: OperationStatus;
  /** Estado con que se aplicó por primera vez (relevante cuando `status` es `duplicate`). */
  original_status?: 'applied' | 'rejected';
  ticket_id: number | null;
  /** Token del QR efectivo del ticket (si el servidor tuvo que reemplazar el del dispositivo). */
  public_token?: string;
  code?: string;
  error?: string;
  warnings: string[];
};
