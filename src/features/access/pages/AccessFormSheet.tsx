import { ShieldAlert } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { accessOverrideFormSchema, updateAccessRateSchema, visitorPassFormSchema } from '../../../../shared/schemas/access';
import { useAccess } from './AccessContext';

function VisitorPassForm() {
  const { handleCreatePass, isActionLoading } = useAccess();
  const form = useForm({
    resolver: zodResolver(visitorPassFormSchema),
    defaultValues: { name: '', rut: '', phone: '', plate: '', company: '', type: 'provider' as const, authorized_by: '', reason: '', valid_from: '', valid_to: '' },
  });
  const { errors } = form.formState;
  const text = (name: 'name' | 'rut' | 'phone' | 'plate' | 'company' | 'authorized_by', label: string, className = '') => (
    <div className={className}>
      <label htmlFor={`pass-${name}`} className={formLabelClass}>{label}</label>
      <input id={`pass-${name}`} type="text" aria-invalid={errors[name] ? true : undefined} {...form.register(name)} className={`${formInputClass}${name === 'plate' ? ' uppercase' : ''}`} />
      <FieldError error={errors[name]} />
    </div>
  );
  return (
    <form noValidate onSubmit={form.handleSubmit(handleCreatePass)} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {text('name', 'Nombre Completo', 'sm:col-span-2')}
        {text('rut', 'RUT')}
        {text('phone', 'Teléfono')}
        {text('plate', 'Patente')}
        {text('company', 'Empresa')}
        <div>
          <label htmlFor="pass-type" className={formLabelClass}>Tipo Visitante</label>
          <select id="pass-type" {...form.register('type')} className={formInputClass}>
            <option value="provider">Proveedor</option>
            <option value="family">Familiar</option>
            <option value="maintenance">Mantenimiento</option>
            <option value="other">Otro</option>
          </select>
        </div>
        {text('authorized_by', 'Autorizado por')}
        <div className="sm:col-span-2">
          <label htmlFor="pass-reason" className={formLabelClass}>Motivo de Visita</label>
          <textarea id="pass-reason" rows={3} {...form.register('reason')} className={formInputClass} />
        </div>
        <div>
          <label htmlFor="pass-valid-from" className={formLabelClass}>Válido Desde</label>
          <input id="pass-valid-from" type="datetime-local" aria-invalid={errors.valid_from ? true : undefined} {...form.register('valid_from')} className={formInputClass} />
          <FieldError error={errors.valid_from} />
        </div>
        <div>
          <label htmlFor="pass-valid-to" className={formLabelClass}>Válido Hasta</label>
          <input id="pass-valid-to" type="datetime-local" aria-invalid={errors.valid_to ? true : undefined} {...form.register('valid_to')} className={formInputClass} />
          <FieldError error={errors.valid_to} />
        </div>
      </div>
      <button type="submit" disabled={isActionLoading} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
        Generar Pase QR
      </button>
    </form>
  );
}

