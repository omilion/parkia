import { useSyncExternalStore } from 'react';
import type { ReceiptDocument } from './document';
import { renderEscPos, type PaperWidth } from './escpos';
import { printHtml, renderReceiptHtml } from './html';
import { connectBluetooth, connectUsb, reconnectUsb, type PrinterTransport } from './transports';

/**
 * Administra la impresora del dispositivo: conexión Bluetooth/USB, preferencias (ancho de papel, impresión
 * automática) y la impresión misma. Si la térmica no está conectada o falla a mitad de camino, el ticket se
 * imprime igual con el diálogo del sistema: un ticket de entrada nunca debe quedar sin imprimir por un cable.
 */

const STORAGE_KEY = 'parkia.printer';

export type PrinterPrefs = {
  paper: PaperWidth;
  autoPrint: boolean;
  usb: { vendorId: number; productId: number } | null;
};

export type PrinterState = {
  prefs: PrinterPrefs;
  connected: boolean;
  name: string | null;
  kind: PrinterTransport['kind'] | null;
  error: string | null;
};

export type PrintResult = { method: 'thermal' | 'browser'; note?: string };

type Deps = {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  render: (doc: ReceiptDocument, paper: PaperWidth) => Promise<Uint8Array>;
  printBrowser: (doc: ReceiptDocument, paper: PaperWidth) => Promise<void>;
};

const defaultDeps = (): Deps => ({
  storage: typeof localStorage === 'undefined' ? null : localStorage,
  render: (doc, paper) => renderEscPos(doc, { paper }),
  printBrowser: async (doc, paper) => printHtml(await renderReceiptHtml(doc, paper)),
});

const DEFAULT_PREFS: PrinterPrefs = { paper: 80, autoPrint: true, usb: null };

export class PrinterManager {
  private transport: PrinterTransport | null = null;
  private listeners = new Set<() => void>();
  private state: PrinterState;

  constructor(private readonly deps: Deps = defaultDeps()) {
    this.state = { prefs: this.loadPrefs(), connected: false, name: null, kind: null, error: null };
  }

  private loadPrefs(): PrinterPrefs {
    try {
      const stored = JSON.parse(this.deps.storage?.getItem(STORAGE_KEY) || 'null');
      if (stored && (stored.paper === 58 || stored.paper === 80)) return { ...DEFAULT_PREFS, ...stored };
    } catch { /* preferencias dañadas: se usan las de fábrica */ }
    return { ...DEFAULT_PREFS };
  }

  private set(patch: Partial<PrinterState>) {
    this.state = { ...this.state, ...patch };
    try { this.deps.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state.prefs)); } catch { /* sin almacenamiento */ }
    this.listeners.forEach(listener => listener());
  }

  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  setPrefs(patch: Partial<PrinterPrefs>) { this.set({ prefs: { ...this.state.prefs, ...patch } }); }

  /** Adopta un transporte ya conectado (lo usan `connect`, `reconnect` y las pruebas). */
  useTransport(transport: PrinterTransport, usb: PrinterPrefs['usb'] = this.state.prefs.usb) {
    this.transport = transport;
    transport.onDisconnect = () => { this.transport = null; this.set({ connected: false, name: null, kind: null, error: 'La impresora se desconectó.' }); };
    this.set({ connected: true, name: transport.name, kind: transport.kind, error: null, prefs: { ...this.state.prefs, usb } });
  }

  async connect(kind: 'bluetooth' | 'usb') {
    try {
      if (kind === 'bluetooth') this.useTransport(await connectBluetooth());
      else { const usb = await connectUsb(); this.useTransport(usb, { vendorId: usb.vendorId, productId: usb.productId }); }
    } catch (error) {
      // Cerrar el selector del navegador sin elegir nada no es un error que mostrar.
      const cancelled = (error as { name?: string })?.name === 'NotFoundError';
      this.set({ error: cancelled ? null : (error instanceof Error ? error.message : 'No se pudo conectar la impresora') });
    }
  }

  /** Reconecta sola una impresora USB ya autorizada (al abrir la pantalla). Bluetooth siempre pide elegir. */
  async reconnect() {
    const usb = this.state.prefs.usb;
    if (this.transport || !usb) return;
    const transport = await reconnectUsb(usb.vendorId, usb.productId);
    if (transport) this.useTransport(transport);
  }

  async disconnect() {
    const transport = this.transport;
    this.transport = null;
    await transport?.disconnect().catch(() => undefined);
    this.set({ connected: false, name: null, kind: null });
  }

  async print(doc: ReceiptDocument): Promise<PrintResult> {
    const { paper } = this.state.prefs;
    let note: string | undefined;
    if (this.transport) {
      try {
        await this.transport.write(await this.deps.render(doc, paper));
        return { method: 'thermal' };
      } catch {
        this.transport = null;
        note = 'La impresora térmica no respondió: se abrió la impresión del sistema.';
        this.set({ connected: false, name: null, kind: null, error: 'La impresora no respondió.' });
      }
    }
    await this.deps.printBrowser(doc, paper);
    return { method: 'browser', note };
  }

  /** Impresión automática: solo si hay una térmica conectada y el usuario la dejó activada (nunca abre diálogos solo). */
  async autoPrint(doc: ReceiptDocument): Promise<PrintResult | null> {
    if (!this.state.prefs.autoPrint || !this.transport) return null;
    return await this.print(doc);
  }
}

export const printer = new PrinterManager();

export function usePrinter() {
  const state = useSyncExternalStore(printer.subscribe, printer.getState, printer.getState);
  return { state, printer };
}
