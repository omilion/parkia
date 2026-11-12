import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Badge, Button, DataView, Field, Input } from '../../../ui';
import { useApiMutation } from '../../../lib/useApiMutation';
import { cafUploadSchema } from '../../../../shared/schemas/dte';
import { DTE_TYPE_NAMES, formatDate, JSON_HEADERS, readFileAsText, type DteOnboarding } from '../dteShared';

type CafRow = DteOnboarding['cafs'][number];

/** Paso 4: folios autorizados por el SII (archivo CAF). Cada tipo de documento tiene su propio CAF. */
export function CafStep({ onboarding, onChanged }: { onboarding: DteOnboarding; onChanged: () => void }) {
  const api = useApiMutation('dte/caf');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  // El único dato es el archivo; su contenido se valida con la regla compartida después de leerlo.
  const form = useForm();
  const ambiente = onboarding.environment === 'produccion' ? 'producción' : 'certificación';

  return (
    <div className="space-y-5">
      <form
        noValidate
        aria-label="Cargar folios CAF"
        className="space-y-4"
        onSubmit={form.handleSubmit(async () => {
          if (!file) { setFileError('Selecciona el archivo CAF (.xml)'); return; }
          try {
            const parsed = cafUploadSchema.safeParse({ content: await readFileAsText(file) });
            if (!parsed.success) { setFileError(parsed.error.issues[0]?.message || 'El archivo no es válido'); return; }
            await api.json('/api/dte/caf', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(parsed.data) });
            setFile(null);
            onChanged();
          } catch { /* se muestra abajo */ }
        })}
      >
        <p className="text-sm text-slate-600">
          Descarga desde el portal del SII el CAF de <strong>boletas electrónicas (tipo 39)</strong> del ambiente de {ambiente} y súbelo aquí.
          Cada CAF autoriza un rango de folios y pertenece al RUT de la empresa.
        </p>
        <Field label="Archivo CAF (.xml)" htmlFor="dte-caf" required error={fileError || undefined}>
          <Input id="dte-caf" type="file" accept=".xml,text/xml" invalid={Boolean(fileError)} onChange={event => { setFile(event.target.files?.[0] || null); setFileError(''); }} />
        </Field>
        {api.error && <p role="alert" className="text-sm font-semibold text-red-800">{api.error.message}</p>}
        <Button type="submit" loading={form.formState.isSubmitting}>Cargar folios</Button>
      </form>

      <DataView<CafRow>
        caption="Folios cargados"
        items={onboarding.cafs}
        getKey={caf => caf.id}
        emptyMessage="Aún no hay folios cargados"
        columns={[
          { key: 'type', label: 'Documento', primary: true, render: caf => `${DTE_TYPE_NAMES[caf.dte_type] || caf.dte_type} (${caf.dte_type})` },
          { key: 'env', label: 'Ambiente', render: caf => <Badge tone={caf.environment === 'produccion' ? 'success' : 'info'}>{caf.environment === 'produccion' ? 'Producción' : 'Certificación'}</Badge> },
          { key: 'range', label: 'Rango', render: caf => `${caf.folio_from} al ${caf.folio_to}` },
          { key: 'remaining', label: 'Disponibles', render: caf => <span className={caf.remaining <= 20 ? 'font-bold text-amber-800' : ''}>{caf.remaining}</span> },
          { key: 'auth', label: 'Autorizado', render: caf => formatDate(caf.authorized_at) },
        ]}
      />
    </div>
  );
}
