import { Copy, Mail, MessageCircle, Phone } from 'lucide-react';

import Drawer from '../../../components/ui/Drawer';

import { cn } from '../../../lib/utils';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { collectionActionSchema } from '../../../../shared/schemas/finance';
import { useFinance } from './FinanceContext';

function CollectionActionForm() {
  const { handleCreateCollectionAction, isSavingCollectionAction } = useFinance();
  const form = useForm({
    resolver: zodResolver(collectionActionSchema),
    defaultValues: { channel: 'phone' as const, next_action_at: '', note: '' },
  });
  const { errors } = form.formState;
  return (
    <form
      noValidate
      aria-label="Nueva gestión de cobranza"
      onSubmit={form.handleSubmit(async values => {
        if (await handleCreateCollectionAction(values)) form.reset();
      })}
      className="space-y-4 border border-slate-200 rounded-3xl p-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="collection-channel" className={formLabelClass}>Canal</label>
          <select id="collection-channel" {...form.register('channel')} className={formInputClass}>
            <option value="phone">Teléfono</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="in_person">Presencial</option>
            <option value="other">Otro</option>
          </select>
        </div>
        <div>
          <label htmlFor="collection-next" className={formLabelClass}>Próxima acción</label>
          <input id="collection-next" type="date" aria-invalid={errors.next_action_at ? true : undefined} {...form.register('next_action_at')} className={formInputClass} />
          <FieldError error={errors.next_action_at} />
        </div>
      </div>

      <div>
        <label htmlFor="collection-note" className={formLabelClass}>Nota de gestión</label>
        <textarea
          id="collection-note"
          rows={4}
          aria-invalid={errors.note ? true : undefined}
          {...form.register('note')}
          placeholder="Ej: Se llamó al cliente, confirma transferencia para mañana."
          className={`${formInputClass} resize-none`}
        />
        <FieldError error={errors.note} />
      </div>

      <button type="submit" disabled={isSavingCollectionAction} className="w-full py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-100 hover:bg-slate-800 transition-all disabled:opacity-50">
        {isSavingCollectionAction ? 'Guardando...' : 'Registrar Gestión'}
      </button>
    </form>
  );
}

export default function CollectionActionDialog() {
  const { buildCollectionMessage, closeCollectionDrawer, collectionActions, collectionPayment, copyCollectionTemplate, copyText, handleCompleteCollectionAction, isSavingCollectionAction, normalizePhoneForWhatsApp } = useFinance();
  return (<Drawer
        isOpen={Boolean(collectionPayment)}
        onClose={closeCollectionDrawer}
        title="Seguimiento de Cobranza"
      >
        {collectionPayment && (
          <div className="space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-3xl">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Cliente</p>
              <p className="text-xl font-bold mt-1">{collectionPayment.client_name}</p>
              <div className="grid grid-cols-2 gap-4 mt-5">
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Saldo</p>
                  <p className="text-lg font-bold">${Number(collectionPayment.remaining_amount ?? collectionPayment.amount).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Vence</p>
                  <p className="text-lg font-bold">{collectionPayment.due_date}</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Contacto de cobranza</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {collectionPayment.client_phone || 'Sin teléfono'} · {collectionPayment.client_email || 'Sin email'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => copyText(collectionPayment.client_phone, 'Teléfono')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Copiar teléfono
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(collectionPayment.client_email, 'Email')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Copiar email
                  </button>
                  <button
                    type="button"
                    onClick={() => copyCollectionTemplate(collectionPayment)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copiar plantilla
                  </button>
                  {normalizePhoneForWhatsApp(collectionPayment.client_phone) && (
                    <a
                      href={`https://wa.me/${normalizePhoneForWhatsApp(collectionPayment.client_phone)}?text=${encodeURIComponent(buildCollectionMessage(collectionPayment))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition-all hover:bg-emerald-100"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp
                    </a>
                  )}
                </div>
              </div>
            </div>

            <CollectionActionForm />

            <div className="space-y-3">
              {collectionActions.length === 0 && (
                <p className="text-sm text-slate-600 bg-slate-50 rounded-2xl p-4">Sin gestiones registradas para este pago.</p>
              )}
              {collectionActions.map(action => (
                <div key={action.id} className={cn(
                  "border rounded-2xl p-4",
                  action.status === 'done' ? "border-emerald-100 bg-emerald-50" : "border-blue-100 bg-blue-50"
                )}>
                  <div className="flex justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        {action.channel === 'phone' ? 'Teléfono' : action.channel === 'whatsapp' ? 'WhatsApp' : action.channel === 'email' ? 'Email' : action.channel === 'in_person' ? 'Presencial' : 'Otro'}
                      </p>
                      <p className="text-xs text-slate-600">
                        {action.staff_name || 'Sistema'} · {new Date(action.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className={cn(
                      "h-fit px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                      action.status === 'done' ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                    )}>
                      {action.status === 'done' ? 'Cerrado' : 'Abierto'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 mt-3">{action.note}</p>
                  {action.next_action_at && action.status === 'open' && (
                    <p className="text-xs font-bold text-blue-700 mt-2">Próxima acción: {action.next_action_at}</p>
                  )}
                  {action.completed_note && (
                    <p className="text-xs text-emerald-700 bg-white border border-emerald-100 rounded-xl px-3 py-2 mt-3">{action.completed_note}</p>
                  )}
                  {action.status === 'open' && (
                    <button
                      onClick={() => handleCompleteCollectionAction(action)}
                      disabled={isSavingCollectionAction}
                      className="mt-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 px-3 py-2 rounded-lg transition-all disabled:opacity-50"
                    >
                      Marcar Cerrado
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>);
}
