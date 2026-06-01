import { Link, useLocation } from 'react-router-dom';
import { CarFront, CheckSquare, CreditCard, FileSearch, FileText, History, LayoutDashboard, Settings, Shield, UserPlus, Users } from 'lucide-react';
import type { StaffUser } from '../../types';
import { cn } from '../../lib/utils';

const Sidebar = ({ user }: { user: StaffUser }) => {
  const location = useLocation();
  const menuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/', roles: ['admin', 'finance', 'guard', 'cashier'] },
    { icon: Users, label: 'Clientes', path: '/clients', roles: ['admin', 'finance'] },
    { icon: FileText, label: 'Contratos', path: '/contracts', roles: ['admin', 'finance'] },
    { icon: FileSearch, label: 'Documentos', path: '/documents', roles: ['admin', 'finance'] },
    { icon: CheckSquare, label: 'Tareas', path: '/tasks', roles: ['admin', 'finance', 'guard', 'cashier'] },
    { icon: CarFront, label: 'Estacionamientos', path: '/spaces', roles: ['admin', 'finance', 'guard', 'cashier'] },
    { icon: CreditCard, label: 'Finanzas', path: '/finance', roles: ['admin', 'finance'] },
    { icon: Shield, label: 'Seguridad', path: '/access', roles: ['admin', 'guard'] },
    { icon: History, label: 'Auditoría', path: '/audit', roles: ['admin'] },
    { icon: UserPlus, label: 'Personal', path: '/staff', roles: ['admin'] },
    { icon: Settings, label: 'Configuración', path: '/settings', roles: ['admin'] },
  ];

  const filteredItems = menuItems.filter(item => item.roles.includes(user.role));

  return (
    <>
      <aside className="hidden lg:flex w-64 h-screen fixed left-0 top-0 bg-white border-r border-slate-200 flex-col z-50">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white font-bold text-xl">
            P
          </div>
          <h1 className="text-xl font-bold tracking-tight">Parkia</h1>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1">
          {filteredItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
                  isActive
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <item.icon className={cn("w-5 h-5", isActive ? "text-white" : "text-slate-400 group-hover:text-slate-900")} />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="bg-slate-50 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-semibold truncate">{user.name}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">{user.role}</p>
            </div>
            {user.role === 'admin' && (
              <Link
                to="/settings"
                title="Configuración"
                aria-label="Ir a configuración"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-white transition-colors"
              >
                <Settings className="w-4 h-4" />
              </Link>
            )}
          </div>
        </div>
      </aside>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-t border-slate-200 px-2 py-2 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {filteredItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "w-16 h-14 rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition-colors",
                  isActive ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
                )}
                title={item.label}
              >
                <item.icon className={cn("w-5 h-5", isActive ? "text-white" : "text-slate-400")} />
                <span className="truncate max-w-full px-1">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
};

export default Sidebar;

