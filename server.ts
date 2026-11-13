import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { attachErrorHandler, createApiApp } from "./server/app";
import { startBackgroundJobs } from "./server/platform/jobs";
import { flushErrorReporting, initErrorReporting, reportError } from "./server/platform/http/errorReporting";
import { logStructured } from "./server/platform/http/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Errores que nadie capturó: se registran y reportan. Una promesa rechazada sin manejar no tumba el servidor
// (los jobs aislan sus fallos); una excepcion no capturada deja el proceso en estado dudoso y se reinicia.
process.on("unhandledRejection", reason => {
  logStructured("error", "unhandled rejection", { error: reason instanceof Error ? reason.message : String(reason) });
  reportError(reason, { source: "unhandledRejection" });
});
process.on("uncaughtException", error => {
  logStructured("error", "uncaught exception", { error: error.message, stack: error.stack });
  reportError(error, { source: "uncaughtException" });
  void flushErrorReporting().finally(() => process.exit(1));
});

async function startServer() {
  const app = createApiApp();
  startBackgroundJobs();
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || "0.0.0.0";

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  attachErrorHandler(app);

  app.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}`);
  });

  // Cargar el SDK de Sentry tarda varios segundos: se hace con el servidor ya atendiendo, sin bloquear el arranque.
  void initErrorReporting()
    .then(active => { if (active) logStructured("info", "error reporting enabled (Sentry)"); })
    .catch(error => logStructured("error", "error reporting failed to start", { error: error instanceof Error ? error.message : String(error) }));
}

startServer();
