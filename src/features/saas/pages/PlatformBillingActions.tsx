import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Banknote, CreditCard } from 'lucide-react';
import { platformManualPaymentSchema } from '../../../../shared/schemas/billing';
import { useApiMutation } from '../../../lib/useApiMutation';
import { Button, Dialog, FieldError, formInputClass, formLabelClass } from '../../../ui';

export type TenantBilling = {
  card: { type: string | null; last4: string | null } | null;
  estimated_amount_clp: number;
  next_charge_date: string | null;
  last_invoice: { status: string; amount_clp: number; period_start: string | null; created_at: string; error_message: string | null } | null;
};

const money = (value: number) => `$${Number(value || 0).toLocaleString('es-CL')}`;
const invoiceLabel: Record<string, string> = { paid: 'pagado', failed: 'rechazado', processing: 'sin confirmar', pending: 'pendiente' };

/** Motivos por los que un cobro no se hizo, dichos para quien administra la plataforma. */
const chargeFailure: Record<string, string> = {
  NO_CARD: 'La empresa no tiene una tarjeta inscrita. Registra el pago si lo hizo por transferencia.',
  NOT_DUE: 'El período vigente aún no termina: todavía no corresponde cobrar.',
  UF_UNAVAILABLE: 'No hay un valor de UF real y reciente. Sincroniza o carga la UF antes de cobrar.',
  ONECLICK_NOT_AVAILABLE: 'El cobro con tarjeta no está habilitado en este servidor. Registra el pago recibido por transferencia.',
  IN_PROGRESS: 'Hay un cobro de este período sin confirmar. Revísalo con la pasarela antes de reintentar.',
  NOTHING_TO_CHARGE: 'El plan de esta empresa no tiene monto por cobrar.',
  NO_SUBSCRIPTION: 'La empresa no tiene suscripción.',
  REJECTED: 'La tarjeta rechazó el cargo.',
};

/**
 * Cobro de la suscripción de una empresa cliente. Es una acción de Parkia (administrador de plataforma):
 * el cliente no la tiene en su pantalla.
 */
export function PlatformBillingActions({ tenantId, tenantName, billing, onChanged }: {
  tenantId: number; tenantName: string; billing: TenantBilling; onChanged: (message: string) => void;
}) {
  const apiWrite = useApiMutation('PlatformBillingActions.tsx');
  const [confirmCharge, setConfirmCharge] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [error, setError] = useState('');
  const form = useForm({ resolver: zodResolver(platformManualPaymentSchema), defaultValues: { reference: '', amount_clp: undefined, note: '' } });
  const { errors } = form.formState;

  const charge = async () => {
    setError('');
    const res = await apiWrite.request(`/api/platform/tenants/${tenantId}/charge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(chargeFailure[data.code] || data.error || 'No se pudo cobrar.'); return; }
    setConfirmCharge(false);
    onChanged(data.already_paid ? `${tenantName}: ese período ya estaba pagado.` : `${tenantName}: cobro aprobado por ${money(data.amount_clp)}. Período hasta ${data.period_end}.`);
  };

  const registerPayment = form.handleSubmit(async values => {
    setError('');
    const res = await apiWrite.request(`/api/platform/tenants/${tenantId}/manual-payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: values.reference, note: values.note || undefined, ...(values.amount_clp ? { amount_clp: values.amount_clp } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'No se pudo registrar el pago.'); return; }
    setManualOpen(false);
    form.reset();
    onChanged(`${tenantName}: pago de ${money(data.amount_clp)} registrado. Período hasta ${data.period_end}.`);
  });

  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
        <span>Tarjeta: <strong>{billing.card ? `${billing.card.type ?? 'Tarjeta'} •••• ${billing.card.last4 ?? ''}` : 'sin inscribir'}</strong></span>
        <span>Próximo cobro: <strong>{billing.next_charge_date ?? '—'}</strong> · {money(billing.estimated_amount_clp)}</span>
        {billing.last_invoice && (
          <span>Último cobro: <strong>{invoiceLabel[billing.last_invoice.status] ?? billing.last_invoice.status}</strong> ({money(billing.last_invoice.amount_clp)})</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => { setError(''); setConfirmCharge(true); }} icon={<CreditCard aria-hidden="true" className="h-4 w-4" />}>Cobrar ahora</Button>
        <Button size="sm" variant="secondary" onClick={() => { setError(''); setManualOpen(true); }} icon={<Banknote aria-hidden="true" className="h-4 w-4" />}>Registrar pago</Button>
      </div>

      <Dialog open={confirmCharge} onClose={() => setConfirmCharge(false)} title={`Cobrar a ${tenantName}`}>
        <div className="space-y-4">
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
          <p className="text-sm text-slate-700">
            Se cobrará aproximadamente <strong>{money(billing.estimated_amount_clp)}</strong> a la tarjeta inscrita de esta empresa
            {billing.card ? ` (${billing.card.type ?? 'Tarjeta'} •••• ${billing.card.last4 ?? ''})` : ''} y se renovará su período. El monto exacto usa la UF de hoy.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setConfirmCharge(false)}>Cancelar</Button>
            <Button fullWidth loading={apiWrite.isPending} onClick={() => { void charge(); }}>Cobrar</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={manualOpen} onClose={() => setManualOpen(false)} title={`Registrar pago de ${tenantName}`}>
        <form noValidate aria-label="Registrar pago recibido" onSubmit={event => { void registerPayment(event); }} className="space-y-4">
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
          <p className="text-sm text-slate-700">Para un pago que Parkia ya recibió por fuera de la tarjeta (transferencia o depósito). Renueva el período de la empresa.</p>
          <div>
            <label htmlFor={`manual-reference-${tenantId}`} className={formLabelClass}>Referencia del pago</label>
            <input id={`manual-reference-${tenantId}`} placeholder="N° de transferencia" aria-invalid={errors.reference ? true : undefined} {...form.register('reference')} className={formInputClass} />
            <FieldError error={errors.reference} />
          </div>
          <div>
            <label htmlFor={`manual-amount-${tenantId}`} className={formLabelClass}>Monto recibido (opcional)</label>
            <input id={`manual-amount-${tenantId}`} inputMode="numeric" placeholder={`Por defecto ${money(billing.estimated_amount_clp)}`} aria-invalid={errors.amount_clp ? true : undefined}
              {...form.register('amount_clp', { setValueAs: value => (value === '' || value === undefined || value === null ? undefined : Number(value)) })} className={formInputClass} />
            <FieldError error={errors.amount_clp} />
          </div>
          <div>
            <label htmlFor={`manual-note-${tenantId}`} className={formLabelClass}>Nota (opcional)</label>
            <input id={`manual-note-${tenantId}`} aria-invalid={errors.note ? true : undefined} {...form.register('note')} className={formInputClass} />
            <FieldError error={errors.note} />
          </div>
          <Button type="submit" fullWidth loading={apiWrite.isPending}>Registrar pago y renovar</Button>
        </form>
      </Dialog>
    </div>
  );
}
