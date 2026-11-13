import { useApiMutation } from './lib/useApiMutation';
import React, { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { StaffUser } from './types';
import SimulatorDrawer from './components/access/SimulatorDrawer';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import { DataProvider } from './app/DataProvider';
import { MutationErrorNotice } from './app/MutationErrorNotice';
import { FinanceRedirect } from './features/finance/pages/financeRoutes';

// El login y el cambio de clave cargan su validación solo cuando se muestran.
const LoginPage = lazy(() => import('./components/auth/LoginPage'));
const ChangePasswordForm = lazy(() => import('./components/auth/ChangePasswordForm').then(module => ({ default: module.ChangePasswordForm })));
const MerchantValidationPage = lazy(() => import('./features/pricing/pages/MerchantValidationPage'));
const PublicPaymentPage = lazy(() => import('./features/payments/pages/PublicPaymentPage'));
const PaymentResultPage = lazy(() => import('./features/payments/pages/PublicPaymentPage').then(module => ({ default: module.PaymentResultPage })));
const SimulatedGatewayPage = lazy(() => import('./features/payments/pages/SimulatedGatewayPage'));
const ResetPasswordPage = lazy(() => import('./components/auth/ResetPasswordPage'));
const SignupPage = lazy(() => import('./features/saas/pages/SignupPage'));
const VerifyEmailPage = lazy(() => import('./features/saas/pages/VerifyEmailPage'));
const OnboardingPage = lazy(() => import('./features/saas/pages/OnboardingPage'));
const PlatformPage = lazy(() => import('./features/saas/pages/PlatformPage'));
const PrivacyPage = lazy(() => import('./features/saas/pages/PrivacyPage'));
const SubscriptionPage = lazy(() => import('./features/saas/pages/SubscriptionPage'));
const DevicesPage = lazy(() => import('./features/phase7/pages/DevicesPage'));
const PortalPage = lazy(() => import('./features/phase7/pages/PortalPage'));
const OperatorPage = lazy(() => import('./features/operator/pages/OperatorPage'));
const Dashboard = lazy(() => import('./features/dashboard/pages/Dashboard'));
const AccessPage = lazy(() => import('./features/access/pages/AccessPage'));
const AuditPage = lazy(() => import('./features/audit/pages/AuditPage'));
const ClientsPage = lazy(() => import('./features/clients/pages/ClientsPage'));
const ContractsPage = lazy(() => import('./features/contracts/pages/ContractsPage'));
const DocumentsPage = lazy(() => import('./features/documents/pages/DocumentsPage'));
const FinancePage = lazy(() => import('./features/finance/pages/FinancePage'));
const FinancePaymentsPage = lazy(() => import('./features/finance/pages/PaymentsPage'));
const FinanceCollectionsPage = lazy(() => import('./features/finance/pages/CollectionsPage'));
const FinanceExpensesPage = lazy(() => import('./features/finance/pages/ExpensesPage'));
const FinanceBankPage = lazy(() => import('./features/finance/pages/BankPage'));
const FinanceInvoicesPage = lazy(() => import('./features/finance/pages/InvoicesPage'));
const FinanceClosuresPage = lazy(() => import('./features/finance/pages/ClosuresPage'));
const FinanceReportsPage = lazy(() => import('./features/finance/pages/ReportsPage'));
const SettingsPage = lazy(() => import('./features/settings/pages/SettingsPage'));
const SpacesPage = lazy(() => import('./features/spaces/pages/SpacesPage'));
const StaffPage = lazy(() => import('./features/staff/pages/StaffPage'));
const TasksPage = lazy(() => import('./features/tasks/pages/TasksPage'));

// Último usuario conocido: permite abrir la app instalada sin red (la sesión sigue vigente en el servidor).
const USER_CACHE_KEY = 'parkia.cachedUser';
const readCachedUser = (): StaffUser | null => {
  try { return JSON.parse(localStorage.getItem(USER_CACHE_KEY) || 'null'); } catch { return null; }
};
const rememberUser = (user: StaffUser) => { try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user)); } catch { /* sin almacenamiento: solo se pierde el modo sin red */ } };
const forgetUser = () => { try { localStorage.removeItem(USER_CACHE_KEY); } catch { /* nada que olvidar */ } };

const PasswordChangeGate = ({ user, onChanged, onLogout }: { user: StaffUser, onChanged: () => void, onLogout: () => void }) => (
  <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Seguridad administrativa</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Cambia tu clave para continuar</h1>
        <p className="mt-2 text-sm text-slate-600">{user.email}</p>
      </div>
      <Suspense fallback={<p role="status" className="text-sm text-slate-600">Cargando...</p>}><ChangePasswordForm onChanged={onChanged} /></Suspense>
      <button type="button" onClick={onLogout} className="mt-4 w-full min-h-11 rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
        Cerrar sesión
      </button>
    </div>
  </div>
);