function AccessOverrideForm() {
  const { currentUser, handleOverride, isActionLoading, selectedLog, spaces } = useAccess();
  const form = useForm({
    resolver: zodResolver(accessOverrideFormSchema),
    defaultValues: { space_id: String(selectedLog?.space_id || ''), access_type: 'entry' as const, reason: '' },
  });
  const { errors } = form.formState;
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(values => handleOverride(selectedLog ? { ...values, access_type: undefined } : values))}
      className="space-y-6"
    >
      <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-700">
        <ShieldAlert className="w-6 h-6 shrink-0" aria-hidden="true" />
        <p className="text-sm font-bold">Esta acción quedará registrada permanentemente en la auditoría a nombre de {currentUser?.name || 'Guardia'}. El sistema no acciona puertas ni barreras físicas.</p>
      </div>

      <div className="space-y-4">
        {selectedLog && (
          <div className="p-4 bg-slate-50 rounded-2xl">
            <p className="text-xs font-bold text-slate-600 uppercase mb-1">Intento Fallido</p>
            <p className="text-sm font-bold">{selectedLog.client_name || selectedLog.visitor_name}</p>
            <p className="text-xs text-red-700 font-bold">{selectedLog.reason}</p>
            <p className="text-xs text-slate-600 mt-1">Se enlazará la autorización manual con el acceso denegado #{selectedLog.id}.</p>
          </div>
        )}

        <div>
          <label htmlFor="override-space" className={formLabelClass}>Acceso vehicular / espacio</label>
          <select id="override-space" aria-invalid={errors.space_id ? true : undefined} aria-describedby="override-space-hint" {...form.register('space_id')} className={formInputClass}>
            <option value="">Seleccione barrera vehicular...</option>
            {spaces.map(s => (
              <option key={s.id} value={s.id}>Barrera vehicular - {s.name}</option>
            ))}
          </select>
          <FieldError error={errors.space_id} />
          <p id="override-space-hint" className="mt-2 text-xs text-slate-600">La puerta peatonal se identifica visualmente en el monitor; este flujo registra autorización manual contra un espacio auditado.</p>
        </div>

        {!selectedLog && (
          <div>
            <label htmlFor="override-type" className={formLabelClass}>Tipo de movimiento</label>
            <select id="override-type" {...form.register('access_type')} className={formInputClass}>
              <option value="entry">Entrada</option>
              <option value="exit">Salida</option>
            </select>
          </div>
        )}

        <div>
          <label htmlFor="override-reason" className={formLabelClass}>Motivo de Autorizacion Manual</label>
          <textarea id="override-reason" rows={4} aria-invalid={errors.reason ? true : undefined} {...form.register('reason')} placeholder="Ej: Cliente indica que pagó, se dirige a finanzas..." className={formInputClass} />
          <FieldError error={errors.reason} />
        </div>
      </div>

      <button type="submit" disabled={isActionLoading} className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold shadow-xl shadow-red-100 hover:bg-red-700 transition-all disabled:opacity-50">
        Registrar Autorizacion Manual
      </button>
    </form>
  );
}

function AccessRateForm() {
  const { handleUpdateRate, isActionLoading, selectedRate } = useAccess();
  const form = useForm({
    resolver: zodResolver(updateAccessRateSchema),
    defaultValues: {
      rate_per_minute: selectedRate.rate_per_minute || Math.floor(selectedRate.rate_per_hour / 60),
      grace_period_mins: selectedRate.grace_period_mins,
    },
  });
  const { errors } = form.formState;
  return (
    <form noValidate onSubmit={form.handleSubmit(handleUpdateRate)} className="space-y-6">
      <div className="space-y-4">
        <h4 className="text-lg font-bold">{selectedRate.type}</h4>
        <div>
          <label htmlFor="rate-per-minute" className={formLabelClass}>Tarifa por Minuto ($)</label>
          <input id="rate-per-minute" type="number" inputMode="numeric" min={0} aria-invalid={errors.rate_per_minute ? true : undefined} aria-describedby="rate-per-minute-hint" {...form.register('rate_per_minute')} className={formInputClass} />
          <FieldError error={errors.rate_per_minute} />
          <p id="rate-per-minute-hint" className="mt-2 text-xs text-slate-600">Modalidad legal: minuto efectivo. Parkia no redondea el cobro al alza.</p>
        </div>
        <div>
          <label htmlFor="rate-grace" className={formLabelClass}>Tiempo de Gracia (Minutos)</label>
          <input id="rate-grace" type="number" inputMode="numeric" min={0} step={1} aria-invalid={errors.grace_period_mins ? true : undefined} {...form.register('grace_period_mins')} className={formInputClass} />
          <FieldError error={errors.grace_period_mins} />
        </div>
      </div>
      <button type="submit" disabled={isActionLoading} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
        Guardar Cambios
      </button>
    </form>
  );
}

export default function AccessFormSheet(){
const { canManageRates, drawerType, isDrawerOpen, selectedRate, setIsDrawerOpen } = useAccess();
return (<Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={
          drawerType === 'visitor' ? 'Nuevo Pase de Visita' :
            drawerType === 'override' ? 'Registro Manual de Emergencia' : 'Configurar Tarifa'
        }
      >
        {drawerType === 'visitor' && <VisitorPassForm />}
        {drawerType === 'override' && <AccessOverrideForm />}
        {canManageRates && drawerType === 'rate' && selectedRate && <AccessRateForm />}
      </Drawer>);
}
