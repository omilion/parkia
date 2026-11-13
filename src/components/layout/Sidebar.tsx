import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Building2, CarFront, CheckSquare, ChevronLeft, ChevronRight, CreditCard, FileSearch, FileText, History, LayoutDashboard, Menu, MoreHorizontal, Settings, Shield, UserPlus, Users, X } from 'lucide-react';
import type { StaffUser } from '../../types';
import { cn } from '../../lib/utils';

const menuItems = [
  { icon: LayoutDashboard, label: 'Inicio', path: '/', roles: ['admin', 'finance', 'guard', 'cashier'] },
  { icon: CarFront, label: 'Operar', path: '/operar', roles: ['admin', 'guard', 'cashier'] },
  { icon: Users, label: 'Clientes', path: '/clients', roles: ['admin', 'finance'] },
  { icon: FileText, label: 'Contratos', path: '/contracts', roles: ['admin', 'finance'] },
  { icon: FileSearch, label: 'Documentos', path: '/documents', roles: ['admin', 'finance'] },
  { icon: CheckSquare, label: 'Tareas', path: '/tasks', roles: ['admin', 'finance', 'guard', 'cashier'] },
  { icon: CarFront, label: 'Plazas', path: '/spaces', roles: ['admin', 'finance', 'guard', 'cashier'] },
  { icon: CreditCard, label: 'Finanzas', path: '/finanzas/pagos', roles: ['admin', 'finance'] },
  { icon: Shield, label: 'Seguridad', path: '/access', roles: ['admin', 'guard'] },
  { icon: History, label: 'Auditoría', path: '/audit', roles: ['admin'] },
  { icon: UserPlus, label: 'Personal', path: '/staff', roles: ['admin'] },
  { icon: Settings, label: 'Configuración', path: '/settings', roles: ['admin'] },
];

// Hasta que existan /operar y las rutas de caja y cobranza, se muestran
// únicamente destinos ya disponibles para el rol.
const priorities: Record<string, string[]> = {
  admin: ['/', '/operar', '/finanzas/pagos', '/tasks'],
  finance: ['/', '/finanzas/pagos', '/clients', '/tasks'],
  guard: ['/operar', '/spaces', '/access', '/tasks'],
  cashier: ['/operar', '/spaces', '/', '/tasks'],
};

export default function Sidebar({ user, isPlatformAdmin = false }: { user: StaffUser; isPlatformAdmin?: boolean }) {
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const items = [
    ...menuItems.filter(item => item.roles.includes(user.role)),
    ...(isPlatformAdmin ? [{ icon: Building2, label: 'Plataforma', path: '/plataforma', roles: ['admin', 'finance', 'guard', 'cashier'] }] : []),
  ];
  const primary = (priorities[user.role] ?? []).map(path => items.find(item => item.path === path)).filter((item): item is typeof menuItems[number] => Boolean(item));
  const remaining = items.filter(item => !primary.includes(item));
  const isActive = (path: string) => path.startsWith('/finanzas/') ? location.pathname.startsWith('/finanzas/') : path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(`${path}/`);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (moreOpen && !dialog.open) dialog.showModal();
    if (!moreOpen && dialog.open) dialog.close();
  }, [moreOpen]);

  return (
    <>
      <aside className={cn('hidden md:flex fixed left-0 top-0 h-dvh bg-white border-r border-slate-200 flex-col z-50 transition-[width] duration-200', expanded ? 'w-64 shadow-xl xl:shadow-none' : 'w-[72px] xl:w-64')}>
        <div className="h-20 flex items-center gap-3 px-4 shrink-0">
          <div className={cn("w-10 h-10 shrink-0 bg-slate-900 rounded-xl items-center justify-center text-white font-bold text-xl", expanded ? "flex" : "hidden xl:flex")}>P</div>
          <span className={cn('text-xl font-bold tracking-tight', expanded ? 'block' : 'hidden xl:block')}>Parkia</span>
          <button type="button" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Contraer navegación' : 'Expandir navegación'} aria-expanded={expanded} className="hidden md:flex xl:hidden ml-auto min-w-11 min-h-11 items-center justify-center rounded-xl hover:bg-slate-100">
            {expanded ? <ChevronLeft className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {items.map(item => <Link key={item.path} to={item.path} title={item.label} aria-label={item.label} aria-current={isActive(item.path) ? 'page' : undefined} onClick={() => setExpanded(false)} className={cn('min-h-11 flex items-center gap-3 rounded-xl px-3 transition-colors', isActive(item.path) ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>
            <item.icon aria-hidden="true" className="w-5 h-5 shrink-0" />
            <span className={cn('font-medium whitespace-nowrap', expanded ? 'block' : 'hidden xl:block')}>{item.label}</span>
          </Link>)}
        </nav>
        <div className="border-t border-slate-200 p-3 flex items-center gap-3 min-h-16">
          <div className="w-10 h-10 shrink-0 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">{user.name.charAt(0)}</div>
          <div className={cn('min-w-0', expanded ? 'block' : 'hidden xl:block')}><p className="text-sm font-semibold truncate">{user.name}</p><p className="text-xs text-slate-600 truncate">{user.role}</p></div>
        </div>
      </aside>

      <nav aria-label="Navegación móvil" className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-stretch justify-around">
          {primary.map(item => <Link key={item.path} to={item.path} aria-current={isActive(item.path) ? 'page' : undefined} className={cn('min-w-0 flex-1 min-h-14 rounded-xl flex flex-col items-center justify-center gap-1 text-xs font-semibold', isActive(item.path) ? 'text-indigo-700 bg-indigo-50' : 'text-slate-600')}>
            <item.icon aria-hidden="true" className="w-5 h-5" /><span className="truncate max-w-full px-1">{item.label}</span>
          </Link>)}
          {remaining.length > 0 && <button type="button" aria-haspopup="dialog" onClick={() => setMoreOpen(true)} className={cn('min-w-0 flex-1 min-h-14 rounded-xl flex flex-col items-center justify-center gap-1 text-xs font-semibold', remaining.some(item => isActive(item.path)) ? 'text-indigo-700 bg-indigo-50' : 'text-slate-600')}><MoreHorizontal aria-hidden="true" className="w-5 h-5" />Más</button>}
        </div>
      </nav>
      <dialog ref={dialogRef} onClose={() => setMoreOpen(false)} onClick={event => { if (event.target === event.currentTarget) setMoreOpen(false); }} aria-labelledby="more-nav-title" className="fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none max-h-[80dvh] rounded-t-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-950/50 md:hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200"><h2 id="more-nav-title" className="text-lg font-bold">Más opciones</h2><button type="button" aria-label="Cerrar menú" onClick={() => setMoreOpen(false)} className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-slate-100"><X className="w-5 h-5" /></button></div>
        <div className="overflow-y-auto max-h-[65dvh] px-3 py-2 pb-[max(1rem,env(safe-area-inset-bottom))]">{remaining.map(item => <Link key={item.path} to={item.path} onClick={() => setMoreOpen(false)} aria-current={isActive(item.path) ? 'page' : undefined} className={cn('min-h-12 flex items-center gap-3 rounded-xl px-3 font-medium', isActive(item.path) ? 'text-indigo-700 bg-indigo-50' : 'text-slate-700 hover:bg-slate-100')}><item.icon aria-hidden="true" className="w-5 h-5" /><span>{item.label}</span><ChevronRight aria-hidden="true" className="w-4 h-4 ml-auto" /></Link>)}</div>
      </dialog>
    </>
  );
}

