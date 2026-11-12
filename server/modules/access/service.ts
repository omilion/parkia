import { existsSync } from "fs";
import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import { getCurrentUser } from "../../auth/sessions";
import { getBranchOrDefault } from "../../branches";
import { db } from "../../db";
import { paginatedResponse, parsePagination } from "../../pagination";
import { calculateVisitorTicketQuote, closeCashSession, ensureOpenCashSession, getCashSessionOperationalSummary } from "../../parking";
import { resolveStoredFile, storeDocumentFile } from "../../storage";
import { assertPlanLimit, getTenantIdFromRequest } from "../../tenant";
import {
  applyManualOverrideEffectsInDb,
  clientExistsInTenant,
  completeVisitorExitAndFreeSpace,
  findAccessRateByIdAndTenant,
  findActiveClientVehicleByNormalizedPlate,
  findActiveContractSpaceForClient,
  findDeniedAccessLogById,
  findFirstAvailableSpaceForTenant,
  findLastAccessLogForPlate,
  findSpaceBranchId,
  findVisitorTicketStatusAndBranch,
  insertAccessLogRow,
  occupySpaceAndCreateTotemTicket,
  queryAccessRatesForTenant,
  queryAuditAccessLogs,
  queryLiveAccessLogs,
  spaceExistsInTenant,
  updateAccessRateRow,
} from "./repo";
import {
  findCurrentOpenShiftLogForStaff,
  findDefaultAssigneeByRoleInTenant,
  findExistingOpenShiftLogId,
  findOperationalTaskCategoryStatus,
  findShiftLogById,
  findShiftLogEntryAttachment,
  findShiftLogEntryById,
  insertShiftEntryAttachmentRow,
  insertShiftFollowUpOperationalTask,
  insertShiftLogEntryRow,
  insertShiftLogRow,
  linkCashSessionToShiftLog,
  markShiftLogClosedRow,
  queryEntriesForShiftLog,
  queryShiftFollowUpEntries,
  queryShiftLogsForTenant,
  resolveOrReopenShiftLogEntryInDb,
  touchShiftLogUpdatedAt,
} from "./shifts.repo";

export type ShiftCategory = "access" | "visitor" | "incident" | "maintenance" | "payment" | "handover" | "other";
export type ShiftPriority = "low" | "medium" | "high" | "critical";

export function normalizeShiftLog(row: Record<string, any>) {
  return {
    ...row,
    entries_count: Number(row.entries_count || 0),
    pending_follow_ups: Number(row.pending_follow_ups || 0),
  };
}

export function normalizeShiftEntry(row: Record<string, any>) {
  return {
    ...row,
    follow_up_required: Boolean(row.follow_up_required),
    attachment_count: Number(row.attachment_count || 0),
  };
}

