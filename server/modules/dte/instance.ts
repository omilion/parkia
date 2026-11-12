import { db } from "../../db";
import { createDteService } from "./service";

/** Servicio DTE conectado a la base de datos real. Las pruebas crean el suyo con una base en memoria. */
export const dteService = createDteService({ db });
