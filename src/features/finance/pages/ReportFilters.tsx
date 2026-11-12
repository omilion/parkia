import { Clock, Download } from 'lucide-react';

import { useFinance } from './FinanceContext';

export default function ReportFilters() {
const { downloadFile, reportMonth, setReportMonth, withBranch } = useFinance();
return (<div className="flex flex-wrap justify-between gap-3">
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                <Clock className="w-4 h-4 text-slate-600" />
                <input aria-label="Mes del informe"
                  type="month"
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                  className="bg-transparent border-none outline-none text-sm font-bold text-slate-700"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => downloadFile(`/api/finance/export/operational-close.xlsx?month=${reportMonth}`, `checklist-operacional-${reportMonth}.xlsx`)}
                  className="px-4 py-3 bg-emerald-700 text-white rounded-2xl text-sm font-bold hover:bg-emerald-800 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Exportar checklist
                </button>
                <button
                  onClick={() => downloadFile(`/api/finance/export/monthly-close.xlsx?month=${reportMonth}`, `cierre-mensual-${reportMonth}.xlsx`)}
                  className="px-4 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Exportar cierre
                </button>
                <button
                  onClick={() => downloadFile(withBranch('/api/finance/export/payments.xlsx'), 'cuentas-por-cobrar.xlsx')}
                  className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Exportar pagos
                </button>
                <button
                  onClick={() => downloadFile(withBranch('/api/finance/export/payments.xlsx?status=overdue'), 'morosidad.xlsx')}
                  className="px-4 py-3 bg-red-600 text-white rounded-2xl text-sm font-bold hover:bg-red-700 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Exportar morosidad
                </button>
              </div>
            </div>);
}