export default function App() {
  const apiWrite = useApiMutation("App.tsx");
  const publicPath = window.location.pathname.replace(/\/+$/, '');
  const isPublicValidation = publicPath === '/validar';
  const isPasswordReset = publicPath === '/restablecer';
  const isPublicSignup = publicPath === '/registro';
  const isVerifyEmail = publicPath === '/verificar-correo';
  const isPortal = publicPath === '/portal';
  const publicPayment = publicPath.startsWith('/pagar/') ? publicPath.slice('/pagar/'.length) : null;
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [resendVerificationStatus, setResendVerificationStatus] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async res => {
        if (res.ok) {
          const data = await res.json();
          if (data?.user) {
            setCurrentUser(data.user);
            setIsPlatformAdmin(Boolean(data.is_platform_admin));
            rememberUser(data.user);
          }
          return;
        }
        // 401: la sesión terminó de verdad. Otro error (proxy caído, 5xx): se sigue con el último usuario conocido.
        if (res.status === 401 || res.status === 403) { forgetUser(); return; }
        const cached = readCachedUser();
        if (cached) setCurrentUser(cached);
      })
      .catch(() => {
        const cached = readCachedUser();
        if (cached) setCurrentUser(cached);
      })
      .finally(() => setIsAuthLoading(false));
  }, []);
  const handleLogout = async () => {
    const response = await apiWrite.request('/api/auth/logout', { method: 'POST', credentials: 'include' });
    if (response.ok) {
      // El siguiente usuario de este dispositivo no debe ver datos ni operaciones del anterior.
      forgetUser();
      // Dexie se descarga solo aquí: no debe pesar en la carga inicial de la app.
      await import('./features/operator/offline/db').then(module => module.clearOperatorData()).catch(() => undefined);
      setCurrentUser(null);
      setIsPlatformAdmin(false);
    }
  };
  const handleStopImpersonation = async () => {
    const response = await apiWrite.request('/api/platform/stop-impersonation', {
      method: 'POST',
      credentials: 'include',
    });
    if (response.ok) {
      window.location.href = '/plataforma';
    }
  };
  const handleResendVerification = async () => {
    if (!currentUser) return;
    const response = await apiWrite.request('/api/public/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: currentUser.email }),
    });
    const data = await response.json().catch(() => ({}));
    setResendVerificationStatus(data.message || data.error || 'Revisa tu correo.');
  };
  if (isPublicSignup) {
    return <Suspense fallback={<div className="min-h-screen bg-slate-950" />}><SignupPage /></Suspense>;
  }
  if (isVerifyEmail) {
    return <Suspense fallback={<div className="min-h-screen bg-slate-950" />}><VerifyEmailPage /></Suspense>;
  }
  if (isPortal) {
    return <Suspense fallback={<div className="min-h-screen bg-slate-950" />}><PortalPage /></Suspense>;
  }
  if (isPasswordReset) {
    return <Suspense fallback={<div className="min-h-screen bg-slate-950" />}><ResetPasswordPage /></Suspense>;
  }
  if (isPublicValidation) {
    return <Suspense fallback={<div className="min-h-screen bg-slate-50" />}><MerchantValidationPage /></Suspense>;
  }
  if (publicPayment !== null) {
    // Paginas de pago del cliente: no requieren sesion.
    const page = publicPayment === 'resultado' ? <PaymentResultPage />
      : publicPayment.startsWith('simulado/') ? <SimulatedGatewayPage token={publicPayment.slice('simulado/'.length)} />
        : <PublicPaymentPage token={publicPayment} />;
    return <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>{page}</Suspense>;
  }
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white text-sm font-bold">
        Cargando...
      </div>
    );
  }
  if (!currentUser) {
    return <Suspense fallback={<div className="min-h-screen bg-slate-950" />}><LoginPage onLogin={user => { rememberUser(user); setCurrentUser(user); }} /></Suspense>;
  }
  if (currentUser.must_change_password) {
    return (
      <PasswordChangeGate
        user={currentUser}
        onChanged={() => setCurrentUser({ ...currentUser, must_change_password: false })}
        onLogout={handleLogout}
      />
    );
  }
  if (currentUser.email_verified === false) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Verificación pendiente</p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">Confirma tu correo para operar</h1>
            <p className="mt-2 text-sm text-slate-600">
              Enviamos un enlace de confirmación a <span className="font-semibold">{currentUser.email}</span>.
            </p>
          </div>
          {resendVerificationStatus && (
            <p role="status" className="rounded-xl bg-slate-100 p-3 text-xs font-medium text-slate-800">
              {resendVerificationStatus}
            </p>
          )}
          <button
            type="button"
            onClick={handleResendVerification}
            className="min-h-11 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800"
          >
            Reenviar correo de confirmación
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="min-h-11 w-full rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }
  return (
    <DataProvider key={currentUser.id}><Router>
      <div className="min-h-screen bg-slate-50 flex">
        <Sidebar user={currentUser} isPlatformAdmin={isPlatformAdmin} />
        <main className="flex-1 md:ml-[72px] xl:ml-64 min-h-screen flex flex-col relative pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 min-w-0">
          <Header user={currentUser} onLogout={handleLogout} />
          {currentUser.impersonation && (
            <div
              role="status"
              className="mx-4 mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950"
            >
              <div className="text-xs sm:text-sm">
                <strong>Modo soporte activo:</strong> viendo empresa #{currentUser.impersonation.tenant_id} ({currentUser.impersonation.reason})
              </div>
              <button
                type="button"
                onClick={() => void handleStopImpersonation()}
                disabled={apiWrite.isPending}
                className="min-h-9 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-950 disabled:opacity-50"
              >
                Salir de suplantación
              </button>
            </div>
          )}
          {apiWrite.error && <p role="alert" className="m-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{apiWrite.error.message}</p>}
          <MutationErrorNotice />
          <SimulatorDrawer />
          <div className="flex-1">
            <AnimatePresence mode="wait">
              <Suspense fallback={<div className="p-8 text-sm font-bold text-slate-400">Cargando modulo...</div>}>
                <Routes>
                  <Route path="/" element={<Dashboard user={currentUser} />} />
                  <Route path="/inicio" element={currentUser.role === 'admin' ? <OnboardingPage /> : <Navigate to="/" />} />
                  <Route path="/operar" element={['admin', 'guard', 'cashier'].includes(currentUser.role) ? <OperatorPage /> : <Navigate to="/" />} />
                  <Route path="/clients" element={['admin', 'finance'].includes(currentUser.role) ? <ClientsPage /> : <Navigate to="/" />} />
                  <Route path="/spaces" element={<SpacesPage user={currentUser} />} />
                  <Route path="/tasks" element={<TasksPage user={currentUser} />} />
                  <Route path="/contracts" element={['admin', 'finance'].includes(currentUser.role) ? <ContractsPage /> : <Navigate to="/" />} />
                  <Route path="/documents" element={['admin', 'finance'].includes(currentUser.role) ? <DocumentsPage /> : <Navigate to="/" />} />
                  <Route path="/finance" element={['admin', 'finance'].includes(currentUser.role) ? <FinanceRedirect /> : <Navigate to="/" />} />
                  <Route path="/finanzas" element={['admin', 'finance'].includes(currentUser.role) ? <FinancePage user={currentUser} /> : <Navigate to="/" />}>
                    <Route index element={<Navigate replace to="pagos" />} />
                    <Route path="pagos" element={<FinancePaymentsPage />} />
                    <Route path="cobranza" element={<FinanceCollectionsPage />} />
                    <Route path="gastos" element={<FinanceExpensesPage />} />
                    <Route path="banco" element={<FinanceBankPage />} />
                    <Route path="documentos-tributarios" element={<FinanceInvoicesPage />} />
                    <Route path="reportes" element={<FinanceReportsPage />} />
                    <Route path="cierres" element={<FinanceClosuresPage />} />
                  </Route>
                  <Route path="/access" element={['admin', 'guard'].includes(currentUser.role) ? <AccessPage user={currentUser} /> : <Navigate to="/" />} />
                  <Route path="/audit" element={currentUser.role === 'admin' ? <AuditPage /> : <Navigate to="/" />} />
                  <Route path="/staff" element={currentUser.role === 'admin' ? <StaffPage /> : <Navigate to="/" />} />
                  <Route path="/settings" element={currentUser.role === 'admin' ? <SettingsPage /> : <Navigate to="/" />} />
                  <Route path="/privacidad" element={currentUser.role === 'admin' ? <PrivacyPage /> : <Navigate to="/" />} />
                  <Route path="/suscripcion" element={['admin', 'finance'].includes(currentUser.role) ? <SubscriptionPage /> : <Navigate to="/" />} />
                  <Route path="/dispositivos" element={['admin', 'guard'].includes(currentUser.role) ? <DevicesPage /> : <Navigate to="/" />} />
                  <Route path="/plataforma" element={isPlatformAdmin ? <PlatformPage /> : <Navigate to="/" />} />
                </Routes>
              </Suspense>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </Router></DataProvider>
  );
}
