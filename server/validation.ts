import type { Response } from "express";
import { z } from "zod";

export function parseBody<T>(schema: z.Schema<T>, body: unknown, res: Response): T | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  res.status(400).json({
    error: "Invalid request body",
    details: result.error.issues.map(issue => ({
      field: issue.path.join("."),
      message: issue.message,
    })),
  });
  return null;
}

export const idParamSchema = z.coerce.number().int().positive();

export const optionalTextSchema = z.preprocess(
  value => value === "" ? null : value,
  z.string().trim().nullable().optional()
);

export const dateStringSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
