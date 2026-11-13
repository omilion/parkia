import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Copy, Download, ShieldCheck } from 'lucide-react';
import { Button, Dialog } from '../../ui';
import { apiFetchJson } from '../../lib/api';
import { useApiMutation } from '../../lib/useApiMutation';

const labelClass = 'text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block';
const inputClass = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base md:text-sm focus:border-indigo-600 outline-none';

type Step = 'loading' | 'off' | 'setup' | 'recovery' | 'on';

/** Verificación en dos pasos (TOTP) del administrador: activar con un código, guardar los códigos de recuperación y desactivar con la clave. */
export function TwoFactorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const apiWrite = useApiMutation('components/auth/TwoFactorDialog');
  const [step, setStep] = useState<Step>('loading');
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep('loading'); setError(''); setNotice(''); setCode(''); setPassword(''); setRecoveryCodes([]); setSaved(false);
    let cancelled = false;
    apiFetchJson<{ user: { totp_enabled?: boolean } }>('/api/auth/me')
      .then(data => { if (!cancelled) setStep(data.user.totp_enabled ? 'on' : 'off'); })
      .catch(() => { if (!cancelled) { setStep('off'); setError('No se pudo leer el estado de la verificación.'); } });
    return () => { cancelled = true; };
  }, [open]);

  const call = async (path: string, body?: unknown) => {
    const res = await apiWrite.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: data as Record<string, any> };
  };

  const start = async () => {
    setBusy(true); setError('');
    try {
      const { ok, status, data } = await call('/api/auth/2fa/setup');
      if (!ok) { setError(status === 409 ? 'La verificación ya está activa. Desactívala primero.' : 'No se pudo iniciar la configuración.'); return; }
      setSecret(data.secret);
      // El generador de QR se baja recién aquí: casi nadie abre esta pantalla.
      const QRCode = (await import('qrcode')).default;
      setQr(await QRCode.toDataURL(data.otpauth_url, { errorCorrectionLevel: 'M', margin: 1, width: 192 }));
      setStep('setup');
    } finally { setBusy(false); }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const { ok, status, data } = await call('/api/auth/2fa/enable', { code: code.trim() });
      if (!ok) { setError(status === 409 ? 'La verificación ya está activa.' : 'El código no es válido. Revisa tu aplicación e inténtalo de nuevo.'); return; }
      setRecoveryCodes(data.recovery_codes ?? []);
      setStep('recovery');
    } finally { setBusy(false); }
  };

  const disable = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const { ok, status } = await call('/api/auth/2fa/disable', { password });
      if (!ok) { setError(status === 400 ? 'La clave no es correcta.' : 'No se pudo desactivar.'); return; }
      setPassword(''); setNotice('La verificación en dos pasos quedó desactivada.'); setStep('off');
    } finally { setBusy(false); }
  };

  const codesText = recoveryCodes.join('\n');
  const copyCodes = async () => {
    try { await navigator.clipboard.writeText(codesText); setNotice('Códigos copiados.'); } catch { setNotice('No se pudo copiar; descárgalos.'); }
  };
  const downloadCodes = () => {
    const url = URL.createObjectURL(new Blob([`Parkia - códigos de recuperación\nCada código sirve una sola vez.\n\n${codesText}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'parkia-codigos-de-recuperacion.txt'; link.click();
    URL.revokeObjectURL(url);
  };

  // Mientras se muestran los códigos de recuperación no se deja cerrar sin confirmar que se guardaron.
  const closable = step !== 'recovery' || saved;

  return (
    <Dialog open={open} onClose={() => { if (closable) onClose(); }} dismissible={closable} title="Verificación en dos pasos">
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
        {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</p>}

        {step === 'loading' && <p role="status" className="text-sm text-slate-600">Cargando...</p>}

        {step === 'off' && <>
          <p className="text-sm text-slate-700">Pide un código de tu aplicación de autenticación (Google Authenticator, Microsoft Authenticator, Authy) además de la clave. Protege la cuenta si alguien descubre tu clave.</p>
          <Button fullWidth onClick={() => { void start(); }} loading={busy} icon={<ShieldCheck aria-hidden="true" className="h-4 w-4" />}>Activar verificación en dos pasos</Button>
        </>}

        {step === 'setup' && <form noValidate aria-label="Confirmar verificación en dos pasos" onSubmit={event => { void confirm(event); }} className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Escanea el código QR con tu aplicación.</li>
            <li>Escribe el código de 6 dígitos que muestra.</li>
          </ol>
          {qr && <img src={qr} alt="Código QR para tu aplicación de autenticación" width={192} height={192} className="mx-auto rounded-xl border border-slate-200" />}
          <details className="text-sm text-slate-700">
            <summary className="cursor-pointer font-semibold">¿No puedes escanear? Ingresa la clave a mano</summary>
            <p className="mt-2 break-all rounded-xl bg-slate-100 p-3 font-mono text-sm tracking-wider" data-testid="totp-secret">{secret}</p>
          </details>
          <div>
            <label htmlFor="totp-confirm" className={labelClass}>Código de 6 dígitos</label>
            <input id="totp-confirm" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} className={inputClass} />
          </div>
          <Button type="submit" fullWidth loading={busy} disabled={code.length !== 6}>Confirmar y activar</Button>
        </form>}

        {step === 'recovery' && <div className="space-y-4">
          <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">La verificación en dos pasos está activa.</p>
          <p className="text-sm text-slate-700"><strong>Guarda estos códigos de recuperación.</strong> Si pierdes tu teléfono, cada uno te deja entrar una sola vez. No se vuelven a mostrar.</p>
          <ul aria-label="Códigos de recuperación" className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-3 font-mono text-sm">
            {recoveryCodes.map(item => <li key={item}>{item}</li>)}
          </ul>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => { void copyCodes(); }} icon={<Copy aria-hidden="true" className="h-4 w-4" />}>Copiar</Button>
            <Button variant="secondary" fullWidth onClick={downloadCodes} icon={<Download aria-hidden="true" className="h-4 w-4" />}>Descargar</Button>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-800">
            <input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} className="h-5 w-5" />
            Ya guardé mis códigos en un lugar seguro
          </label>
          <Button fullWidth disabled={!saved} onClick={onClose}>Listo</Button>
        </div>}

        {step === 'on' && <form noValidate aria-label="Desactivar verificación en dos pasos" onSubmit={event => { void disable(event); }} className="space-y-4">
          <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">La verificación en dos pasos está activa.</p>
          <p className="text-sm text-slate-700">Para desactivarla escribe tu clave. Si la vuelves a activar, obtendrás códigos de recuperación nuevos.</p>
          <div>
            <label htmlFor="totp-disable-password" className={labelClass}>Tu clave</label>
            <input id="totp-disable-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className={inputClass} />
          </div>
          <Button type="submit" variant="danger" fullWidth loading={busy} disabled={!password}>Desactivar</Button>
        </form>}
      </div>
    </Dialog>
  );
}
