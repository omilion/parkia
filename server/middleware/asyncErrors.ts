import { createRequire } from "node:module";

/**
 * Express 4 no captura las promesas rechazadas de los manejadores async: la peticion quedaria
 * colgada y el error sin registrar. Este parche hace que un manejador async que falla llame a
 * next(error), igual que uno sincrono que lanza, para que responda el manejador de errores.
 * Se aplica una sola vez al importar este modulo.
 */
const require = createRequire(import.meta.url);
const Layer = require("express/lib/router/layer.js") as { prototype: { handle_request: Function; __parkiaAsync?: boolean } };

if (!Layer.prototype.__parkiaAsync) {
  Layer.prototype.__parkiaAsync = true;
  Layer.prototype.handle_request = function handleRequest(this: { handle: Function }, req: unknown, res: unknown, next: (error?: unknown) => void) {
    const handler = this.handle;
    // Los manejadores de error tienen 4 argumentos y se invocan por otra via.
    if (handler.length > 3) return next();
    try {
      const result = handler(req, res, next);
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
}

export {};
