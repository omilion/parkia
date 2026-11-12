import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient, QueryResult } from "pg";

/**
 * Envuelve una instancia de PGlite (PostgreSQL 16 embebido) con la interfaz de
 * `pg.Pool` (`query`, `connect`, `end`), permitiendo ejecutar `withTenantIdTx`,
 * `assertCatalogRlsCoverage` y `migrateSqliteToPg` sin depender de un servidor
 * Docker externo durante los tests.
 */
export function createPglitePoolAdapter(pg: PGlite, options?: { role?: string }): Pool {
  const defaultRole = options?.role;

  const executeQuery = async (
    text: string,
    values?: unknown[],
    rowMode?: "array" | "object",
  ): Promise<QueryResult<any>> => {
    if (!values || values.length === 0) {
      const results = await pg.exec(text, { rowMode: rowMode || "object" });
      const last = results[results.length - 1] || { rows: [], fields: [], affectedRows: 0 };
      return {
        rows: last.rows as any[],
        rowCount: last.affectedRows ?? last.rows.length,
        command: "",
        oid: 0,
        fields: (last.fields || []).map((f) => ({
          name: f.name,
          tableID: 0,
          columnID: 0,
          dataTypeID: f.dataTypeID,
          dataTypeSize: -1,
          dataTypeModifier: -1,
          format: "text",
        })),
      };
    }
    const res = await pg.query(text, values as any[], { rowMode: rowMode || "object" });
    return {
      rows: res.rows as any[],
      rowCount: res.affectedRows ?? res.rows.length,
      command: "",
      oid: 0,
      fields: (res.fields || []).map((f) => ({
        name: f.name,
        tableID: 0,
        columnID: 0,
        dataTypeID: f.dataTypeID,
        dataTypeSize: -1,
        dataTypeModifier: -1,
        format: "text",
      })),
    };
  };

  const clientAdapter: Partial<PoolClient> = {
    query: (async (queryTextOrConfig: any, values?: any) => {
      if (typeof queryTextOrConfig === "string") {
        const res = await executeQuery(queryTextOrConfig, values);
        if (defaultRole && /^\s*BEGIN\b/i.test(queryTextOrConfig)) {
          await pg.exec(`SET LOCAL ROLE ${defaultRole}`);
        }
        return res;
      }
      const configValues = Array.isArray(values) ? values : queryTextOrConfig.values;
      const res = await executeQuery(queryTextOrConfig.text, configValues, queryTextOrConfig.rowMode);
      if (defaultRole && /^\s*BEGIN\b/i.test(queryTextOrConfig.text)) {
        await pg.exec(`SET LOCAL ROLE ${defaultRole}`);
      }
      return res;
    }) as any,
    release: () => {},
  };

  const poolAdapter: Partial<Pool> = {
    query: clientAdapter.query as any,
    connect: (async () => clientAdapter as PoolClient) as any,
    end: (async () => {}) as any,
  };

  return poolAdapter as Pool;
}

