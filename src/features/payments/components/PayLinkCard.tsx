import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, QrCode } from 'lucide-react';
import { apiFetchJson } from '../../../lib/api';
import { Button } from '../../../ui';

type LinkResponse = { url: string; token: string };

/**
 * Genera y muestra el enlace de pago (con QR) de un ticket o de una cuota de abonado.
 * El cliente lo abre en su teléfono, ve el monto y paga en línea.
 */
export function PayLinkCard({ url, method = 'GET', label = 'Cobro en línea (QR)', disabled }: { url: string; method?: 'GET' | 'POST'; label?: string; disabled?: boolean }) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const mutation = useMutation<LinkResponse, Error>({
    mutationFn: () => apiFetchJson<LinkResponse>(url, { method, credentials: 'include' }),
  });
  const link = mutation.data?.url;

  useEffect(() => {
    let cancelled = false;
    if (!link) { setQr(''); return; }
    void import('qrcode').then(module => module.toDataURL(link, { margin: 1, width: 240 })).then(dataUrl => { if (!cancelled) setQr(dataUrl); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [link]);

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      {!link ? (
        <Button variant="secondary" size="sm" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={disabled} icon={<QrCode aria-hidden="true" className="h-4 w-4" />}>{label}</Button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-900">Muestra este QR al cliente o envíale el enlace</p>
          {qr && <img src={qr} alt="Código QR para pagar en línea" width={192} height={192} className="mx-auto rounded-lg border border-slate-200" />}
          <p className="break-all rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{link}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={copy} icon={<Copy aria-hidden="true" className="h-4 w-4" />}>{copied ? 'Copiado' : 'Copiar enlace'}</Button>
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-indigo-700 hover:underline">Abrir página de pago</a>
          </div>
        </div>
      )}
      {mutation.error && <p role="alert" className="text-sm font-medium text-red-800">{mutation.error.message}</p>}
    </div>
  );
}
