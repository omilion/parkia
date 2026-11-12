import { invalidatedDomains } from '../../../lib/useApiMutation';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { manualPaymentFieldsSchema, type ManualPaymentValues } from '../../../../shared/schemas/payments';
import { apiFetchJson } from '../../../lib/api';
import { Button, Field, Input, Select, Sheet, Textarea } from '../../../ui';
import { useFinance } from './FinanceContext';
import { formatIssuedDteMessage } from './financeShared';

export default function RegisterPaymentDialog() {
  const { selectedPayment, isDrawerOpen, closePaymentDrawer, setToast } = useFinance();
  const id = useId();
  const client = useQueryClient();
  const [receipt, setReceipt] = useState<File | null>(null);
  const form = useForm<ManualPaymentValues>({ resolver: zodResolver(manualPaymentFieldsSchema), defaultValues: {
    method: 'cash', payment_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()), reference: '', note: '',
  } });
  const mutation = useMutation({ meta: { invalidates: invalidatedDomains('/api/finance/payments') }, mutationFn: async (values: ManualPaymentValues) => {
    if (!selectedPayment) throw new Error('Selecciona una cuenta por cobrar');
    let attachment: { fileName: string; mimeType: string; dataBase64: string } | undefined;
    if (receipt) {
      if (receipt.size > 5 * 1024 * 1024) throw new Error('El comprobante no puede superar 5 MB');
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(receipt.type)) throw new Error('Usa un archivo PDF, JPG o PNG');
      const dataBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('No se pudo leer el comprobante')); reader.readAsDataURL(receipt); });
      attachment = { fileName: receipt.name, mimeType: receipt.type, dataBase64 };
    }
    return apiFetchJson<Record<string, any>>(`/api/finance/payments/${selectedPayment.id}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, receipt: attachment }) });
  }, onSuccess: async result => {
    setToast({ type: 'success', message: `Pago registrado por $${Number(result.paidAmount ?? result.amount ?? 0).toLocaleString('es-CL')}. ${formatIssuedDteMessage(result)}.` });
    closePaymentDrawer();
  } });
  return <Sheet open={isDrawerOpen} title="Registrar Pago Manual" onClose={closePaymentDrawer} dismissible={!mutation.isPending} footer={<div className="flex gap-3"><Button variant="secondary" onClick={closePaymentDrawer} disabled={mutation.isPending}>Cancelar</Button><Button form={id} type="submit" loading={mutation.isPending} fullWidth>Registrar pago y preparar DTE</Button></div>}>
    <form id={id} aria-label="Pago de abonado" className="space-y-5" onSubmit={form.handleSubmit(async values => { try { await mutation.mutateAsync(values); } catch {} })}>
      <div className="rounded-xl bg-slate-900 p-5 text-white"><p className="text-sm">{selectedPayment?.client_name}</p><p className="mt-2 text-3xl font-bold tabular-nums">${Number(selectedPayment?.remaining_amount ?? selectedPayment?.amount ?? 0).toLocaleString('es-CL')}</p><p className="mt-2 text-sm">Vencimiento: {selectedPayment?.due_date}</p></div>
      <Field label="Método de pago" htmlFor={`${id}-method`}><Select id={`${id}-method`} {...form.register('method')}><option value="cash">Efectivo</option><option value="transfer">Transferencia bancaria</option><option value="card">Tarjeta</option></Select></Field>
      <Field label="Fecha de pago" htmlFor={`${id}-date`} error={form.formState.errors.payment_date?.message}><Input id={`${id}-date`} type="date" {...form.register('payment_date')} /></Field>
      <Field label="Referencia / comprobante" htmlFor={`${id}-reference`}><Input id={`${id}-reference`} {...form.register('reference')} /></Field>
      <Field label="Nota operacional" htmlFor={`${id}-note`} error={form.formState.errors.note?.message}><Textarea id={`${id}-note`} {...form.register('note')} /></Field>
      <Field label="Archivo de comprobante (opcional)" htmlFor={`${id}-receipt`} hint="PDF, JPG o PNG de hasta 5 MB"><Input id={`${id}-receipt`} type="file" accept="application/pdf,image/jpeg,image/png" onChange={event => setReceipt(event.target.files?.[0] || null)} /></Field>
      <p className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900">El documento tributario quedará preparado o procesado según el proveedor configurado.</p>
      {mutation.error && <p role="alert" className="text-sm text-red-800">{mutation.error.message}</p>}
    </form>
  </Sheet>;
}
