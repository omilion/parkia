import { PageHeader } from '../../../ui';

import { Tabs, LoadingState } from '../../../ui';

import React from 'react';
import { AnimatePresence } from 'motion/react';
import { Building2, UserPlus, Zap } from 'lucide-react';
import { StaffUser } from '../../../types';

import Toast from '../../../components/ui/Toast';

import type { AccessTabId } from './accessShared';
import { AccessContext, useAccess } from './AccessContext';
import { useAccessController } from '../hooks/useAccessController';
const LiveAccessPanel = React.lazy(() => import('./LiveAccessPanel'));
const VisitorPassesPanel = React.lazy(() => import('./VisitorPassesPanel'));
const ShiftLogPanel = React.lazy(() => import('./ShiftLogPanel'));
const AccessAuditPanel = React.lazy(() => import('./AccessAuditPanel'));
const AccessRatesPanel = React.lazy(() => import('./AccessRatesPanel'));
const AccessFormSheet = React.lazy(() => import('./AccessFormSheet'));
export default function AccessPage({user}: {user: StaffUser}) {const workspace=useAccessController(user);return <AccessContext.Provider value={workspace}><Shell /></AccessContext.Provider>;}
function Shell(){const { activeTab, branches, canManageRates, canViewAudit, handleTabChange, isDrawerOpen, isLoading, loadError, selectedBranchId, setAuditPage, setDrawerType, setIsDrawerOpen, setSelectedBranchId, setToast, toast } = useAccess();return (<div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      <PageHeader title={<>Seguridad y Accesos</>} description={<>Monitor en tiempo real, gestión de visitas y auditoría.</>} actions={<><div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 shadow-sm">
            <Building2 className="w-4 h-4 text-slate-600" />
            <select aria-label="Sucursal"
              value={selectedBranchId}
              onChange={event => {
                setSelectedBranchId(event.target.value);
                setAuditPage(1);
              }}
              className="bg-transparent outline-none"
            >
              <option value="all">Todas las sucursales</option>
              {branches.map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => { setDrawerType('visitor'); setIsDrawerOpen(true); }}
            className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all"
          >
            <UserPlus className="w-5 h-5" />
            Nuevo Pase Visita
          </button>
          <button
            onClick={() => { setDrawerType('override'); setIsDrawerOpen(true); }}
            className="px-6 py-3 bg-red-600 text-white rounded-2xl font-bold shadow-lg flex items-center gap-2 hover:bg-red-700 transition-all"
          >
            <Zap className="w-5 h-5" />
            Registrar Autorizacion Manual
          </button>
        </div></>} />

      {/* Tabs */}
      <Tabs label="Seguridad y accesos" value={activeTab} onValueChange={value => handleTabChange(value as AccessTabId)} items={[
        { value: 'live', label: 'En vivo' }, { value: 'visitors', label: 'Pases' }, { value: 'shift-log', label: 'Bitacora' },
        ...(canViewAudit ? [{ value: 'audit', label: 'Historial' }] : []), ...(canManageRates ? [{ value: 'rates', label: 'Tarifas' }] : []),
      ]} />
      {isLoading && <LoadingState label="Cargando accesos" />}{loadError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{loadError}</p>}

      {/* Tab Content */}
      <div className="min-h-[500px]">
        {activeTab === 'live' && <React.Suspense fallback={<LoadingState />}><LiveAccessPanel /></React.Suspense>}

        {activeTab === 'visitors' && <React.Suspense fallback={<LoadingState />}><VisitorPassesPanel /></React.Suspense>}

        {activeTab === 'shift-log' && <React.Suspense fallback={<LoadingState />}><ShiftLogPanel /></React.Suspense>}

        {canViewAudit && activeTab === 'audit' && <React.Suspense fallback={<LoadingState />}><AccessAuditPanel /></React.Suspense>}

        {canManageRates && activeTab === 'rates' && <React.Suspense fallback={<LoadingState />}><AccessRatesPanel /></React.Suspense>}
      </div>

      {(isDrawerOpen) && <React.Suspense fallback={<LoadingState />}><AccessFormSheet /></React.Suspense>}
    </div>);}
