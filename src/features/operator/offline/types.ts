import type { AgreementValidation, PlanCatalogEntry } from '../../../../shared/offline-pricing';
import type { OperatorOperation } from '../../../../shared/schemas/operator';

export type SnapshotTicket = {
  id: number;
  plate: string;
  status: 'active' | 'paid';
  entry_time: string;
  vehicle_type: string;
  rate_plan_id: number | null;
  space_id: number | null;
  space_name: string | null;
  public_token: string | null;
  amount: number;
  paid_at: string | null;
  exit_deadline: string | null;
  validations: AgreementValidation[];
};

/** Lo que `/api/operator/snapshot` entrega para una sucursal. */
export type OperatorSnapshot = {
  server_time: string;
  company?: { name: string; rut: string | null };
  branch: { id: number; name: string; time_zone: string };
  spaces: Array<{ id: number; name: string; status: string }>;
  tickets: SnapshotTicket[];
  plans: PlanCatalogEntry[];
};

export type StoredSnapshot = OperatorSnapshot & { branch_id: number; fetched_at: string };

/**
 * pending  -> guardada en el dispositivo, aun no confirmada por el servidor
 * applied  -> el servidor la aplico; se conserva hasta que una instantanea nueva ya la incluya
 * rejected -> el servidor no pudo aplicarla; una persona debe resolverla
 */
export type LocalOpStatus = 'pending' | 'applied' | 'rejected';

export type LocalOp = {
  /** Orden de creacion (autoincremental): las operaciones se envian en este orden. */
  seq?: number;
  client_uuid: string;
  branch_id: number;
  operation: OperatorOperation;
  status: LocalOpStatus;
  attempts: number;
  created_at: string;
  last_error: string | null;
  code: string | null;
  warnings: string[];
  server_ticket_id: number | null;
  /** Hora del servidor en que se aplico; permite descartar la operacion cuando una instantanea posterior ya la refleja. */
  applied_server_time: string | null;
};

/** Ticket tal como lo ve el operador: instantanea del servidor + operaciones locales aun no reflejadas. */
export type ProjectedTicket = SnapshotTicket & {
  /** Verdadero si hay operaciones de este ticket que el servidor aun no confirma. */
  pending_sync: boolean;
  /** uuid de la entrada cuando el ticket se creo en este dispositivo. */
  entry_uuid: string | null;
};
