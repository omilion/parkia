import type { LocalOp, ProjectedTicket, SnapshotTicket } from './types';

const sqlTime = (iso: string) => new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
const normalizePlate = (plate: string) => plate.replace(/[\s-]/g, '').toUpperCase();

/**
 * Estado que ve el operador: la instantánea del servidor más las operaciones locales que el servidor
 * todavía no refleja. Es una función pura: la misma entrada siempre da la misma lista.
 *
 *  - entrada  -> aparece un ticket nuevo (con id negativo si aún no existe en el servidor)
 *  - cobro    -> el ticket queda pagado
 *  - salida   -> el ticket desaparece
 * Las operaciones rechazadas no se proyectan: el servidor no las aplicó.
 */
export function projectTickets(snapshotTickets: SnapshotTicket[], ops: LocalOp[]): ProjectedTicket[] {
  const tickets = new Map<string, ProjectedTicket>();
  const key = (ticket: { id: number }) => `id:${ticket.id}`;
  const byEntryUuid = new Map<string, string>();
  const tokens = new Set<string>();

  for (const ticket of snapshotTickets) {
    tickets.set(key(ticket), { ...ticket, pending_sync: false, entry_uuid: null });
    if (ticket.public_token) tokens.add(ticket.public_token);
  }

  const find = (ref: { id?: number; entry_uuid?: string }) => {
    if (ref.entry_uuid) {
      const mapped = byEntryUuid.get(ref.entry_uuid);
      return mapped ? tickets.get(mapped) : undefined;
    }
    return ref.id === undefined ? undefined : tickets.get(`id:${ref.id}`);
  };

  const live = ops.filter(op => op.status !== 'rejected').sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const op of live) {
    const pending = op.status === 'pending';
    const operation = op.operation;
    if (operation.type === 'entry') {
      const token = operation.public_token ?? null;
      // La instantánea ya trae este ticket (se aplicó y se descargó de nuevo): no se duplica.
      if (op.status === 'applied' && token && tokens.has(token)) {
        const existing = [...tickets.values()].find(ticket => ticket.public_token === token);
        if (existing) byEntryUuid.set(operation.client_uuid, key(existing));
        continue;
      }
      if (op.status === 'applied' && op.server_ticket_id && tickets.has(`id:${op.server_ticket_id}`)) {
        byEntryUuid.set(operation.client_uuid, `id:${op.server_ticket_id}`);
        continue;
      }
      const id = op.server_ticket_id ?? -(op.seq ?? 1);
      const ticket: ProjectedTicket = {
        id, plate: normalizePlate(operation.plate), status: 'active', entry_time: sqlTime(operation.occurred_at),
        vehicle_type: operation.vehicle_type, rate_plan_id: null, space_id: null, space_name: null,
        public_token: token, amount: 0, paid_at: null, exit_deadline: null, validations: [],
        pending_sync: pending, entry_uuid: operation.client_uuid,
      };
      tickets.set(key(ticket), ticket);
      byEntryUuid.set(operation.client_uuid, key(ticket));
      if (token) tokens.add(token);
    } else if (operation.type === 'payment') {
      const ticket = find(operation.ticket);
      if (!ticket) continue;
      ticket.status = 'paid';
      ticket.amount = operation.amount;
      ticket.paid_at = sqlTime(operation.occurred_at);
      ticket.pending_sync ||= pending;
    } else {
      const ticket = find(operation.ticket);
      if (ticket) tickets.delete(key(ticket));
    }
  }
  return [...tickets.values()].sort((a, b) => b.entry_time.localeCompare(a.entry_time));
}

/** Busca por patente (sin espacios ni guiones), exacta primero y luego por coincidencia parcial. */
export function findTicketByPlate(tickets: ProjectedTicket[], plate: string) {
  const wanted = normalizePlate(plate);
  if (!wanted) return undefined;
  return tickets.find(ticket => normalizePlate(ticket.plate) === wanted) ?? tickets.find(ticket => normalizePlate(ticket.plate).includes(wanted));
}
