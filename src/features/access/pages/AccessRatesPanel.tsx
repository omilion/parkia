import { Settings2 } from 'lucide-react';

import { useAccess } from './AccessContext';
export default function AccessRatesPanel(){
const { fetchData, rates, setDrawerType, setIsDrawerOpen, setSelectedRate } = useAccess();
return (<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {rates.length === 0 && (
              <div className="md:col-span-3 glass-card p-6 flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-base font-bold text-slate-900">Sin tarifas configuradas</h4>
                  <p className="text-sm text-slate-600 mt-1">Las tarifas base se crean automáticamente al iniciar el sistema.</p>
                </div>
                <button
                  onClick={fetchData}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50"
                >
                  Actualizar
                </button>
              </div>
            )}
            {rates.map(rate => (
              <div key={rate.id} className="glass-card p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div className="p-3 bg-slate-100 rounded-2xl">
                    <Settings2 className="w-6 h-6 text-slate-600" />
                  </div>
                  <button
                    onClick={() => { setSelectedRate(rate); setDrawerType('rate'); setIsDrawerOpen(true); }}
                    className="text-xs font-bold text-blue-600 hover:underline"
                  >
                    Editar
                  </button>
                </div>
                <div>
                  <h4 className="text-lg font-bold">{rate.type}</h4>
                  <p className="text-sm text-slate-600">Cobro por minuto efectivo, sin redondeo al alza</p>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Tarifa / Min</p>
                    <p className="text-xl font-bold">${Number(rate.rate_per_minute || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Gracia (Mins)</p>
                    <p className="text-xl font-bold">{rate.grace_period_mins}m</p>
                  </div>
                </div>
              </div>
            ))}
          </div>);
}
