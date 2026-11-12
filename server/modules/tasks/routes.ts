import { taskCommentFieldsSchema, taskFieldsSchema } from '../../../shared/schemas/tasks';
import type { Express } from "express";
import { z } from "zod";
import { getCurrentUser, requireAnyRole } from "../../auth/sessions";
import { getTenantIdFromRequest } from "../../tenant";
import { dateStringSchema, optionalTextSchema, parseBody } from "../../validation";
import {
  completeTask,
  createTask,
  createTaskComment,
  getTaskComments,
  getTaskHistory,
  getTaskSummary,
  listTaskAssignees,
  listTasks,
  parseBranchIdQuery,
  resolveTaskAttachmentDownload,
  updateTask,
} from "./service";

const taskCategorySchema = taskFieldsSchema.shape.category;
const taskPrioritySchema = taskFieldsSchema.shape.priority;
const taskStatusSchema = z.enum(["open", "in_progress", "done", "cancelled"]);

const taskQuerySchema = z.object({
  status: z.enum(["open", "in_progress", "done", "cancelled", "active", "all"]).optional(),
  category: z.enum(["finance", "access", "documents", "contracts", "maintenance", "general", "all"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical", "all"]).optional(),
  due: z.enum(["today", "overdue", "all"]).optional(),
  assigned: z.enum(["me", "unassigned", "all"]).optional(),
  branch_id: z.coerce.number().int().positive().optional(),
  source: z.enum([
    "dashboard_alert",
    "guard_shift_log",
    "document",
    "finance_approval",
    "finance_payment_adjustment",
    "finance_expense_approval",
    "finance_monthly_close_approval",
    "finance_monthly_reopen_approval",
    "manual",
    "all",
  ]).optional(),
});

const createTaskSchema = z.object({
  title: taskFieldsSchema.shape.title,
  description: optionalTextSchema,
  category: taskCategorySchema.default("general"),
  priority: taskPrioritySchema.default("medium"),
  assigned_staff_id: z.coerce.number().int().positive().optional().nullable(),
  branch_id: z.coerce.number().int().positive().optional().nullable(),
  source_type: optionalTextSchema,
  source_id: optionalTextSchema,
  due_date: dateStringSchema.optional().nullable(),
});

const updateTaskSchema = z.object({
  title: z.string().trim().min(3).max(180).optional(),
  description: optionalTextSchema,
  category: taskCategorySchema.optional(),
  priority: taskPrioritySchema.optional(),
  status: taskStatusSchema.optional(),
  status_note: optionalTextSchema,
  assigned_staff_id: z.coerce.number().int().positive().optional().nullable(),
  branch_id: z.coerce.number().int().positive().optional().nullable(),
  due_date: dateStringSchema.optional().nullable(),
}).partial();

const completeTaskSchema = z.object({
  note: optionalTextSchema,
});

const taskAttachmentSchema = z.object({
  label: optionalTextSchema,
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  dataBase64: z.string().trim().min(1),
});

const createTaskCommentSchema = taskCommentFieldsSchema.extend({
  attachment: taskAttachmentSchema.optional(),
});

export function registerTasksRoutes(app: Express) {
  app.use("/api/tasks", requireAnyRole(["admin", "finance", "guard", "cashier"]));

  app.get("/api/tasks/assignees", (req, res) => {
    const tenantId = getTenantIdFromRequest(req);
    res.json(listTaskAssignees(tenantId));
  });

  app.get("/api/tasks/summary", (req, res) => {
    const currentUser = getCurrentUser(req);
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    res.json(getTaskSummary(currentUser, tenantId, rawBranchId));
  });

  app.get("/api/tasks", (req, res) => {
    const currentUser = getCurrentUser(req);
    const tenantId = getTenantIdFromRequest(req);
    const query = taskQuerySchema.safeParse({
      status: req.query.status || undefined,
      category: req.query.category || undefined,
      priority: req.query.priority || undefined,
      due: req.query.due || undefined,
      assigned: req.query.assigned || undefined,
      branch_id: req.query.branch_id || undefined,
      source: req.query.source || undefined,
    });
    if (!query.success) return res.status(400).json({ error: "Filtros de tareas inválidos" });

    res.json(listTasks(query.data, currentUser, tenantId));
  });

  app.get("/api/tasks/:id/history", (req, res) => {
    const currentUser = getCurrentUser(req);
    const tenantId = getTenantIdFromRequest(req);
    const result = getTaskHistory(req.params.id, currentUser, tenantId);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json(result.events);
  });

  app.get("/api/tasks/:id/comments", (req, res) => {
    const currentUser = getCurrentUser(req);
    const tenantId = getTenantIdFromRequest(req);
    const result = getTaskComments(req.params.id, currentUser, tenantId);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json(result.comments);
  });

  app.post("/api/tasks/:id/comments", (req, res) => {
    const body = parseBody(createTaskCommentSchema, req.body, res);
    if (!body) return;
    const result = createTaskComment(req, req.params.id, body);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true, id: result.id });
  });

  app.get("/api/tasks/:taskId/attachments/:attachmentId/download", (req, res) => {
    const currentUser = getCurrentUser(req);
    const tenantId = getTenantIdFromRequest(req);
    const result = resolveTaskAttachmentDownload(req.params.taskId, req.params.attachmentId, currentUser, tenantId);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.type(result.mimeType);
    res.download(result.absolutePath, result.fileName);
  });

  app.post("/api/tasks", (req, res) => {
    const body = parseBody(createTaskSchema, req.body, res);
    if (!body) return;
    const result = createTask(req, body);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true, task: result.task });
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const body = parseBody(updateTaskSchema, req.body, res);
    if (!body) return;
    const result = updateTask(req, req.params.id, body);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true, task: result.task });
  });

  app.post("/api/tasks/:id/complete", (req, res) => {
    const body = parseBody(completeTaskSchema, req.body, res);
    if (!body) return;
    const result = completeTask(req, req.params.id, body.note);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true, task: result.task });
  });
}
