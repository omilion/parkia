import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Banknote, Eye, EyeOff, FileSpreadsheet } from 'lucide-react';
import { FieldError, formLabelClass } from '../../../ui';
import { integrationSettingsSchema, type IntegrationSettingsValues } from '../../../../shared/schemas/settings';
import type { SystemConfig } from '../../../types';

const selectClass = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base md:text-sm font-bold focus:bg-white focus:border-slate-900 outline-none transition-all';
const secretClass = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base md:text-sm font-mono focus:bg-white focus:border-slate-900 outline-none transition-all pr-12 aria-[invalid=true]:border-red-500';

function SecretInput({ id, label, visible, onToggle, toggleLabel, error, registration }: {
  id: string; label: string; visible: boolean; onToggle: () => void; toggleLabel: [string, string];
  error?: { message?: string }; registration: ReturnType<ReturnType<typeof useForm<any>>['register']>;
}) {
  return (
    <div>
      <label htmlFor={id} className={formLabelClass}>{label}</label>
      <div className="relative">
        <input id={id} type={visible ? 'text' : 'password'} autoComplete="off" aria-invalid={error ? true : undefined} {...registration} className={secretClass} />
        <button
          type="button"
          onClick={onToggle}
          aria-label={visible ? toggleLabel[1] : toggleLabel[0]}
          className="absolute right-1 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center text-slate-600 hover:text-slate-900"
        >
          {visible ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
      <FieldError error={error} />
    </div>
  );
}

/** Modo de emisión SII y credenciales de integraciones externas. */
export function IntegrationSettingsForm({ config, onSubmit, isSaving }: {
  config: SystemConfig; onSubmit: (values: IntegrationSettingsValues) => Promise<unknown>; isSaving: boolean;
}) {
  const [visible, setVisible] = useState({ sii: false, bank: false });
  const form = useForm({
    resolver: zodResolver(integrationSettingsSchema),
    defaultValues: {
      sii_mode: (config.sii_mode || 'mock') as IntegrationSettingsValues['sii_mode'],
      sii_provider: (config.sii_provider || 'local_mock') as IntegrationSettingsValues['sii_provider'],
      sii_environment: (config.sii_environment || 'demo') as IntegrationSettingsValues['sii_environment'],
      sii_api_key: config.sii_api_key || '',
      bank_api_key: config.bank_api_key || '',
    },
  });
  const { errors } = form.formState;
  return (
    <form noValidate aria-label="Integraciones" onSubmit={form.handleSubmit(onSubmit)} className="max-w-2xl space-y-8">
      <div className="space-y-6">
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <FileSpreadsheet className="w-5 h-5" aria-hidden="true" />
            </div>
            <h4 className="font-bold">Servicio de Impuestos Internos (SII)</h4>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
            <p className="text-sm font-bold text-amber-900">Integración desacoplada por proveedor</p>
            <p className="mt-1 text-xs text-amber-800">
              Usa el mock local solo para demo/piloto. El modo real queda bloqueado hasta implementar y certificar un proveedor SII externo.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="integration-sii-mode" className={formLabelClass}>Modo emisión</label>
              <select id="integration-sii-mode" {...form.register('sii_mode')} className={selectClass}>
                <option value="mock">Mock local</option>
                <option value="disabled">Deshabilitado</option>
                <option value="real">Proveedor real</option>
              </select>
            </div>
            <div>
              <label htmlFor="integration-sii-provider" className={formLabelClass}>Proveedor</label>
              <select id="integration-sii-provider" {...form.register('sii_provider')} className={selectClass}>
                <option value="local_mock">Local mock</option>
                <option value="sii_direct">SII directo (certificado de la empresa)</option>
                <option value="external_provider">Proveedor externo (pendiente)</option>
              </select>
            </div>
            <div>
              <label htmlFor="integration-sii-environment" className={formLabelClass}>Ambiente</label>
              <select id="integration-sii-environment" {...form.register('sii_environment')} className={selectClass}>
                <option value="demo">Demo</option>
                <option value="production">Producción</option>
              </select>
            </div>
          </div>
          <SecretInput
            id="integration-sii-key"
            label="API Token / Credenciales SII"
            visible={visible.sii}
            onToggle={() => setVisible(current => ({ ...current, sii: !current.sii }))}
            toggleLabel={['Mostrar credenciales SII', 'Ocultar credenciales SII']}
            error={errors.sii_api_key}
            registration={form.register('sii_api_key')}
          />
        </div>

        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-50 text-emerald-800 rounded-lg">
              <Banknote className="w-5 h-5" aria-hidden="true" />
            </div>
            <h4 className="font-bold">Conciliación Bancaria (CGVC)</h4>
          </div>
          <SecretInput
            id="integration-bank-key"
            label="API Token / Credenciales bancarias"
            visible={visible.bank}
            onToggle={() => setVisible(current => ({ ...current, bank: !current.bank }))}
            toggleLabel={['Mostrar credenciales bancarias', 'Ocultar credenciales bancarias']}
            error={errors.bank_api_key}
            registration={form.register('bank_api_key')}
          />
        </div>
      </div>
      <button type="submit" disabled={isSaving} className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
        Actualizar Credenciales
      </button>
    </form>
  );
}
