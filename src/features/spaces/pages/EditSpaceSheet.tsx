import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { updateSpaceFormSchema } from '../../../../shared/schemas/spaces';
import type { Space } from '../../../types';
import { useSpaces } from './SpacesContext';

function EditSpaceForm({ space }: { space: Space }) {
  const { branches, handleUpdateSpace, isActionLoading, setEditingSpace } = useSpaces();
  const form = useForm({
    resolver: zodResolver(updateSpaceFormSchema),
    defaultValues: {
      name: space.name,
      type: 'parking' as const,
      price: space.price ?? '',
      branch_id: String(space.branch_id || ''),
      location: space.location || '',
      level: space.level || '',
      width_m: space.width_m || '',
      length_m: space.length_m || '',
      height_m: space.height_m || '',
      features: space.features || '',
      notes: space.notes || '',
      reason: '',
    },
  });
  const { errors } = form.formState;
  return (
          <form noValidate onSubmit={form.handleSubmit(handleUpdateSpace)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-space-name" className={formLabelClass}>Identificador / Nombre</label>
                <input id="edit-space-name" type="text" aria-invalid={errors.name ? true : undefined} {...form.register('name')} className={formInputClass} />
                <FieldError error={errors.name} />
              </div>
              <div>
                <label htmlFor="edit-space-type" className={formLabelClass}>Tipo</label>
                <select id="edit-space-type" {...form.register('type')} className={formInputClass}>
                  <option value="parking">Estacionamiento</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="edit-space-price" className={formLabelClass}>Precio Base Mensual</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 font-bold" aria-hidden="true">$</span>
                <input id="edit-space-price" type="number" inputMode="numeric" min="0" aria-invalid={errors.price ? true : undefined} {...form.register('price')} className={`${formInputClass} pl-8`} />
              </div>
              <FieldError error={errors.price} />
            </div>

            <div>
              <label htmlFor="edit-space-branch" className={formLabelClass}>Sucursal</label>
              <select id="edit-space-branch" aria-invalid={errors.branch_id ? true : undefined} {...form.register('branch_id')} className={formInputClass}>
                {branches.filter(branch => branch.status === 'active').map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
              <FieldError error={errors.branch_id} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-space-location" className={formLabelClass}>Ubicación</label>
                <input id="edit-space-location" type="text" {...form.register('location')} className={formInputClass} />
              </div>
              <div>
                <label htmlFor="edit-space-level" className={formLabelClass}>Nivel</label>
                <input id="edit-space-level" type="text" {...form.register('level')} className={formInputClass} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {([['width_m', 'Ancho m'], ['length_m', 'Largo m'], ['height_m', 'Alto m']] as const).map(([name, label]) => (
                <div key={name}>
                  <label htmlFor={`edit-space-${name}`} className={formLabelClass}>{label}</label>
                  <input id={`edit-space-${name}`} type="number" inputMode="decimal" step="0.01" min="0" aria-invalid={errors[name] ? true : undefined} {...form.register(name)} className={formInputClass} />
                  <FieldError error={errors[name]} />
                </div>
              ))}
            </div>

            <div>
              <label htmlFor="edit-space-features" className={formLabelClass}>Características</label>
              <textarea id="edit-space-features" rows={3} {...form.register('features')} className={`${formInputClass} resize-none`}></textarea>
            </div>

            <div>
              <label htmlFor="edit-space-notes" className={formLabelClass}>Notas</label>
              <textarea id="edit-space-notes" rows={3} {...form.register('notes')} className={`${formInputClass} resize-none`}></textarea>
            </div>

            <div>
              <label htmlFor="edit-space-reason" className={formLabelClass}>Motivo de actualización</label>
              <textarea id="edit-space-reason" rows={2} aria-invalid={errors.reason ? true : undefined} {...form.register('reason')} placeholder="Ej: corrección de tarifa, actualización de ubicación o medidas" className={`${formInputClass} bg-white resize-none`}></textarea>
              <FieldError error={errors.reason} />
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={() => setEditingSpace(null)} className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
              <button type="submit" disabled={isActionLoading} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
                {isActionLoading ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
  );
}

export default function EditSpaceSheet(){
const { editingSpace, setEditingSpace } = useSpaces();
return (<Drawer
        isOpen={Boolean(editingSpace)}
        onClose={() => setEditingSpace(null)}
        title={`Editar ${editingSpace?.name || 'espacio'}`}
      >
        {editingSpace && <EditSpaceForm space={editingSpace} />}
      </Drawer>);
}
