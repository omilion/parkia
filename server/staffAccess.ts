import type { Request } from "express";
import { db } from "./db";

type StaffAccessEventType =
  | "login"
  | "logout"
  | "password_changed"
  | "password_reset"
  | "status_changed"
  | "profile_updated"
  | "role_changed";

type StaffAccessEventInput = {
  staffId: number;
  eventType: StaffAccessEventType;
  metadata?: Record<string, unknown>;
};

export function recordStaffAccessEvent(req: Request, input: StaffAccessEventInput) {
  db.prepare(`
    INSERT INTO staff_access_events (staff_id, event_type, ip_address, user_agent, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    input.staffId,
    input.eventType,
    req.ip || req.socket.remoteAddress || null,
    req.headers["user-agent"] || null,
    input.metadata ? JSON.stringify(input.metadata) : null
  );
}
