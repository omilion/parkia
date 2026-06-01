import type { Express } from "express";
import { accessSync, constants, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import path from "path";
import { verifyPassword } from "../auth/password";
import { requireAnyRole } from "../auth/sessions";
import { db } from "../db";
import { getParkiaEnv, getParkiaSeedDemoSetting } from "../env";
import { getStorageRoot } from "../storage";

function getDirectoryStatus(root: string) {
  try {
    mkdirSync(root, { recursive: true });
    accessSync(root, constants.R_OK | constants.W_OK);
    return { ok: true, path: root, error: null };
  } catch (error: any) {
    return { ok: false, path: root, error: error.message || "Sin acceso de lectura/escritura" };
  }
}

function getStorageStatus() {
  return getDirectoryStatus(getStorageRoot());
}

function getBackupStatus() {
  return getDirectoryStatus(path.resolve(getParkiaEnv("PARKIA_BACKUP_PATH", "TIOLUCHIN_BACKUP_PATH", path.join(process.cwd(), "backups"))));
}

function getLatestBackupInfo(root: string) {
  try {
    const validBackupName = /^(parkia|tioluchin)-.+\.sqlite(\.gz)?$|^parkia-full-.+\.tar\.gz$/;
    const backups = readdirSync(root)
      .filter(fileName => validBackupName.test(fileName))
      .map(fileName => {
        const absolutePath = path.join(root, fileName);
        const stats = statSync(absolutePath);
        return {
          fileName,
          createdAt: stats.mtime,
          sizeBytes: stats.size,
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return backups[0] || null;
  } catch {
    return null;
  }
}

function isConfiguredUrl(value: string) {
  if (!value || value === "MY_APP_URL") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function checkStatus(ok: boolean, isProduction: boolean) {
  if (ok) return "ok";
  return isProduction ? "critical" : "warning";
}

function shouldUseSecureCookie(appUrl: string) {
  const explicit = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;

  try {
    return new URL(appUrl || "").protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

function buildReadinessChecks(
  storageStatus: ReturnType<typeof getDirectoryStatus>,
  backupStatus: ReturnType<typeof getDirectoryStatus>,
) {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const seedDemo = getParkiaSeedDemoSetting() || "auto";
  const appUrl = process.env.APP_URL || "";
  const trustedOrigins = (process.env.TRUSTED_ORIGINS || "").split(",").map(item => item.trim()).filter(Boolean);
  const dbPath = process.env.PARKIA_DB_PATH || process.env.TIOLUCHIN_DB_PATH || "";
  const storagePath = process.env.PARKIA_STORAGE_PATH || process.env.TIOLUCHIN_STORAGE_PATH || "";
  const backupPath = process.env.PARKIA_BACKUP_PATH || process.env.TIOLUCHIN_BACKUP_PATH || "";
  const latestBackup = getLatestBackupInfo(backupStatus.path);
  const latestBackupAgeHours = latestBackup ? Math.round((Date.now() - latestBackup.createdAt.getTime()) / 36_000) / 100 : null;
  const backupFresh = typeof latestBackupAgeHours === "number" && latestBackupAgeHours <= 24;
  const sessionCookieSecure = shouldUseSecureCookie(appUrl);
  const productionBuildExists = existsSync(path.resolve(process.cwd(), "dist", "index.html"));
  const defaultAdmin = db.prepare("SELECT password_hash FROM staff WHERE email = ?").get("admin@parkia.local") as { password_hash: string | null } | undefined;
  const defaultAdminPasswordActive = verifyPassword("admin123", defaultAdmin?.password_hash);
  const activeStaff = db.prepare("SELECT COUNT(*) as count FROM staff WHERE status = 'active'").get() as { count: number };
  const spaces = db.prepare("SELECT COUNT(*) as count FROM spaces").get() as { count: number };
  const companyConfig = db.prepare("SELECT company_name, company_rut, company_address, sii_mode, sii_provider FROM system_config WHERE id = 1").get() as {
    company_name: string | null,
    company_rut: string | null,
    company_address: string | null,
    sii_mode: string | null,
    sii_provider: string | null,
  } | undefined;
  const companyProfileReady = Boolean(companyConfig?.company_name && companyConfig.company_rut && companyConfig.company_address);

  return [
    {
      id: "node-env",
      status: nodeEnv === "production" ? "ok" : "warning",
      label: "Modo de ejecucion",
      message: nodeEnv === "production" ? "NODE_ENV esta en production." : `NODE_ENV esta en ${nodeEnv}.`,
      action: "Definir NODE_ENV=production en el ambiente final.",
    },
    {
      id: "app-url",
      status: checkStatus(isConfiguredUrl(appUrl), isProduction),
      label: "URL publica",
      message: isConfiguredUrl(appUrl) ? "APP_URL configurada." : "APP_URL no esta configurada para produccion.",
      action: "Configurar APP_URL con la URL HTTPS real del sistema.",
    },
    {
      id: "trusted-origins",
      status: "ok",
      label: "Origenes confiables",
      message: trustedOrigins.length > 0 ? `${trustedOrigins.length} origen(es) adicional(es) configurado(s).` : "APP_URL cubre el dominio principal; no hay origenes adicionales.",
      action: "Agregar dominios permitidos separados por coma cuando existan accesos desde otros host.",
    },
    {
      id: "database-path",
      status: checkStatus(Boolean(dbPath && path.isAbsolute(dbPath)), isProduction),
      label: "Ruta de base de datos",
      message: dbPath
        ? (path.isAbsolute(dbPath) ? "PARKIA_DB_PATH configurada como ruta absoluta." : "PARKIA_DB_PATH configurada como ruta relativa.")
        : "Se esta usando la ruta SQLite por defecto.",
      action: "Usar una ruta absoluta en disco persistente para PARKIA_DB_PATH.",
    },
    {
      id: "storage-path",
      status: storageStatus.ok ? checkStatus(Boolean(storagePath && path.isAbsolute(storagePath)), isProduction) : "critical",
      label: "Ruta de archivos",
      message: storageStatus.ok
        ? (storagePath ? "PARKIA_STORAGE_PATH configurada y escribible." : "Se esta usando storage local por defecto.")
        : `Storage sin acceso: ${storageStatus.error}`,
      action: "Usar una ruta absoluta y persistente para PARKIA_STORAGE_PATH.",
    },
    {
      id: "backup-path",
      status: backupStatus.ok ? checkStatus(Boolean(backupPath && path.isAbsolute(backupPath)), isProduction) : "critical",
      label: "Ruta de respaldos",
      message: backupStatus.ok
        ? (backupPath ? "PARKIA_BACKUP_PATH configurada y escribible." : "Se esta usando la carpeta de respaldos por defecto.")
        : `Respaldos sin acceso: ${backupStatus.error}`,
      action: "Usar una ruta absoluta y persistente para PARKIA_BACKUP_PATH.",
    },
    {
      id: "backup-freshness",
      status: backupStatus.ok ? checkStatus(Boolean(latestBackup && backupFresh), isProduction) : "critical",
      label: "Respaldo reciente",
      message: latestBackup
        ? `Ultimo respaldo: ${latestBackup.fileName} hace ${latestBackupAgeHours} hora(s).`
        : "No hay respaldos SQLite registrados.",
      action: "Crear un respaldo diario y verificar su descarga/restauracion antes de operar en produccion.",
    },
    {
      id: "security-headers",
      status: "ok",
      label: "Cabeceras de seguridad",
      message: "CSP, HSTS, frame deny, nosniff y politicas de permisos activas.",
      action: "Mantener dominios externos fuera de la CSP salvo integraciones auditadas.",
    },
    {
      id: "session-cookie-secure",
      status: checkStatus(!isProduction || sessionCookieSecure, isProduction),
      label: "Cookie de sesion segura",
      message: sessionCookieSecure ? "La cookie de sesion se emite con Secure." : "La cookie de sesion no tiene Secure en este ambiente.",
      action: "Usar APP_URL HTTPS o SESSION_COOKIE_SECURE=true en produccion.",
    },
    {
      id: "production-build",
      status: checkStatus(!isProduction || productionBuildExists, isProduction),
      label: "Build frontend",
      message: productionBuildExists ? "dist/index.html existe." : "No se encontro dist/index.html.",
      action: "Ejecutar npm run build antes de iniciar en produccion.",
    },
    {
      id: "company-profile",
      status: companyProfileReady ? "ok" : "warning",
      label: "Datos legales de empresa",
      message: companyProfileReady ? "Razon social, RUT y direccion configurados." : "Faltan datos legales para documentos y operacion formal.",
      action: "Completar razon social, RUT y direccion en Configuracion > General.",
    },
    {
      id: "active-staff",
      status: activeStaff.count > 0 ? "ok" : "critical",
      label: "Usuarios activos",
      message: activeStaff.count > 0 ? `${activeStaff.count} usuario(s) activo(s).` : "No hay usuarios activos para operar el sistema.",
      action: "Crear al menos un usuario admin activo.",
    },
    {
      id: "initial-inventory",
      status: spaces.count > 0 ? "ok" : "warning",
      label: "Inventario inicial",
      message: spaces.count > 0 ? `${spaces.count} espacio(s) configurado(s).` : "Aun no hay estacionamientos cargados.",
      action: "Cargar espacios reales antes de operar contratos y accesos.",
    },
    {
      id: "sii-mode",
      status: ((companyConfig?.sii_mode || "mock") === "real" || (isProduction && (companyConfig?.sii_mode || "mock") === "mock")) ? "critical" : "ok",
      label: "Modo SII",
      message: (companyConfig?.sii_mode || "mock") === "real"
        ? "SII real aun no tiene proveedor implementado."
        : isProduction && (companyConfig?.sii_mode || "mock") === "mock"
          ? "SII mock/local no debe usarse como emision real en produccion."
          : `SII configurado en modo ${companyConfig?.sii_mode || "mock"}.`,
      action: "Usar sii_mode=disabled hasta integrar proveedor real certificado, o sii_mode=mock solo para demo/piloto fuera de produccion.",
    },
    {
      id: "demo-seed",
      status: isProduction && seedDemo === "true" ? "critical" : "ok",
      label: "Datos demo",
      message: isProduction && seedDemo === "true" ? "PARKIA_SEED_DEMO=true no debe usarse en produccion." : "Seed demo no esta forzado en produccion.",
      action: "Definir PARKIA_SEED_DEMO=false en produccion.",
    },
    {
      id: "admin-password",
      status: defaultAdminPasswordActive ? "critical" : "ok",
      label: "Clave admin inicial",
      message: defaultAdminPasswordActive ? "El usuario admin@parkia.local conserva la clave inicial admin123." : "La clave inicial de admin no esta activa.",
      action: "Cambiar la clave del admin inicial o desactivar ese usuario.",
    },
  ];
}

export function registerHealthRoutes(app: Express) {
  app.get("/api/health", (_req, res) => {
    try {
      const dbCheck = db.prepare("SELECT 1 as ok").get() as { ok: number };
      res.status(dbCheck.ok === 1 ? 200 : 503).json({ status: dbCheck.ok === 1 ? "ok" : "degraded" });
    } catch {
      res.status(503).json({ status: "degraded" });
    }
  });

  app.get("/api/health/details", requireAnyRole(["admin"]), (_req, res) => {
    const dbCheck = db.prepare("SELECT 1 as ok").get() as { ok: number };
    const migrationCount = db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get() as { count: number };
    const storageRoot = getStorageStatus();
    const backupRoot = getBackupStatus();
    const readinessChecks = buildReadinessChecks(storageRoot, backupRoot);
    const latestBackup = getLatestBackupInfo(backupRoot.path);

    res.json({
      status: "ok",
      database: {
        ok: dbCheck.ok === 1,
        path: getParkiaEnv("PARKIA_DB_PATH", "TIOLUCHIN_DB_PATH", "parkia.db"),
        migrations: migrationCount.count,
      },
      storage: {
        ok: storageRoot.ok,
        path: storageRoot.path,
        error: storageRoot.error,
      },
      backups: {
        ok: backupRoot.ok,
        path: backupRoot.path,
        error: backupRoot.error,
        latest: latestBackup ? {
          fileName: latestBackup.fileName,
          createdAt: latestBackup.createdAt.toISOString(),
          sizeBytes: latestBackup.sizeBytes,
        } : null,
      },
      runtime: {
        nodeEnv: process.env.NODE_ENV || "development",
        seedDemo: getParkiaSeedDemoSetting() || "auto",
      },
      readiness: {
        productionReady: readinessChecks.every((check) => check.status === "ok"),
        checks: readinessChecks,
      },
    });
  });
}
