import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../../../ui';
import { useApiMutation } from '../../../lib/useApiMutation';
import { formatDate, type DteOnboarding } from '../dteShared';

type ConnectionResult = { ok: boolean; results: Array<{ service: string; ok: boolean; message: string }> };

/** Paso 3: comprueba que el SII autentica el certificado. No envía ningún documento. */
export function ConnectionStep({ onboarding, onChanged }: { onboarding: DteOnboarding; onChanged: () => void }) {
  const api = useApiMutation('dte/test-connection');
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [pending, setPending] = useState(false);
  const canTest = Boolean(onboarding.certificate && !onboarding.certificate.expired);
  const ambiente = onboarding.environment === 'produccion' ? 'producción' : 'certificación (Maullín)';

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Se solicita al SII un acceso de prueba en el ambiente de {ambiente} con el certificado cargado.
        Si resulta, el certificado y su autorización están bien configurados.
      </p>
      {!canTest && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Primero carga un certificado vigente (paso 2).</p>}
      <Button
        loading={pending}
        disabled={!canTest}
        onClick={async () => {
          setPending(true);
          try {
            setResult(await api.json<ConnectionResult>('/api/dte/test-connection', { method: 'POST' }));
            onChanged();
          } catch { /* se muestra abajo */ } finally { setPending(false); }
        }}
      >
        Probar conexión con el SII
      </Button>
      {api.error && <p role="alert" className="text-sm font-semibold text-red-800">{api.error.message}</p>}
      {(result?.results || []).map(item => (
        <p key={item.service} role="status" className={`flex items-start gap-2 text-sm font-semibold ${item.ok ? 'text-emerald-800' : 'text-red-800'}`}>
          {item.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>{item.service === 'facturas' ? 'Facturas y notas' : 'Boletas'}: {item.message}</span>
        </p>
      ))}
      {!result && onboarding.connection.checkedAt && (
        <p className={`text-sm ${onboarding.connection.ok ? 'text-emerald-800' : 'text-red-800'}`}>
          Última prueba: {formatDate(onboarding.connection.checkedAt)} — {onboarding.connection.ok ? 'correcta' : onboarding.connection.message}
        </p>
      )}
    </div>
  );
}
