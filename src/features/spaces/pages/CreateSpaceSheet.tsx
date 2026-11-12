import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { createSpaceFormSchema } from '../../../../shared/schemas/spaces';
import { useSpaces } from './SpacesContext';

export default function CreateSpaceSheet(){
const { branches, handleCreateSpace, isActionLoading, isCreateDrawerOpen, selectedBranchId, setIsCreateDrawerOpen } = useSpaces();
const activeBranches = branches.filter(branch => branch.status === 'active');
const form = useForm({
  resolver: zodResolver(createSpaceFormSchema),
  defaultValues: {
    type: 'parking' as const,
    branch_id: String(selectedBranchId === 'all' ? activeBranches[0]?.id ?? '' : selectedBranchId),
    name: '', price: '', location: '', level: '', width_m: '', length_m: '', height_m: '',
    features: '', status: 'available' as const, notes: '',
  },
});
const { errors } = form.formState;
return (<Drawer
        isOpen={isCreateDrawerOpen}
        onClose={() => setIsCreateDrawerOpen(false)}
        title="Registrar Nuevo Estacionamiento"
      >
        <form noValidate onSubmit={form.handleSubmit(handleCreateSpace)} className="space-y-6">
          <div>
            <label htmlFor="space-branch" className={formLabelClass}>Sucursal</label>
            <select id="space-branch" aria-invalid={errors.branch_id ? true : undefined} {...form.register('branch_id')} className={formInputClass}>
              {activeBranches.map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
            <FieldError error={errors.branch_id} />
          </div>

          <div>
            <label htmlFor="space-name" className={formLabelClass}>Identificador / Nombre</label>
            <input id="space-name" type="text" aria-invalid={errors.name ? true : undefined} {...form.register('name')} placeholder="Ej: A-101" className={formInputClass} />
            <FieldError error={errors.name} />
          </div>

          <div>
            <label htmlFor="space-price" className={formLabelClass}>Precio Base Mensual</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 font-bold" aria-hidden="true">$</span>
              <input id="space-price" type="number" inputMode="numeric" min="0" aria-invalid={errors.price ? true : undefined} {...form.register('price')} className={`${formInputClass} pl-8`} />
            </div>
            <FieldError error={errors.price} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="space-location" className={formLabelClass}>Ubicación</label>
              <input id="space-location" type="text" {...form.register('location')} placeholder="Ej: Patio norte, pasillo B" className={formInputClass} />
            </div>
            <div>
              <label htmlFor="space-level" className={formLabelClass}>Nivel</label>
              <input id="space-level" type="text" {...form.register('level')} placeholder="Ej: -1, 1, Exterior" className={formInputClass} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {([['width_m', 'Ancho m'], ['length_m', 'Largo m'], ['height_m', 'Alto m']] as const).map(([name, label]) => (
              <div key={name}>
                <label htmlFor={`space-${name}`} className={formLabelClass}>{label}</label>
                <input id={`space-${name}`} type="number" inputMode="decimal" step="0.01" min="0" aria-invalid={errors[name] ? true : undefined} {...form.register(name)} className={formInputClass} />
                <FieldError error={errors[name]} />
              </div>
            ))}
          </div>

          <div>
            <label htmlFor="space-features" className={formLabelClass}>Características</label>
            <textarea id="space-features" rows={3} {...form.register('features')} placeholder="Ej: iluminación, cámara, enchufe, acceso techado..." className={`${formInputClass} resize-none`}></textarea>
          </div>

          <div>
            <label htmlFor="space-status" className={formLabelClass}>Estado Inicial</label>
            <select id="space-status" {...form.register('status')} className={formInputClass}>
              <option value="available">Disponible</option>
              <option value="maintenance">En Mantención</option>
            </select>
          </div>

          <div>
            <label htmlFor="space-notes" className={formLabelClass}>Notas Adicionales</label>
            <textarea id="space-notes" rows={3} {...form.register('notes')} placeholder="Opcional..." className={`${formInputClass} resize-none`}></textarea>
          </div>

          <div className="pt-6 border-t border-slate-100 flex gap-4">
            <button type="button" onClick={() => setIsCreateDrawerOpen(false)} className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
            <button type="submit" disabled={isActionLoading} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
              Crear Estacionamiento
            </button>
          </div>
        </form>
      </Drawer>);
}
