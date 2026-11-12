import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { spaceMapFieldsSchema } from '../../../../shared/schemas/spaces';
import { useSpaces } from './SpacesContext';

export default function CreateMapSheet(){
const { branches, handleCreateSpaceMap, isActionLoading, isMapCreateDrawerOpen, selectedBranchId, setIsMapCreateDrawerOpen } = useSpaces();
const [image, setImage] = useState<File | null>(null);
const [imageError, setImageError] = useState('');
const form = useForm({
  resolver: zodResolver(spaceMapFieldsSchema),
  defaultValues: { branch_id: selectedBranchId === 'all' ? '' : String(selectedBranchId), name: '', is_default: false },
});
const { errors } = form.formState;
const submit = form.handleSubmit(values => {
  if (!image) {
    setImageError('Selecciona una imagen JPG o PNG');
    return;
  }
  return handleCreateSpaceMap(values, image);
}, () => { if (!image) setImageError('Selecciona una imagen JPG o PNG'); });
return (<Drawer
        isOpen={isMapCreateDrawerOpen}
        onClose={() => setIsMapCreateDrawerOpen(false)}
        title="Crear Mapa Aéreo"
      >
        <form noValidate onSubmit={submit} className="space-y-6">
          <div>
            <label htmlFor="map-branch" className={formLabelClass}>Sucursal</label>
            <select id="map-branch" aria-invalid={errors.branch_id ? true : undefined} {...form.register('branch_id')} className={formInputClass}>
              <option value="" disabled>Selecciona una sucursal</option>
              {branches.filter(branch => branch.status === 'active').map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
            <FieldError error={errors.branch_id} />
          </div>

          <div>
            <label htmlFor="map-name" className={formLabelClass}>Nombre del mapa</label>
            <input id="map-name" aria-invalid={errors.name ? true : undefined} {...form.register('name')} placeholder="Ej: Patio norte aéreo" className={formInputClass} />
            <FieldError error={errors.name} />
          </div>

          <div>
            <label htmlFor="map-image" className={formLabelClass}>Imagen JPG/PNG</label>
            <input id="map-image"
              type="file"
              accept="image/png,image/jpeg"
              aria-invalid={imageError ? true : undefined}
              aria-describedby="map-image-hint"
              onChange={event => { setImage(event.target.files?.[0] || null); setImageError(''); }}
              className="w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
            />
            <p id="map-image-hint" className="mt-2 text-xs text-slate-600">Máximo 10MB. Se guardan dimensiones reales para mantener coordenadas normalizadas.</p>
            <FieldError error={imageError ? { message: imageError } : undefined} />
          </div>

          <label className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-600">
            <input type="checkbox" {...form.register('is_default')} className="h-4 w-4 accent-slate-900" />
            Usar como mapa por defecto de la sucursal
          </label>

          <div className="pt-6 border-t border-slate-100 flex gap-4">
            <button type="button" onClick={() => setIsMapCreateDrawerOpen(false)} className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
            <button type="submit" disabled={isActionLoading} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
              {isActionLoading ? 'Creando...' : 'Crear mapa'}
            </button>
          </div>
        </form>
      </Drawer>);
}
