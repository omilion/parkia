import { useEffect, useRef, useState } from 'react';
import { Dialog, Button } from '../../../ui';
import { CameraError, extractTicketToken, startQrScan, type QrScan } from './qr';

/** Escanea el QR del ticket de entrada con la cámara y entrega su token. */
export function QrScannerDialog({ open, onClose, onToken }: { open: boolean; onClose: () => void; onToken: (token: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('Apuntando la cámara al código...');
  const handler = useRef(onToken);
  handler.current = onToken;

  useEffect(() => {
    if (!open) return;
    let scan: QrScan | undefined;
    let cancelled = false;
    setError(''); setHint('Apuntando la cámara al código...');
    // El video existe recién después de montar el diálogo.
    const timer = window.setTimeout(() => {
      if (!videoRef.current) return;
      startQrScan(videoRef.current, text => {
        const token = extractTicketToken(text);
        if (!token) { setHint('Ese código no es de un ticket de Parkia. Prueba con otro.'); return false; }
        handler.current(token);
        return true;
      }).then(started => { if (cancelled) started.stop(); else scan = started; })
        .catch(reason => { if (!cancelled) setError(reason instanceof CameraError ? reason.message : 'No se pudo abrir la cámara.'); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); scan?.stop(); };
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title="Escanear QR del ticket">
      <div className="space-y-4">
        {error
          ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-800">{error}</p>
          : <>
            <video ref={videoRef} aria-label="Vista de la cámara" className="aspect-square w-full rounded-xl bg-slate-900 object-cover" playsInline muted />
            <p role="status" className="text-sm text-slate-700">{hint}</p>
          </>}
        <Button variant="secondary" fullWidth onClick={onClose}>Cancelar</Button>
      </div>
    </Dialog>
  );
}
