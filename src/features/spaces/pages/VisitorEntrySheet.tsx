import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { ticketEntrySchema } from '../../../../shared/schemas/tickets';
import { useSpaces } from './SpacesContext';

export default function VisitorEntrySheet(){
const { handleCreateVisitorTicket, isActionLoading, isVisitorTicketDrawerOpen, setIsVisitorTicketDrawerOpen, spaces } = useSpaces();
const form = useForm({ resolver: zodResolver(ticketEntrySchema), defaultValues: { plate: '', space_id: '' } });
const { errors } = form.formState;
const plate = form.register('plate', { setValueAs: value => String(value ?? '').trim().toUpperCase() });
return (<Drawer
        isOpen={isVisitorTicketDrawerOpen}
        onClose={() => setIsVisitorTicketDrawerOpen(false)}
        title="Crear Ticket de Entrada"
      >
        <form noValidate onSubmit={form.handleSubmit(values => handleCreateVisitorTicket({ ...values, space_id: values.space_id || null }))} className="space-y-6">
          <div className="rounded-2xl bg-slate-900 text-white p-5">
            <p className="text-xs font-bold uppercase tracking-wider opacity-60">Cobro legal</p>
            <p className="mt-1 text-sm font-bold">El cobro se calcula al salir por minuto efectivo, descontando minutos de gracia y sin redondeo al alza.</p>
          </div>
          <div>
            <label htmlFor="visitor-plate" className={formLabelClass}>Patente</label>
            <input id="visitor-plate"
              type="text"
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Ej: ABCD12"
              aria-invalid={errors.plate ? true : undefined}
              {...plate}
              className={`${formInputClass} uppercase`}
            />
            <FieldError error={errors.plate} />
          </div>
          <div>
            <label htmlFor="visitor-space" className={formLabelClass}>Cupo</label>
            <select id="visitor-space" {...form.register('space_id', { setValueAs: value => (value === '' ? null : value) /* "" = asignar automáticamente */ })} className={formInputClass}>
              <option value="">Asignar automáticamente</option>
              {spaces.filter(space => space.type === 'parking' && space.status === 'available').map(space => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-600">Si no eliges cupo, Parkia toma el primer estacionamiento disponible.</p>
          </div>
          <div className="pt-6 border-t border-slate-100 flex gap-4">
            <button type="button" onClick={() => setIsVisitorTicketDrawerOpen(false)} className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
            <button type="submit" disabled={isActionLoading} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
              {isActionLoading ? 'Creando...' : 'Crear Ticket'}
            </button>
          </div>
        </form>
      </Drawer>);
}