export function parseBranchIdQuery(value: unknown) {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  const branchId = Number(value);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

export async function getAccessBranchId(branchId?: number | null, spaceId?: number | string | null, tenantId?: number | null) {
  return await getBranchOrDefault(branchId || await findSpaceBranchId(spaceId, tenantId), tenantId);
}

const shiftNameLabels: Record<string, string> = {
  morning: "Mañana",
  afternoon: "Tarde",
  night: "Noche",
  custom: "Personalizado",
};

const shiftStatusLabels: Record<string, string> = {
  open: "Abierta",
  closed: "Cerrada",
};

const shiftEntryCategoryLabels: Record<string, string> = {
  access: "Acceso",
  visitor: "Visita",
  incident: "Incidente",
  maintenance: "Mantención",
  payment: "Pago",
  handover: "Traspaso",
  other: "Otro",
};

const shiftPriorityLabels: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

const taskStatusLabels: Record<string, string> = {
  open: "Abierta",
  in_progress: "En curso",
  done: "Cerrada",
  cancelled: "Anulada",
};

function labelFrom(map: Record<string, string>, value: unknown) {
  const key = String(value ?? "");
  return map[key] || key;
}

function mapShiftEntryToTaskCategory(category: ShiftCategory) {
  if (category === "maintenance") return "maintenance";
  if (category === "payment") return "finance";
  if (["access", "visitor", "incident"].includes(category)) return "access";
  return "general";
}

async function getDefaultAssigneeForShiftTask(category: string, currentUserId: number | null | undefined, tenantId: number) {
  if (category === "finance") {
    return await findDefaultAssigneeByRoleInTenant("finance", tenantId);
  }
  if (category === "access" || category === "maintenance") return currentUserId || null;
  return await findDefaultAssigneeByRoleInTenant("admin", tenantId) || currentUserId || null;
}

async function createShiftFollowUpTask(args: {
  entryId: number;
  title: string;
  detail: string | null | undefined;
  category: ShiftCategory;
  priority: ShiftPriority;
  relatedSpaceId?: number | null;
  relatedAccessLogId?: number | null;
  shiftLog: Record<string, any>;
  currentUserId: number | null | undefined;
  tenantId: number;
}) {
  const taskCategory = mapShiftEntryToTaskCategory(args.category);
  const assigneeId = await getDefaultAssigneeForShiftTask(taskCategory, args.currentUserId || null, args.tenantId);
  const taskDescription = [
    args.detail || "Seguimiento registrado desde bitácora de turno.",
    "",
    `Turno: ${args.shiftLog.shift_date} ${args.shiftLog.shift_name}`,
    `Bitácora: #${args.shiftLog.id}`,
    args.category === "payment"
      ? "Origen operacional: Guardia reportó un pendiente de pago. Finanzas debe gestionar esta tarea con el resumen disponible; Admin/Guardia pueden ampliar evidencia de la bitácora si hace falta."
      : null,
    args.relatedSpaceId ? `Espacio relacionado: #${args.relatedSpaceId}` : null,
    args.relatedAccessLogId ? `Acceso relacionado: #${args.relatedAccessLogId}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return await insertShiftFollowUpOperationalTask({
    title: `Seguimiento guardia: ${args.title}`,
    description: taskDescription,
    category: taskCategory,
    priority: args.priority,
    assigneeId,
    branchId: args.shiftLog.branch_id || null,
    entryId: args.entryId,
    dueDate: args.shiftLog.shift_date,
    createdByStaffId: args.currentUserId || null,
    tenantId: args.tenantId,
  });
}

export async function createAccessLogForRequest(
  req: Request,
  body: {
    client_id?: number | null;
    visitor_id?: number | null;
    space_id?: number | null;
    access_type: "entry" | "exit";
    status: "authorized" | "denied";
    method: "fingerprint" | "card" | "qr" | "manual";
    reason?: string | null;
    authorized_by?: string | null;
    branch_id?: number | null;
  },
) {
  const tenantId = await getTenantIdFromRequest(req);
  if (body.client_id && !await clientExistsInTenant(body.client_id, tenantId)) {
    return { status: 404 as const, body: { error: "Cliente no encontrado" } };
  }
  if (body.space_id && !await spaceExistsInTenant(body.space_id, tenantId)) {
    return { status: 404 as const, body: { error: "Espacio no encontrado" } };
  }
  const branchId = await getAccessBranchId(body.branch_id || null, body.space_id, tenantId);
  const id = await insertAccessLogRow({
    clientId: body.client_id ?? null,
    visitorId: body.visitor_id ?? null,
    spaceId: body.space_id ?? null,
    branchId,
    accessType: body.access_type,
    status: body.status,
    method: body.method,
    reason: body.reason ?? null,
    authorizedBy: body.authorized_by ?? null,
    tenantId,
  });
  return { status: 200 as const, body: { success: true as const, id } };
}

export async function processTotemScanForRequest(req: Request, plate: string) {
  const tenantId = await getTenantIdFromRequest(req);
  const normalizedPlate = plate.replace(/-/g, "").toUpperCase();
  const vehicle = await findActiveClientVehicleByNormalizedPlate(normalizedPlate, tenantId);
  const lastAccess = await findLastAccessLogForPlate(normalizedPlate, tenantId);
  const isExit = lastAccess && lastAccess.access_type === "entry";

  if (isExit) {
    if (vehicle) {
      const branchId = await getAccessBranchId(lastAccess.branch_id || null, lastAccess.space_id, tenantId);
      await insertAccessLogRow({
        clientId: vehicle.client_id,
        visitorId: null,
        spaceId: lastAccess.space_id,
        branchId,
        accessType: "exit",
        status: "authorized",
        method: "qr",
        reason: "Salida de cliente",
        authorizedBy: null,
        plate,
        tenantId,
      });
      return { status: 200 as const, body: { success: true, type: "client", message: `Hasta luego ${vehicle.client_name}` } };
    }

    const dbTransaction = db.transaction(async () => {
      const ticket = await findVisitorTicketStatusAndBranch(lastAccess.visitor_id, tenantId);
      const branchId = await getAccessBranchId(ticket?.branch_id || lastAccess.branch_id || null, lastAccess.space_id, tenantId);

      if (ticket && ticket.status !== "paid") {
        const quote = (await calculateVisitorTicketQuote(lastAccess.visitor_id, { tenantId })).quote;
        if (Number(quote.total || 0) > 0) {
          throw new Error(
            `Debe pagar su ticket. Tiempo transcurrido: ${quote.duration_mins} min (Gracia: ${quote.grace_period_mins} min, cobrables: ${quote.billable_mins} min).`,
          );
        }
      }

      await completeVisitorExitAndFreeSpace({
        visitorId: lastAccess.visitor_id,
        spaceId: lastAccess.space_id,
        branchId,
        plate,
        tenantId,
      });
    });

    try {
      await dbTransaction();
      return { status: 200 as const, body: { success: true, type: "visitor", message: "Visita finalizada. Hasta luego." } };
    } catch (e: any) {
      if (String(e.message || "").startsWith("Debe pagar su ticket")) {
        const branchId = await getAccessBranchId(lastAccess.branch_id || null, lastAccess.space_id, tenantId);
        await insertAccessLogRow({
          clientId: null,
          visitorId: lastAccess.visitor_id,
          spaceId: lastAccess.space_id,
          branchId,
          accessType: "exit",
          status: "denied",
          method: "qr",
          reason: "Ticket pendiente de pago",
          authorizedBy: null,
          plate,
          tenantId,
        });
      }
      return { status: 400 as const, body: { error: e.message } };
    }
  }

  if (vehicle) {
    const contract = await findActiveContractSpaceForClient(vehicle.client_id, tenantId);
    const spaceId = contract ? contract.space_id : null;
    const branchId = await getAccessBranchId(contract?.branch_id || null, spaceId, tenantId);

    await insertAccessLogRow({
      clientId: vehicle.client_id,
      visitorId: null,
      spaceId,
      branchId,
      accessType: "entry",
      status: "authorized",
      method: "qr",
      reason: "Lectura de patente",
      authorizedBy: null,
      plate,
      tenantId,
    });

    return { status: 200 as const, body: { success: true, type: "client", message: `Bienvenido ${vehicle.client_name}` } };
  }

  const dbTransaction = db.transaction(async () => {
    const availableSpace = await findFirstAvailableSpaceForTenant(tenantId);
    if (!availableSpace) {
      throw new Error("Estacionamiento lleno. No hay cupos disponibles.");
    }
    const branchId = await getAccessBranchId(availableSpace.branch_id, availableSpace.id, tenantId);
    await assertPlanLimit(req, "tickets");
    return await occupySpaceAndCreateTotemTicket({
      spaceId: availableSpace.id,
      branchId,
      plate,
      tenantId,
    });
  });

  await dbTransaction();
  return { status: 200 as const, body: { success: true, type: "visitor", message: "Ticket de visita generado. Adelante." } };
}

export async function listLiveAccessLogsForRequest(req: Request) {
  const tenantId = await getTenantIdFromRequest(req);
  const rawBranchId = parseBranchIdQuery(req.query.branch_id);
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  return await queryLiveAccessLogs(tenantId, branchId);
}

export async function listAuditAccessLogsForRequest(req: Request) {
  const currentUser = await getCurrentUser(req);
  if (currentUser?.role !== "admin") {
    return { status: 403 as const, body: { error: "Solo administracion puede consultar auditoria historica de accesos" } };
  }

  const tenantId = await getTenantIdFromRequest(req);
  const rawBranchId = parseBranchIdQuery(req.query.branch_id);
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const pagination = parsePagination(req.query as Record<string, unknown>);
  const { logs, total } = await queryAuditAccessLogs({
    tenantId,
    branchId,
    start: req.query.start,
    end: req.query.end,
    type: req.query.type,
    user: req.query.user,
    pageSize: pagination.pageSize,
    offset: pagination.offset,
    paginated: pagination.requested,
  });

  return {
    status: 200 as const,
    body: pagination.requested ? paginatedResponse(logs, total, pagination) : logs,
  };
}

export async function listShiftLogsForRequest(
  req: Request,
  query: { status: "open" | "closed" | "all"; date?: string; branch_id?: number },
) {
  const tenantId = await getTenantIdFromRequest(req);
  const branchId = query.branch_id ? await getBranchOrDefault(query.branch_id, tenantId) : undefined;
  return (await queryShiftLogsForTenant({
    tenantId,
    status: query.status,
    date: query.date,
    branchId,
  })).map(normalizeShiftLog);
}

export async function getCurrentShiftLogForRequest(req: Request) {
  const currentUser = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const rawBranchId = parseBranchIdQuery(req.query.branch_id);
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const log = await findCurrentOpenShiftLogForStaff(currentUser?.id || 0, tenantId, branchId);
  return { shiftLog: log ? normalizeShiftLog(log) : null };
}

export async function listShiftFollowUpsForRequest(
  req: Request,
  query: { status: "open" | "resolved" | "all"; branch_id?: number },
) {
  const tenantId = await getTenantIdFromRequest(req);
  const branchId = query.branch_id ? await getBranchOrDefault(query.branch_id, tenantId) : undefined;
  return (await queryShiftFollowUpEntries({
    tenantId,
    status: query.status,
    branchId,
  })).map(normalizeShiftEntry);
}

export async function buildShiftFollowUpsCsvRowsForRequest(
  req: Request,
  query: { status: "open" | "resolved" | "all"; branch_id?: number },
) {
  const tenantId = await getTenantIdFromRequest(req);
  const branchId = query.branch_id ? await getBranchOrDefault(query.branch_id, tenantId) : undefined;
  const rows = await queryShiftFollowUpEntries({
    tenantId,
    status: query.status,
    branchId,
    forExport: true,
  });

  const columns = [
    ["ID", "id"],
    ["Bitácora", "shift_log_id"],
    ["Fecha turno", "shift_date"],
    ["Turno", "shift_name"],
    ["Estado turno", "shift_status"],
    ["Categoría", "category"],
    ["Prioridad", "priority"],
    ["Título", "title"],
    ["Detalle", "detail"],
    ["Creado el", "created_at"],
    ["Resuelto el", "resolved_at"],
    ["Tarea", "task_id"],
    ["Estado tarea", "task_status"],
    ["Espacio relacionado", "related_space_name"],
    ["Registrado por", "staff_name"],
    ["Responsable turno", "shift_staff_name"],
    ["Sucursal", "branch_name"],
  ] as const;

  return [
    columns.map(([label]) => label),
    ...rows.map((row) =>
      columns.map(([, key]) => {
        if (key === "shift_name") return labelFrom(shiftNameLabels, row[key]);
        if (key === "shift_status") return labelFrom(shiftStatusLabels, row[key]);
        if (key === "category") return labelFrom(shiftEntryCategoryLabels, row[key]);
        if (key === "priority") return labelFrom(shiftPriorityLabels, row[key]);
        if (key === "task_status") return labelFrom(taskStatusLabels, row[key]);
        return row[key];
      }),
    ),
  ];
}

export async function getShiftLogDetailForRequest(req: Request, shiftLogId: string) {
  const tenantId = await getTenantIdFromRequest(req);
  let log = await findShiftLogById(shiftLogId, tenantId);
  if (!log) return null;

  if (log.status === "open" && !log.cash_session_id) {
    const cashSession = await ensureOpenCashSession(await getCurrentUser(req), Number(log.id), {
      branchId: log.branch_id || null,
      tenantId,
    });
    await linkCashSessionToShiftLog({
      shiftLogId: log.id,
      cashSessionId: Number(cashSession.id),
      branchId: log.branch_id || null,
      tenantId,
    });
    log = await findShiftLogById(shiftLogId, tenantId);
    if (!log) return null;
  }

  const entries = (await queryEntriesForShiftLog(shiftLogId, tenantId, false)).map(normalizeShiftEntry);
  const cash = log.cash_session_id ? await getCashSessionOperationalSummary(log.cash_session_id, { tenantId }) : null;

  return { shiftLog: normalizeShiftLog(log), entries, cash };
}

export async function buildShiftLogExportCsvRowsForRequest(req: Request, shiftLogId: string) {
  const tenantId = await getTenantIdFromRequest(req);
  const log = await findShiftLogById(shiftLogId, tenantId);
  if (!log) return null;

  const entries = await queryEntriesForShiftLog(shiftLogId, tenantId, true);
  const rows = [
    ["Sección", "Campo", "Valor"],
    ["Turno", "ID", log.id],
    ["Turno", "Fecha", log.shift_date],
    ["Turno", "Nombre", labelFrom(shiftNameLabels, log.shift_name)],
    ["Turno", "Estado", labelFrom(shiftStatusLabels, log.status)],
    ["Turno", "Sucursal", log.branch_name || ""],
    ["Turno", "Responsable", log.staff_name],
    ["Turno", "Abierto el", log.opened_at],
    ["Turno", "Cerrado el", log.closed_at || ""],
    ["Turno", "Notas de apertura", log.opening_notes || ""],
    ["Turno", "Notas de traspaso", log.handover_notes || ""],
    ["Turno", "Nota de caja", log.cash_count_note || ""],
    [],
    [
      "ID novedad",
      "Categoría",
      "Prioridad",
      "Título",
      "Detalle",
      "Requiere seguimiento",
      "Resuelto el",
      "Creado el",
      "Tarea",
      "Estado tarea",
      "Espacio",
      "Registrado por",
    ],
    ...entries.map((entry) => [
      entry.id,
      labelFrom(shiftEntryCategoryLabels, entry.category),
      labelFrom(shiftPriorityLabels, entry.priority),
      entry.title,
      entry.detail || "",
      entry.follow_up_required ? "Sí" : "No",
      entry.resolved_at || "",
      entry.created_at,
      entry.task_id || "",
      labelFrom(taskStatusLabels, entry.task_status),
      entry.related_space_name || "",
      entry.staff_name || "",
    ]),
  ];

  return { logId: log.id, rows };
}

export async function openOrReuseShiftLogForRequest(
  req: Request,
  body: {
    shift_date?: string;
    shift_name: "morning" | "afternoon" | "night" | "custom";
    opening_notes?: string | null;
    branch_id?: number | null;
  },
) {
  const currentUser = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const branchId = await getBranchOrDefault(body.branch_id || null, tenantId);

  const existing = await findExistingOpenShiftLogId(currentUser?.id || 0, branchId, tenantId);
  if (existing) {
    let shiftLog = await findShiftLogById(existing.id, tenantId);
    if (shiftLog && !shiftLog.cash_session_id) {
      const cashSession = await ensureOpenCashSession(currentUser, Number(existing.id), { branchId, tenantId });
      await linkCashSessionToShiftLog({
        shiftLogId: existing.id,
        cashSessionId: Number(cashSession.id),
        branchId,
        tenantId,
      });
      shiftLog = await findShiftLogById(existing.id, tenantId);
    }
    return { success: true as const, existing: true, shiftLog: shiftLog ? normalizeShiftLog(shiftLog) : null };
  }

  const shiftDate = body.shift_date || new Date().toISOString().slice(0, 10);
  const shiftLogId = await insertShiftLogRow({
    staffId: currentUser?.id || null,
    shiftDate,
    shiftName: body.shift_name,
    openingNotes: body.opening_notes ?? null,
    branchId,
    tenantId,
  });
  const cashSession = await ensureOpenCashSession(currentUser, shiftLogId, { branchId, tenantId });
  await linkCashSessionToShiftLog({
    shiftLogId,
    cashSessionId: Number(cashSession.id),
    branchId,
    tenantId,
  });

  await recordAuditEvent(req, {
    action: "guard_shift_log.opened",
    entityType: "guard_shift_log",
    entityId: shiftLogId,
    metadata: { shift_date: shiftDate, shift_name: body.shift_name, branch_id: branchId, cash_session_id: cashSession.id },
  });

  const shiftLog = await findShiftLogById(shiftLogId, tenantId);
  return { success: true as const, existing: false, shiftLog: shiftLog ? normalizeShiftLog(shiftLog) : null };
}

export async function createShiftLogEntryForRequest(
  req: Request,
  shiftLogId: string,
  body: {
    category: ShiftCategory;
    priority: ShiftPriority;
    title: string;
    detail?: string | null;
    related_space_id?: number | null;
    related_access_log_id?: number | null;
    follow_up_required: boolean;
    attachment?: {
      label?: string | null;
      fileName: string;
      mimeType: "application/pdf" | "image/jpeg" | "image/png";
      dataBase64: string;
    };
  },
) {
  const currentUser = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const shiftLog = await findShiftLogById(shiftLogId, tenantId);
  if (!shiftLog) return { status: 404 as const, body: { error: "Bitácora de turno no encontrada" } };
  if (shiftLog.status !== "open") {
    return { status: 400 as const, body: { error: "No se pueden agregar novedades a un turno cerrado" } };
  }

  const createEntry = db.transaction(async () => {
    const entryId = await insertShiftLogEntryRow({
      shiftLogId,
      staffId: currentUser?.id || null,
      category: body.category,
      priority: body.priority,
      title: body.title,
      detail: body.detail ?? null,
      relatedSpaceId: body.related_space_id ?? null,
      relatedAccessLogId: body.related_access_log_id ?? null,
      followUpRequired: body.follow_up_required,
      tenantId,
    });

    if (body.attachment) {
      const stored = storeDocumentFile({
        fileName: body.attachment.fileName,
        mimeType: body.attachment.mimeType,
        dataBase64: body.attachment.dataBase64,
        folder: "shift-log-evidence",
        tenantId,
      });
      await insertShiftEntryAttachmentRow({
        shiftLogEntryId: entryId,
        staffId: currentUser?.id || null,
        label: body.attachment.label || null,
        filePath: stored.filePath,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        tenantId,
      });
    }

    let taskId: number | null = null;
    if (body.follow_up_required) {
      taskId = await createShiftFollowUpTask({
        entryId,
        title: body.title,
        detail: body.detail,
        category: body.category,
        priority: body.priority,
        relatedSpaceId: body.related_space_id,
        relatedAccessLogId: body.related_access_log_id,
        shiftLog,
        currentUserId: currentUser?.id || null,
        tenantId,
      });
    }

    await touchShiftLogUpdatedAt(shiftLogId, tenantId);
    return { entryId, taskId, attachment: Boolean(body.attachment) };
  });

  const result = await createEntry();

  await recordAuditEvent(req, {
    action: "guard_shift_log.entry_created",
    entityType: "guard_shift_log_entry",
    entityId: result.entryId,
    metadata: {
      shift_log_id: Number(shiftLogId),
      category: body.category,
      priority: body.priority,
      follow_up_required: body.follow_up_required,
      attachment: result.attachment,
    },
  });
  if (result.taskId) {
    await recordAuditEvent(req, {
      action: "operational_task.created",
      entityType: "operational_task",
      entityId: result.taskId,
      metadata: { source_type: "guard_shift_log", source_id: String(result.entryId), title: body.title },
    });
  }

  return { status: 200 as const, body: { success: true as const, id: result.entryId, task_id: result.taskId } };
}

export async function resolveShiftLogEntryAttachmentDownload(
  req: Request,
  entryId: string,
  attachmentId: string,
) {
  const tenantId = await getTenantIdFromRequest(req);
  const attachment = await findShiftLogEntryAttachment(attachmentId, entryId, tenantId);
  if (!attachment) return { status: 404 as const, error: "Evidencia no encontrada" };

  try {
    const absolutePath = resolveStoredFile(attachment.file_path);
    if (!existsSync(absolutePath)) return { status: 404 as const, error: "Archivo no encontrado" };
    return {
      status: 200 as const,
      mimeType: attachment.mime_type,
      fileName: attachment.file_name,
      absolutePath,
    };
  } catch {
    return { status: 400 as const, error: "Ruta de evidencia invalida" };
  }
}

export async function resolveShiftLogEntryForRequest(
  req: Request,
  entryId: string,
  resolved: boolean,
) {
  const tenantId = await getTenantIdFromRequest(req);
  const entry = await findShiftLogEntryById(entryId, tenantId);
  if (!entry) return { status: 404 as const, body: { error: "Novedad de turno no encontrada" } };
  const currentUser = await getCurrentUser(req);

  if (entry.task_id && currentUser?.role === "guard") {
    const linkedTask = await findOperationalTaskCategoryStatus(Number(entry.task_id), tenantId);
    if (linkedTask?.category === "finance" && linkedTask.status !== "done") {
      return {
        status: 403 as const,
        body: { error: "Los pendientes financieros deben cerrarse desde Finanzas o Administracion" },
      };
    }
  }

  await resolveOrReopenShiftLogEntryInDb({
    entryId,
    shiftLogId: Number(entry.shift_log_id),
    taskId: entry.task_id ? Number(entry.task_id) : null,
    resolved,
    tenantId,
  });

  await recordAuditEvent(req, {
    action: resolved ? "guard_shift_log.entry_resolved" : "guard_shift_log.entry_reopened",
    entityType: "guard_shift_log_entry",
    entityId: entryId,
    metadata: { shift_log_id: entry.shift_log_id },
  });
  if (entry.task_id) {
    await recordAuditEvent(req, {
      action: resolved ? "operational_task.completed" : "operational_task.updated",
      entityType: "operational_task",
      entityId: entry.task_id,
      metadata: resolved
        ? { note: "Resuelto desde bitácora de turno", source_type: "guard_shift_log", source_id: String(entry.id) }
        : { status: "open", source_type: "guard_shift_log", source_id: String(entry.id) },
    });
  }

  return { status: 200 as const, body: { success: true as const } };
}

export async function closeShiftLogForRequest(
  req: Request,
  shiftLogId: string,
  body: {
    handover_notes: string;
    cash_count_note?: string | null;
    counted_cash?: number;
    counted_transfer?: number;
    counted_card?: number;
    handover_items: Array<{
      title: string;
      detail?: string | null;
      category: ShiftCategory;
      priority: ShiftPriority;
      related_space_id?: number | null;
      related_access_log_id?: number | null;
    }>;
  },
) {
  const tenantId = await getTenantIdFromRequest(req);
  const shiftLog = await findShiftLogById(shiftLogId, tenantId);
  if (!shiftLog) return { status: 404 as const, body: { error: "Bitácora de turno no encontrada" } };
  if (shiftLog.status === "closed") return { status: 400 as const, body: { error: "El turno ya está cerrado" } };

  const currentUser = await getCurrentUser(req);
  const closeShift = db.transaction(async () => {
    let cashClosure: unknown = null;
    if (shiftLog.cash_session_id) {
      const cashSummary = await getCashSessionOperationalSummary(shiftLog.cash_session_id, { tenantId });
      if (cashSummary.blockers.paidTicketsAwaitingExit > 0) {
        throw new Error(
          `No se puede cerrar el turno: hay ${cashSummary.blockers.paidTicketsAwaitingExit} ticket(s) pagado(s) pendientes de salida.`,
        );
      }
      if (cashSummary.session.status === "open") {
        cashClosure = await closeCashSession({
          req,
          cashSessionId: Number(shiftLog.cash_session_id),
          countedCash: body.counted_cash ?? Number(cashSummary.expectedCash || 0),
          countedTransfer: body.counted_transfer || 0,
          countedCard: body.counted_card || 0,
          notes: body.cash_count_note || null,
          user: currentUser,
        });
      }
    }

    await markShiftLogClosedRow({
      shiftLogId,
      handoverNotes: body.handover_notes,
      cashCountNote: body.cash_count_note ?? null,
      tenantId,
    });

    const handoverItems: Array<{ entryId: number; taskId: number; title: string; category: ShiftCategory; priority: ShiftPriority }> = [];
    for (const item of body.handover_items) {
      const entryId = await insertShiftLogEntryRow({
        shiftLogId,
        staffId: currentUser?.id || null,
        category: item.category,
        priority: item.priority,
        title: item.title,
        detail: item.detail ?? null,
        relatedSpaceId: item.related_space_id ?? null,
        relatedAccessLogId: item.related_access_log_id ?? null,
        followUpRequired: true,
        tenantId,
      });
      const taskId = await createShiftFollowUpTask({
        entryId,
        title: item.title,
        detail: item.detail || "Pendiente estructurado traspasado al siguiente turno.",
        category: item.category,
        priority: item.priority,
        relatedSpaceId: item.related_space_id,
        relatedAccessLogId: item.related_access_log_id,
        shiftLog,
        currentUserId: currentUser?.id || null,
        tenantId,
      });
      handoverItems.push({ entryId, taskId, title: item.title, category: item.category, priority: item.priority });
    }
    return { handoverItems, cashClosure };
  });

  const createdHandoverItems = await closeShift();

  await recordAuditEvent(req, {
    action: "guard_shift_log.closed",
    entityType: "guard_shift_log",
    entityId: shiftLogId,
    metadata: {
      pending_follow_ups: Number(shiftLog.pending_follow_ups || 0) + createdHandoverItems.handoverItems.length,
      handover_items: createdHandoverItems.handoverItems.length,
      cash_session_id: shiftLog.cash_session_id || null,
      cash_closure: createdHandoverItems.cashClosure,
    },
  });
  for (const item of createdHandoverItems.handoverItems) {
    await recordAuditEvent(req, {
      action: "guard_shift_log.handover_item_created",
      entityType: "guard_shift_log_entry",
      entityId: item.entryId,
      metadata: {
        shift_log_id: Number(shiftLogId),
        task_id: item.taskId,
        title: item.title,
        category: item.category,
        priority: item.priority,
      },
    });
    await recordAuditEvent(req, {
      action: "operational_task.created",
      entityType: "operational_task",
      entityId: item.taskId,
      metadata: { source_type: "guard_shift_log", source_id: String(item.entryId), title: item.title },
    });
  }

  const updated = await findShiftLogById(shiftLogId, tenantId);
  return {
    status: 200 as const,
    body: { success: true as const, shiftLog: updated ? normalizeShiftLog(updated) : null },
  };
}

export async function performManualAccessOverrideForRequest(
  req: Request,
  body: {
    space_id: number;
    client_id?: number | null;
    denied_access_log_id?: number | null;
    access_type?: "entry" | "exit";
    reason?: string | null;
    authorized_by?: string | null;
  },
) {
  const currentUser = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const authorizedBy = currentUser?.name || body.authorized_by || "Usuario autenticado";

  const transaction = db.transaction(async () => {
    const deniedLog = body.denied_access_log_id
      ? await findDeniedAccessLogById(body.denied_access_log_id, tenantId)
      : null;
    if (body.denied_access_log_id && !deniedLog) {
      throw new Error("Acceso denegado no encontrado o ya no corresponde");
    }
    if (deniedLog?.resolved_by_access_log_id) {
      throw new Error("El acceso denegado ya fue resuelto");
    }
    if (!deniedLog && !await spaceExistsInTenant(body.space_id, tenantId)) {
      throw new Error("Espacio no encontrado");
    }
    if (body.client_id && !await clientExistsInTenant(body.client_id, tenantId)) {
      throw new Error("Cliente no encontrado");
    }

    const resolvedAccessType = (deniedLog?.access_type || body.access_type || "entry") as "entry" | "exit";
    const resolvedSpaceId = Number(deniedLog?.space_id || body.space_id);
    const resolvedVisitorId = deniedLog?.visitor_id ? Number(deniedLog.visitor_id) : null;
    const resolvedClientId = body.client_id || (deniedLog?.client_id ? Number(deniedLog.client_id) : null);
    const branchId = await getAccessBranchId(deniedLog?.branch_id || null, resolvedSpaceId, tenantId);

    const id = await insertAccessLogRow({
      clientId: resolvedClientId,
      visitorId: resolvedVisitorId,
      spaceId: resolvedSpaceId,
      branchId,
      accessType: resolvedAccessType,
      status: "authorized",
      method: "manual",
      reason: body.reason ?? null,
      authorizedBy,
      plate: deniedLog?.plate || null,
      tenantId,
    });

    await applyManualOverrideEffectsInDb({
      resolvedAccessType,
      resolvedVisitorId,
      resolvedSpaceId,
      deniedLogId: deniedLog?.id ? Number(deniedLog.id) : null,
      newAccessLogId: id,
      reason: body.reason ?? null,
      tenantId,
    });

    return {
      id,
      deniedLogId: deniedLog?.id || null,
      accessType: resolvedAccessType,
      visitorId: resolvedVisitorId,
      spaceId: resolvedSpaceId,
      branchId,
    };
  });

  const result = await transaction();
  await recordAuditEvent(req, {
    action: result.deniedLogId ? "access.denied_resolved_by_override" : "access.manual_override",
    entityType: "access_log",
    entityId: result.id,
    metadata: {
      denied_access_log_id: result.deniedLogId,
      space_id: result.spaceId,
      branch_id: result.branchId,
      access_type: result.accessType,
      visitor_id: result.visitorId,
      reason: body.reason || null,
      device_action: "manual_protocol_no_remote_actuator",
    },
  });

  return {
    success: true as const,
    id: result.id,
    denied_access_log_id: result.deniedLogId,
    access_type: result.accessType,
    manual_only: true as const,
    message: "Autorizacion manual registrada. Accione el acceso fisico segun protocolo operativo.",
  };
}

export async function listAccessRatesForRequest(req: Request) {
  return await queryAccessRatesForTenant(await getTenantIdFromRequest(req));
}

export async function updateAccessRateForRequest(
  req: Request,
  rateId: string,
  body: { rate_per_minute: number; grace_period_mins: number },
) {
  const currentUser = await getCurrentUser(req);
  if (currentUser?.role !== "admin") {
    return { status: 403 as const, body: { error: "Solo administración puede modificar tarifas de acceso" } };
  }

  const tenantId = await getTenantIdFromRequest(req);
  const previous = await findAccessRateByIdAndTenant(rateId, tenantId);
  if (!previous) return { status: 404 as const, body: { error: "Tarifa no encontrada" } };

  await updateAccessRateRow({
    rateId,
    tenantId,
    ratePerMinute: body.rate_per_minute,
    gracePeriodMins: body.grace_period_mins,
  });

  await recordAuditEvent(req, {
    action: "access_rate.updated",
    entityType: "access_rate",
    entityId: rateId,
    metadata: {
      previous,
      next: {
        billing_mode: "per_minute",
        rate_per_minute: body.rate_per_minute,
        rate_per_hour: body.rate_per_minute * 60,
        grace_period_mins: body.grace_period_mins,
      },
    },
  });

  return { status: 200 as const, body: { success: true as const } };
}
