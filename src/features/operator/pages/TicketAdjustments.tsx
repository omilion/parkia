import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { lostTicketSchema } from '../../../../shared/schemas/pricing';
import { apiFetchJson } from '../../../lib/api';
import { useApiMutation } from '../../../lib/useApiMutation';
import { Button, Dialog, Field, Select, Textarea } from '../../../ui';
import { PayLinkCard } from '../../payments/components/PayLinkCard';

type AgreementOption = { id: number; name: string; kind: string; value: number };
type Validation = { id: number; name: string };

const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

const describeAgreement = (agreement: AgreementOption) =>
  agreement.kind === 'free_minutes' ? `${agreement.value} min gratis`
    : agreement.kind === 'percent' ? `${agreement.value}% dcto.`
      : `$${Number(agreement.value).toLocaleString('es-CL')} dcto.`;

/** Convenios aplicados al ticket y registro formal de ticket perdido (caja y guardia). */
export function TicketAdjustments({ ticketId, disabled, onChanged }: { ticketId: number; disabled?: boolean; onChanged: () => void | Promise<void> }) {
  const apiWrite = useApiMutation('features/operator/pages/TicketAdjustments');
  const agreements = useQuery({ queryKey: ['agreements', 'operator'], queryFn: ({ signal }) => apiFetchJson<{ agreements: AgreementOption[] }>('/api/agreements', { signal }) });
  const validations = useQuery({ queryKey: ['ticket-validations', ticketId], queryFn: ({ signal }) => apiFetchJson<{ validations: Validation[] }>(`/api/visitors/${ticketId}/validations`, { signal }) });
  const [agreementId, setAgreementId] = useState('');
  const [lostOpen, setLostOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const form = useForm({ resolver: zodResolver(lostTicketSchema.pick({ note: true })), defaultValues: { note: '' } });

  const applied = new Set((validations.data?.validations ?? []).map(item => item.name));
  const options = (agreements.data?.agreements ?? []).filter(item => !applied.has(item.name));

  const validate = async () => {
    if (!agreementId || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiWrite.json(`/api/visitors/${ticketId}/validations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agreement_id: Number(agreementId) }),
      });
      setAgreementId(''); setNotice('Convenio aplicado.');
      await validations.refetch();
      await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo aplicar el convenio'); }
    finally { setBusy(false); }
  };

  const registerLost = form.handleSubmit(async values => {
    setBusy(true); setError(''); setNotice('');
    try {
      let evidence: { fileName: string; mimeType: string; dataBase64: string } | undefined;
      if (file) {
        if (file.size > MAX_EVIDENCE_BYTES) throw new Error('La evidencia no puede superar 4 MB');
        evidence = { fileName: file.name, mimeType: file.type, dataBase64: await readAsBase64(file) };
      }
      await apiWrite.json(`/api/visitors/${ticketId}/lost-ticket`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: values.note, evidence }),
      });
      setLostOpen(false); setFile(null); form.reset({ note: '' });
      setNotice('Ticket perdido registrado. Se cobra el tiempo real de estadía.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar el ticket perdido'); }
    finally { setBusy(false); }
  });

  return (
    <section aria-label="Convenios y ticket perdido" className="space-y-3 rounded-xl border border-slate-200 p-4">
      {(validations.data?.validations.length ?? 0) > 0 && (
        <p className="text-sm text-slate-700">Convenios aplicados: <strong>{validations.data!.validations.map(item => item.name).join(', ')}</strong></p>
      )}
      {options.length > 0 && (
        <div className="flex items-end gap-2">
          <Field label="Aplicar convenio" htmlFor="ticket-agreement" className="flex-1">
            <Select id="ticket-agreement" value={agreementId} onChange={event => setAgreementId(event.target.value)}>
              <option value="">Selecciona un comercio</option>
              {options.map(item => <option key={item.id} value={item.id}>{item.name} · {describeAgreement(item)}</option>)}
            </Select>
          </Field>
          <Button variant="secondary" onClick={validate} loading={busy} disabled={!agreementId || disabled}>Aplicar</Button>
        </div>
      )}
      <PayLinkCard url={`/api/visitors/${ticketId}/pay-link`} disabled={disabled} />
      <Button variant="ghost" size="sm" onClick={() => { setError(''); setLostOpen(true); }} disabled={disabled}>Registrar ticket perdido</Button>
      {notice && <p role="status" className="text-sm font-medium text-emerald-800">{notice}</p>}
      {error && !lostOpen && <p role="alert" className="text-sm font-medium text-red-800">{error}</p>}

      <Dialog open={lostOpen} onClose={() => { if (!busy) setLostOpen(false); }} title="Registrar ticket perdido" dismissible={!busy}>
        <form noValidate onSubmit={registerLost} className="space-y-4">
          <p className="text-sm text-slate-600">No hay multa fija: se cobra el tiempo real registrado. Deja constancia de cómo verificaste al dueño del vehículo.</p>
          <Field label="Cómo se verificó al dueño" htmlFor="lost-note" error={form.formState.errors.note?.message}>
            <Textarea id="lost-note" invalid={Boolean(form.formState.errors.note)} {...form.register('note')} />
          </Field>
          <Field label="Foto de cédula o padrón (opcional)" htmlFor="lost-evidence" hint="JPG, PNG o PDF de hasta 4 MB">
            <input id="lost-evidence" type="file" accept="image/jpeg,image/png,application/pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} className="block w-full text-sm" />
          </Field>
          {error && <p role="alert" className="text-sm font-medium text-red-800">{error}</p>}
          <Button type="submit" variant="brand" size="lg" fullWidth loading={busy}>Registrar</Button>
        </form>
      </Dialog>
    </section>
  );
}
