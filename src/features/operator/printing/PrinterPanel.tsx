import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { Button, Dialog, Field, Select } from '../../../ui';
import type { ReceiptDocument } from './document';
import { usePrinter } from './printer';
import { bluetoothSupported, usbSupported } from './transports';

/** Conexión y preferencias de la impresora del dispositivo. */
export function PrinterPanel({ open, onClose, sampleDocument }: { open: boolean; onClose: () => void; sampleDocument: ReceiptDocument }) {
  const { state, printer } = usePrinter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) void printer.reconnect(); }, [open, printer]);

  const test = async () => {
    setBusy(true); setMessage('');
    try {
      const result = await printer.print(sampleDocument);
      setMessage(result.method === 'thermal' ? 'Prueba enviada a la impresora.' : (result.note ?? 'Se abrió la impresión del sistema.'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo imprimir la prueba');
    } finally { setBusy(false); }
  };

  const ble = bluetoothSupported();
  const usb = usbSupported();
  return (
    <Dialog open={open} onClose={onClose} title="Impresora de tickets">
      <div className="space-y-4">
        <p role="status" className={`rounded-xl p-3 text-sm font-medium ${state.connected ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-50 text-slate-700'}`}>
          {state.connected ? `Conectada: ${state.name}` : 'Sin impresora térmica conectada. Los tickets se imprimen con la impresión del sistema.'}
        </p>
        {state.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">{state.error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { void printer.connect('bluetooth'); }} disabled={!ble || state.connected}>Conectar por Bluetooth</Button>
          <Button variant="secondary" onClick={() => { void printer.connect('usb'); }} disabled={!usb || state.connected}>Conectar por USB</Button>
          {state.connected && <Button variant="ghost" onClick={() => { void printer.disconnect(); }}>Desconectar</Button>}
        </div>
        {!ble && !usb && <p className="text-sm text-slate-600">Este navegador no permite conectar impresoras térmicas (iPhone/Safari). Usa Chrome en Android o un computador, o imprime con el diálogo del sistema.</p>}
        <Field label="Ancho del papel" htmlFor="printer-paper">
          <Select id="printer-paper" value={String(state.prefs.paper)} onChange={event => printer.setPrefs({ paper: event.target.value === '58' ? 58 : 80 })}>
            <option value="80">80 mm</option>
            <option value="58">58 mm</option>
          </Select>
        </Field>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-800">
          <input type="checkbox" className="h-5 w-5" checked={state.prefs.autoPrint} onChange={event => printer.setPrefs({ autoPrint: event.target.checked })} />
          Imprimir automáticamente al registrar entradas y pagos (con impresora conectada)
        </label>
        {message && <p role="status" className="text-sm font-medium text-slate-800">{message}</p>}
        <Button variant="brand" fullWidth loading={busy} onClick={test} icon={<Printer aria-hidden="true" className="h-4 w-4" />}>Imprimir prueba</Button>
      </div>
    </Dialog>
  );
}
