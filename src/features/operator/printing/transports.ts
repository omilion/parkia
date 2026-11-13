/**
 * Transportes hacia una impresora térmica: Bluetooth de baja energía (Web Bluetooth) y USB (WebUSB).
 * Ambos exigen que el usuario elija el dispositivo con un gesto (un toque): el navegador no deja conectarse solo.
 * Web Bluetooth/WebUSB existen en Chrome y Edge (Android y escritorio); iPhone/Safari no los tiene y usa la impresión del sistema.
 */

export interface PrinterTransport {
  readonly kind: 'bluetooth' | 'usb';
  readonly name: string;
  write(data: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
  /** Se invoca si el dispositivo se desconecta solo (se apagó, salió de rango). */
  onDisconnect?: () => void;
}

export class PrinterConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrinterConnectionError';
  }
}

// ------------------------------------------------------------------ Bluetooth
/** Servicios que usan las térmicas BLE más comunes (Epson/Xprinter/Goojprt/MPT y compatibles). */
export const BLE_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
] as const;

const BLE_CHUNK = 100;
const BLE_DELAY_MS = 15;

type BleCharacteristic = { properties: { write: boolean; writeWithoutResponse: boolean }; writeValueWithResponse?(value: BufferSource): Promise<void>; writeValueWithoutResponse?(value: BufferSource): Promise<void> };
type BleDevice = { name?: string; gatt?: { connect(): Promise<{ getPrimaryServices(): Promise<Array<{ getCharacteristics(): Promise<BleCharacteristic[]> }>>; connected: boolean }> ; disconnect(): void; connected: boolean }; addEventListener(type: string, listener: () => void): void };
type BluetoothApi = { requestDevice(options: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BleDevice> };

export const bluetoothSupported = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

export async function connectBluetooth(api: BluetoothApi | undefined = (navigator as unknown as { bluetooth?: BluetoothApi }).bluetooth, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): Promise<PrinterTransport> {
  if (!api) throw new PrinterConnectionError('Este navegador no permite Bluetooth. Usa Chrome en Android o la impresión del sistema.');
  const device = await api.requestDevice({ acceptAllDevices: true, optionalServices: [...BLE_PRINTER_SERVICES] });
  if (!device.gatt) throw new PrinterConnectionError('El dispositivo no admite conexión Bluetooth de baja energía.');
  const server = await device.gatt.connect();

  let characteristic: BleCharacteristic | undefined;
  for (const service of await server.getPrimaryServices()) {
    characteristic = (await service.getCharacteristics()).find(item => item.properties.write || item.properties.writeWithoutResponse);
    if (characteristic) break;
  }
  if (!characteristic) {
    device.gatt.disconnect();
    throw new PrinterConnectionError('No se encontró un canal de impresión en el dispositivo. ¿Es una impresora térmica compatible?');
  }
  const channel = characteristic;

  const transport: PrinterTransport = {
    kind: 'bluetooth',
    name: device.name || 'Impresora Bluetooth',
    async write(data) {
      if (!device.gatt?.connected) throw new PrinterConnectionError('La impresora se desconectó.');
      for (let offset = 0; offset < data.length; offset += BLE_CHUNK) {
        const chunk = data.slice(offset, offset + BLE_CHUNK);
        if (channel.properties.writeWithoutResponse && channel.writeValueWithoutResponse) await channel.writeValueWithoutResponse(chunk);
        else await channel.writeValueWithResponse!(chunk);
        await sleep(BLE_DELAY_MS); // sin pausa, las térmicas baratas pierden bytes
      }
    },
    async disconnect() { device.gatt?.disconnect(); },
  };
  device.addEventListener('gattserverdisconnected', () => transport.onDisconnect?.());
  return transport;
}

// ------------------------------------------------------------------ USB
type UsbEndpoint = { direction: 'in' | 'out'; endpointNumber: number };
type UsbInterface = { interfaceNumber: number; alternates: Array<{ interfaceClass: number; endpoints: UsbEndpoint[] }> };
type UsbDevice = {
  productName?: string; vendorId: number; productId: number; opened: boolean; configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(value: number): Promise<void>; claimInterface(value: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string }>;
};
type UsbApi = { requestDevice(options: { filters: unknown[] }): Promise<UsbDevice>; getDevices(): Promise<UsbDevice[]> };

export const usbSupported = () => typeof navigator !== 'undefined' && 'usb' in navigator;
const USB_CHUNK = 16 * 1024;
const PRINTER_CLASS = 7;

async function openUsbDevice(device: UsbDevice): Promise<PrinterTransport> {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  // Preferimos la interfaz de clase "impresora"; si no hay, la primera que tenga salida de datos.
  const candidates = (device.configuration?.interfaces ?? []).flatMap(item => item.alternates.map(alt => ({ item, alt })));
  const found = candidates.find(({ alt }) => alt.interfaceClass === PRINTER_CLASS && alt.endpoints.some(e => e.direction === 'out'))
    ?? candidates.find(({ alt }) => alt.endpoints.some(e => e.direction === 'out'));
  const endpoint = found?.alt.endpoints.find(e => e.direction === 'out');
  if (!found || !endpoint) throw new PrinterConnectionError('El dispositivo USB no tiene un canal de impresión.');
  await device.claimInterface(found.item.interfaceNumber);

  return {
    kind: 'usb',
    name: device.productName || 'Impresora USB',
    async write(data) {
      for (let offset = 0; offset < data.length; offset += USB_CHUNK) {
        const result = await device.transferOut(endpoint.endpointNumber, data.slice(offset, offset + USB_CHUNK));
        if (result.status !== 'ok') throw new PrinterConnectionError('La impresora USB no aceptó los datos.');
      }
    },
    async disconnect() { await device.close().catch(() => undefined); },
  };
}

export async function connectUsb(api: UsbApi | undefined = (navigator as unknown as { usb?: UsbApi }).usb): Promise<PrinterTransport & { vendorId: number; productId: number }> {
  if (!api) throw new PrinterConnectionError('Este navegador no permite USB. Usa Chrome o Edge, o la impresión del sistema.');
  const device = await api.requestDevice({ filters: [] });
  return { ...(await openUsbDevice(device)), vendorId: device.vendorId, productId: device.productId };
}

/** Reconecta sin diálogo una impresora USB que el usuario ya autorizó antes. */
export async function reconnectUsb(vendorId: number, productId: number, api: UsbApi | undefined = (navigator as unknown as { usb?: UsbApi }).usb) {
  if (!api) return null;
  const device = (await api.getDevices()).find(item => item.vendorId === vendorId && item.productId === productId);
  return device ? await openUsbDevice(device).catch(() => null) : null;
}
