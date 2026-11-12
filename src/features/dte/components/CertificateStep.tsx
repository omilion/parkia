import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Button, Field, Input } from '../../../ui';
import { useApiMutation } from '../../../lib/useApiMutation';
import { certificateFormSchema } from '../../../../shared/schemas/dte';
import { formatDate, JSON_HEADERS, readFileAsBase64, type DteOnboarding } from '../dteShared';

/** Paso 2: certificado digital de la empresa. Se guarda cifrado y nunca vuelve a mostrarse. */
export function CertificateStep({ onboarding, onChanged }: { onboarding: DteOnboarding; onChanged: () => void }) {
  const api = useApiMutation('dte/certificate');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const form = useForm({ resolver: zodResolver(certificateFormSchema), defaultValues: { password: '' } });
  const { errors } = form.formState;
  const certificate = onboarding.certificate;

  return (
    <div className="space-y-5">
      {certificate && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            <p className="font-semibold text-slate-900">{certificate.subjectName || 'Certificado cargado'}</p>
            <Badge tone={certificate.expired ? 'danger' : certificate.daysLeft <= 30 ? 'warning' : 'success'}>
              {certificate.expired ? 'Vencido' : `Vence en ${certificate.daysLeft} días`}
            </Badge>
          </div>
          <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <div><dt className="inline font-semibold">RUT del titular: </dt><dd className="inline">{certificate.subjectRut || 'No identificado'}</dd></div>
            <div><dt className="inline font-semibold">Vigencia: </dt><dd className="inline">{formatDate(certificate.validFrom)} al {formatDate(certificate.validTo)}</dd></div>
            <div className="sm:col-span-2"><dt className="inline font-semibold">Emisor del certificado: </dt><dd className="inline">{certificate.issuer}</dd></div>
          </dl>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 text-red-800"
            icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            onClick={async () => {
              if (!window.confirm('¿Quitar el certificado? No se podrán enviar documentos al SII hasta cargar otro.')) return;
              try { await api.json('/api/dte/certificate', { method: 'DELETE' }); onChanged(); } catch { /* se muestra abajo */ }
            }}
          >
            Quitar certificado
          </Button>
        </div>
      )}

      <form
        noValidate
        aria-label={certificate ? 'Reemplazar certificado' : 'Cargar certificado'}
        className="space-y-4"
        onSubmit={form.handleSubmit(async ({ password }) => {
          if (!file) { setFileError('Selecciona el archivo del certificado (.pfx o .p12)'); return; }
          try {
            const result = await api.json<{ warnings: string[] }>('/api/dte/certificate', {
              method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ pfxBase64: await readFileAsBase64(file), password }),
            });
            setWarnings(result.warnings || []);
            form.reset();
            setFile(null);
            onChanged();
          } catch { /* se muestra abajo */ }
        })}
      >
        <p className="text-sm text-slate-600">
          Es el certificado digital de la persona autorizada en el SII para firmar los documentos de esta empresa.
          Se guarda cifrado, solo para esta empresa.
        </p>
        <Field label="Archivo del certificado (.pfx o .p12)" htmlFor="dte-pfx" required error={fileError || undefined}>
          <Input id="dte-pfx" type="file" accept=".pfx,.p12,application/x-pkcs12" invalid={Boolean(fileError)} onChange={event => { setFile(event.target.files?.[0] || null); setFileError(''); }} />
        </Field>
        <Field label="Clave del certificado" htmlFor="dte-pfx-password" required error={errors.password?.message}>
          <Input id="dte-pfx-password" type="password" autoComplete="off" invalid={Boolean(errors.password)} {...form.register('password')} />
        </Field>
        {warnings.map(warning => <p key={warning} role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>)}
        {api.error && <p role="alert" className="text-sm font-semibold text-red-800">{api.error.message}</p>}
        <Button type="submit" loading={form.formState.isSubmitting}>{certificate ? 'Reemplazar certificado' : 'Cargar certificado'}</Button>
      </form>
    </div>
  );
}
