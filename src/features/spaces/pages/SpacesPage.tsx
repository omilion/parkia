import { PageHeader } from '../../../ui';

import { LoadingState } from '../../../ui';

import React from 'react';
import { AnimatePresence } from 'motion/react';
import { Box, Car, Plus, Ticket, Upload } from 'lucide-react';
import { StaffUser } from '../../../types';

import Toast from '../../../components/ui/Toast';

import { cn } from '../../../lib/utils';

import { SpacesContext, useSpaces } from './SpacesContext';
import { useSpacesController } from '../hooks/useSpacesController';
const ParkingPanel = React.lazy(() => import('./ParkingPanel'));
const VisitorOperationsPanel = React.lazy(() => import('./VisitorOperationsPanel'));
const SpaceDetailSheet = React.lazy(() => import('./SpaceDetailSheet'));
const VisitorEntrySheet = React.lazy(() => import('./VisitorEntrySheet'));
const CreateSpaceSheet = React.lazy(() => import('./CreateSpaceSheet'));
const CreateMapSheet = React.lazy(() => import('./CreateMapSheet'));
const EditSpaceSheet = React.lazy(() => import('./EditSpaceSheet'));
const CashCloseSheet = React.lazy(() => import('./CashCloseSheet'));
const VisitorPaymentSheet = React.lazy(() => import('./VisitorPaymentSheet'));
const VisitorReceiptSheet = React.lazy(() => import('./VisitorReceiptSheet'));
const SpaceActionDialog = React.lazy(() => import('./SpaceActionDialog'));
export default function SpacesPage({user}: {user: StaffUser}) {const workspace=useSpacesController(user);return <SpacesContext.Provider value={workspace}><Shell /></SpacesContext.Provider>;}
function Shell(){const { activeType, canCreateSpaces, canManageVisitors, confirmAction, editingSpace, isCashCloseDrawerOpen, isCreateDrawerOpen, isDrawerOpen, isInventoryOnly, isMapCreateDrawerOpen, isVisitorTicketDrawerOpen, operationsError, operationsLoading, parkingMode, setActiveType, setIsCreateDrawerOpen, setIsMapCreateDrawerOpen, setIsVisitorTicketDrawerOpen, setToast, toast, visitorPayment, visitorReceipt } = useSpaces();return (<div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      <PageHeader title={<>Control de Espacios</>} description={<>{isInventoryOnly ? 'Inventario comercial de ocupación, tarifas y asignaciones.' : 'Monitoreo de ocupación y gestión de activos físicos.'}</>} actions={<><div className="flex overflow-x-auto bg-slate-100 p-1.5 rounded-2xl" role="tablist" aria-label="Tipo de espacio">
          {[
            { id: 'parking', label: 'Estacionamientos', icon: Car },
            ...(canManageVisitors ? [{ id: 'visitors', label: 'Visitas', icon: Ticket }] : [])
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveType(tab.id as any)}
              role="tab"
              aria-selected={activeType === tab.id}
              className={cn(
                "px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
                activeType === tab.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-700"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div></>} />

      {operationsLoading && <LoadingState label="Cargando plazas" />}{operationsError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{operationsError}</p>}
      <div className="flex justify-end">
        {canCreateSpaces && activeType !== 'visitors' && (
          <div className="flex flex-wrap justify-end gap-3">
            {parkingMode === 'map' && (
              <button
                onClick={() => setIsMapCreateDrawerOpen(true)}
                className="px-5 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-50 transition-all"
              >
                <Upload className="w-5 h-5" />
                Nuevo Mapa
              </button>
            )}
            <button
              onClick={() => setIsCreateDrawerOpen(true)}
              className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all"
            >
              <Box className="w-5 h-5" />
              Nuevo Estacionamiento
            </button>
          </div>
        )}
        {canManageVisitors && activeType === 'visitors' && (
          <button
            onClick={() => setIsVisitorTicketDrawerOpen(true)}
            className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all"
          >
            <Plus className="w-5 h-5" />
            Crear Ticket
          </button>
        )}
      </div>

      {activeType !== 'visitors' ? <React.Suspense fallback={<LoadingState />}><ParkingPanel /></React.Suspense> : <React.Suspense fallback={<LoadingState />}><VisitorOperationsPanel /></React.Suspense>}

      {(isDrawerOpen) && <React.Suspense fallback={<LoadingState />}><SpaceDetailSheet /></React.Suspense>}
      {(isVisitorTicketDrawerOpen) && <React.Suspense fallback={<LoadingState />}><VisitorEntrySheet /></React.Suspense>}

      {(isCreateDrawerOpen) && <React.Suspense fallback={<LoadingState />}><CreateSpaceSheet /></React.Suspense>}

      {(isMapCreateDrawerOpen) && <React.Suspense fallback={<LoadingState />}><CreateMapSheet /></React.Suspense>}

      {(Boolean(editingSpace)) && <React.Suspense fallback={<LoadingState />}><EditSpaceSheet /></React.Suspense>}

      {(isCashCloseDrawerOpen) && <React.Suspense fallback={<LoadingState />}><CashCloseSheet /></React.Suspense>}

      {(Boolean(visitorPayment)) && <React.Suspense fallback={<LoadingState />}><VisitorPaymentSheet /></React.Suspense>}

      {(Boolean(visitorReceipt)) && <React.Suspense fallback={<LoadingState />}><VisitorReceiptSheet /></React.Suspense>}

      {(Boolean(confirmAction)) && <React.Suspense fallback={<LoadingState />}><SpaceActionDialog /></React.Suspense>}
    </div>);}
