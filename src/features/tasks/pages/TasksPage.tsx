import { useApiMutation } from '../../../lib/useApiMutation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetchJson } from '../../../lib/api';
import { TaskCreateForm } from '../components/TaskCreateForm';
import { FilterBar, LoadingState, PageHeader } from '../../../ui';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, Building2, CheckCircle2, Filter, RefreshCw, UserCheck } from 'lucide-react';
import type { Branch, OperationalTask, StaffUser, TaskComment } from '../../../types';
import Toast from '../../../components/ui/Toast';
import { TaskCard } from '../components/TaskCard';
import { canAssigneeHandleCategory, categoryLabels, fileToPayload, priorityLabels, statusLabels, taskCategoriesByRole, type Assignee, type TaskHistoryEvent } from '../taskShared';
import type { TaskCommentValues, TaskFormValues } from '../../../../shared/schemas/tasks';

type TaskSummary = {
  open: number;
  inProgress: number;
  done: number;
  cancelled: number;
  dueToday: number;
  overdue: number;
  assignedToMe: number;
  fromAlerts: number;
  fromShiftLogs: number;
  fromDocuments: number;
  criticalActive: number;
};

type StatusFilter = 'active' | OperationalTask['status'] | 'all';
type DueFilter = 'all' | 'today' | 'overdue';
type PriorityFilter = OperationalTask['priority'] | 'all';
type AssignedFilter = 'all' | 'me' | 'unassigned';
type SourceFilter =
  | 'all'
  | 'dashboard_alert'
  | 'guard_shift_log'
  | 'document'
  | 'finance_approval'
  | 'finance_payment_adjustment'
  | 'finance_expense_approval'
  | 'finance_monthly_close_approval'
  | 'finance_monthly_reopen_approval'
  | 'manual';

const sourceFilterValues: SourceFilter[] = [
  'dashboard_alert',
  'guard_shift_log',
  'document',
  'finance_approval',
  'finance_payment_adjustment',
  'finance_expense_approval',
  'finance_monthly_close_approval',
  'finance_monthly_reopen_approval',
  'manual',
];
const statusFilterValues: StatusFilter[] = ['active', 'all', 'open', 'in_progress', 'done', 'cancelled'];
const priorityFilterValues: PriorityFilter[] = ['all', 'low', 'medium', 'high', 'critical'];
const dueFilterValues: DueFilter[] = ['all', 'today', 'overdue'];
const assignedFilterValues: AssignedFilter[] = ['all', 'me', 'unassigned'];

const numberParam = (params: URLSearchParams, key: string) => {
  const value = Number(params.get(key) || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const statusFromParams = (params: URLSearchParams, focusedTaskId: number | null): StatusFilter => {
  const value = params.get('status') as StatusFilter | null;
  if (value && statusFilterValues.includes(value)) return value;
  return focusedTaskId ? 'all' : 'active';
};

const categoryFromParams = (params: URLSearchParams, allowedTaskCategories: OperationalTask['category'][]): OperationalTask['category'] | 'all' => {
  const value = params.get('category') as OperationalTask['category'] | 'all' | null;
  if (value === 'all') return 'all';
  if (value && allowedTaskCategories.includes(value as OperationalTask['category'])) return value as OperationalTask['category'];
  return 'all';
};

const priorityFromParams = (params: URLSearchParams): PriorityFilter => {
  const value = params.get('priority') as PriorityFilter | null;
  return value && priorityFilterValues.includes(value) ? value : 'all';
};

const dueFromParams = (params: URLSearchParams): DueFilter => {
  const value = params.get('due') as DueFilter | null;
  return value && dueFilterValues.includes(value) ? value : 'all';
};

const assignedFromParams = (params: URLSearchParams): AssignedFilter => {
  const value = params.get('assigned') as AssignedFilter | null;
  return value && assignedFilterValues.includes(value) ? value : 'all';
};

const sourceFromParams = (params: URLSearchParams): SourceFilter => {
  const value = params.get('source') as SourceFilter | null;
  return value && sourceFilterValues.includes(value) ? value : 'all';
};

const branchFromParams = (params: URLSearchParams) => {
  const value = params.get('branch');
  return value && /^\d+$/.test(value) ? value : 'all';
};

const TasksPage = ({ user }: { user: StaffUser }) => {
  const apiWrite = useApiMutation("features/tasks/pages");
  const location = useLocation();
  const initialParams = new URLSearchParams(location.search);
  const initialTaskId = numberParam(initialParams, 'taskId');
  const allowedTaskCategories = taskCategoriesByRole[user.role];
  const allowedCategoryEntries = Object.entries(categoryLabels).filter(([value]) =>
    allowedTaskCategories.includes(value as OperationalTask['category'])
  );
  const [selectedBranchId, setSelectedBranchId] = useState(branchFromParams(initialParams));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(statusFromParams(initialParams, initialTaskId));
  const [categoryFilter, setCategoryFilter] = useState<OperationalTask['category'] | 'all'>(categoryFromParams(initialParams, allowedTaskCategories));
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(priorityFromParams(initialParams));
  const [dueFilter, setDueFilter] = useState<DueFilter>(dueFromParams(initialParams));
  const [assignedFilter, setAssignedFilter] = useState<AssignedFilter>(assignedFromParams(initialParams));
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(sourceFromParams(initialParams));
  const [focusedTaskId, setFocusedTaskId] = useState<number | null>(initialTaskId);
  const [commentTaskId, setCommentTaskId] = useState<number | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [closeNotes, setCloseNotes] = useState<Record<number, string>>({});
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [historyTaskId, setHistoryTaskId] = useState<number | null>(null);
  const [historyEvents, setHistoryEvents] = useState<TaskHistoryEvent[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const isApplyingLocationFilters = useRef(false);
  const client = useQueryClient();
  const taskParams = new URLSearchParams({ status: statusFilter, category: categoryFilter === 'all' || allowedTaskCategories.includes(categoryFilter) ? categoryFilter : 'all', priority: priorityFilter, due: dueFilter, assigned: assignedFilter, source: sourceFilter });
  if (selectedBranchId !== 'all') taskParams.set('branch_id', selectedBranchId);
  const taskQuery = useQuery({ queryKey: ['tasks', 'list', taskParams.toString()], queryFn: ({ signal }) => apiFetchJson<OperationalTask[]>(`/api/tasks?${taskParams}`, { signal }) });
  const summaryQuery = useQuery({ queryKey: ['tasks', 'summary', selectedBranchId], queryFn: ({ signal }) => apiFetchJson<TaskSummary>(`/api/tasks/summary${selectedBranchId === 'all' ? '' : `?branch_id=${selectedBranchId}`}`, { signal }) });
  const assigneeQuery = useQuery({ queryKey: ['tasks', 'assignees'], queryFn: ({ signal }) => apiFetchJson<Assignee[]>('/api/tasks/assignees', { signal }) });
  const branchQuery = useQuery({ queryKey: ['branches'], queryFn: ({ signal }) => apiFetchJson<Branch[]>('/api/branches', { signal }) });
  const tasks = taskQuery.data ?? [];
  const summary = summaryQuery.data ?? null;
  const assignees = assigneeQuery.data ?? [];
  const branches = branchQuery.data ?? [];
  const isLoading = taskQuery.isPending;
  const fetchTasks = () => client.invalidateQueries({ queryKey: ['tasks'] });

  useEffect(() => {
    isApplyingLocationFilters.current = true;
    const params = new URLSearchParams(location.search);
    const nextFocusedTaskId = numberParam(params, 'taskId');
    setFocusedTaskId(nextFocusedTaskId);
    setStatusFilter(statusFromParams(params, nextFocusedTaskId));
    setCategoryFilter(categoryFromParams(params, allowedTaskCategories));
    setPriorityFilter(priorityFromParams(params));
    setDueFilter(dueFromParams(params));
    setAssignedFilter(assignedFromParams(params));
    setSourceFilter(sourceFromParams(params));
    setSelectedBranchId(branchFromParams(params));
  }, [location.search, user.role]);

  useEffect(() => {
    if (isApplyingLocationFilters.current) {
      isApplyingLocationFilters.current = false;
      return;
    }

    const params = new URLSearchParams();
    if (statusFilter !== 'active') params.set('status', statusFilter);
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    if (priorityFilter !== 'all') params.set('priority', priorityFilter);
    if (dueFilter !== 'all') params.set('due', dueFilter);
    if (assignedFilter !== 'all') params.set('assigned', assignedFilter);
    if (sourceFilter !== 'all') params.set('source', sourceFilter);
    if (selectedBranchId !== 'all') params.set('branch', selectedBranchId);
    if (focusedTaskId) params.set('taskId', String(focusedTaskId));

    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    if (window.location.pathname === '/tasks' && `${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [statusFilter, categoryFilter, priorityFilter, dueFilter, assignedFilter, sourceFilter, selectedBranchId, focusedTaskId]);

  useEffect(() => {
    if (categoryFilter !== 'all' && !allowedTaskCategories.includes(categoryFilter)) {
      setCategoryFilter('all');
      return;
    }
  }, [categoryFilter, user.role]);

  const applyQuickFilters = (filters: {
    status?: typeof statusFilter;
    category?: typeof categoryFilter;
    priority?: PriorityFilter;
    due?: DueFilter;
    assigned?: typeof assignedFilter;
    source?: typeof sourceFilter;
  }) => {
    setFocusedTaskId(null);
    setStatusFilter(filters.status ?? 'active');
    setCategoryFilter(filters.category ?? 'all');
    setPriorityFilter(filters.priority ?? 'all');
    setDueFilter(filters.due ?? 'all');
    setAssignedFilter(filters.assigned ?? 'all');
    setSourceFilter(filters.source ?? 'all');
  };

  const updateTask = async (task: OperationalTask, payload: Record<string, unknown>) => {
    setIsSaving(true);
    const res = await apiWrite.request(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (res.ok) {
      setToast({ message: 'Tarea actualizada.', type: 'success' });
      fetchTasks();
    } else {
      setToast({ message: result.error || 'No se pudo actualizar la tarea.', type: 'error' });
    }
    setIsSaving(false);
  };

  const startEditing = (task: OperationalTask) => setEditingTaskId(task.id);
  const cancelEditing = () => setEditingTaskId(null);

  const saveTaskEdit = async (task: OperationalTask, values: TaskFormValues) => {
    await updateTask(task, {
      ...values,
      assigned_staff_id: values.assigned_staff_id || null,
      branch_id: values.branch_id || null,
      due_date: values.due_date || null,
    });
    cancelEditing();
  };

  const fetchTaskHistory = async (task: OperationalTask) => {
    setHistoryTaskId(task.id);
    setIsHistoryLoading(true);
    const res = await fetch(`/api/tasks/${task.id}/history`);
    if (res.ok) {
      setHistoryEvents(await res.json());
    } else {
      setHistoryEvents([]);
      setToast({ message: 'No se pudo cargar el historial de la tarea.', type: 'error' });
    }
    setIsHistoryLoading(false);
  };

  const fetchTaskComments = async (task: OperationalTask) => {
    setCommentTaskId(task.id);
    const res = await fetch(`/api/tasks/${task.id}/comments`);
    if (res.ok) {
      setComments(await res.json());
    } else {
      setComments([]);
      setToast({ message: 'No se pudo cargar el seguimiento de la tarea.', type: 'error' });
    }
  };

  /** Devuelve true si el avance quedó guardado, para limpiar el formulario. */
  const addTaskComment = async (task: OperationalTask, { note }: TaskCommentValues, file: File | null): Promise<boolean> => {
    setIsSaving(true);
    try {
      const attachment = file && file.size > 0 ? await fileToPayload(file) : undefined;
      const res = await apiWrite.request(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, attachment }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'No se pudo guardar el comentario.');
      fetchTaskComments(task);
      setToast({ message: 'Seguimiento agregado.', type: 'success' });
      return true;
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo guardar el comentario.', type: 'error' });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const completeTask = async (task: OperationalTask) => {
    const note = closeNotes[task.id]?.trim() || '';
    setIsSaving(true);
    const res = await apiWrite.request(`/api/tasks/${task.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    const result = await res.json();
    if (res.ok) {
      setToast({ message: 'Tarea cerrada.', type: 'success' });
      setCloseNotes(prev => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });
      fetchTasks();
    } else {
      setToast({ message: result.error || 'No se pudo cerrar la tarea.', type: 'error' });
    }
    setIsSaving(false);
  };

  const cancelTask = async (task: OperationalTask) => {
    const note = closeNotes[task.id]?.trim() || '';
    if (!note) {
      setToast({ message: 'Anular una tarea requiere nota operacional.', type: 'error' });
      return;
    }
    await updateTask(task, { status: 'cancelled', status_note: note });
    setCloseNotes(prev => {
      const next = { ...prev };
      delete next[task.id];
      return next;
    });
  };

  const grouped = {
    open: tasks.filter(task => (!focusedTaskId || task.id === focusedTaskId) && task.status === 'open'),
    in_progress: tasks.filter(task => (!focusedTaskId || task.id === focusedTaskId) && task.status === 'in_progress'),
    done: tasks.filter(task => (!focusedTaskId || task.id === focusedTaskId) && task.status === 'done'),
    cancelled: tasks.filter(task => (!focusedTaskId || task.id === focusedTaskId) && task.status === 'cancelled'),
  };
  const visibleTaskCount = Object.values(grouped).reduce((sum, group) => sum + group.length, 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <PageHeader title={<>Centro de Tareas</>} description={<>Seguimiento operativo para pendientes financieros, documentales y de seguridad.</>} actions={<><div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">
            <Building2 className="w-4 h-4 text-slate-600" />
            <select aria-label="Sucursal"
              value={selectedBranchId}
              onChange={(event) => {
                setSelectedBranchId(event.target.value);
                setFocusedTaskId(null);
              }}
              className="bg-transparent outline-none"
            >
              <option value="all">Todas las sucursales</option>
              {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <button onClick={fetchTasks} className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50">
            <RefreshCw className="w-4 h-4" />
            Actualizar
          </button>
        </div></>} />

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-4">
        <button onClick={() => applyQuickFilters({ status: 'active' })} className="glass-card p-5 text-left border-l-4 border-l-slate-900">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Activas</p>
          <p className="text-2xl font-bold mt-1">{Number(summary?.open || 0) + Number(summary?.inProgress || 0)}</p>
        </button>
        <button onClick={() => applyQuickFilters({ assigned: 'me' })} className="glass-card p-5 text-left border-l-4 border-l-blue-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Asignadas a mí</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{summary?.assignedToMe ?? 0}</p>
        </button>
        <button onClick={() => applyQuickFilters({ due: 'today' })} className="glass-card p-5 text-left border-l-4 border-l-amber-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Vencen hoy</p>
          <p className="text-2xl font-bold text-amber-800 mt-1">{summary?.dueToday ?? 0}</p>
        </button>
        <button onClick={() => applyQuickFilters({ due: 'overdue' })} className="glass-card p-5 text-left border-l-4 border-l-red-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Atrasadas</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{summary?.overdue ?? 0}</p>
        </button>
        <button onClick={() => applyQuickFilters({ source: user.role === 'guard' ? 'guard_shift_log' : 'dashboard_alert' })} className="glass-card p-5 text-left border-l-4 border-l-violet-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">{user.role === 'guard' ? 'Desde bitácora' : 'Desde alertas'}</p>
          <p className="text-2xl font-bold text-violet-600 mt-1">{user.role === 'guard' ? (summary?.fromShiftLogs ?? 0) : (summary?.fromAlerts ?? 0)}</p>
        </button>
        <button onClick={() => applyQuickFilters({ source: 'document' })} className="glass-card p-5 text-left border-l-4 border-l-cyan-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Desde documentos</p>
          <p className="text-2xl font-bold text-cyan-600 mt-1">{summary?.fromDocuments ?? 0}</p>
        </button>
        <button onClick={() => applyQuickFilters({ priority: 'critical' })} className="glass-card p-5 text-left border-l-4 border-l-rose-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Críticas activas</p>
          <p className="text-2xl font-bold text-rose-600 mt-1">{summary?.criticalActive ?? 0}</p>
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
        <TaskCreateForm branches={branches} assignees={assignees} categories={allowedCategoryEntries} priorities={priorityLabels} canAssign={canAssigneeHandleCategory} branchId={selectedBranchId} onCreated={() => setToast({ message: 'Tarea creada.', type: 'success' })} />

        <div className="space-y-5">
          <FilterBar activeCount={Number(statusFilter !== 'active') + Number(categoryFilter !== 'all') + Number(priorityFilter !== 'all') + Number(dueFilter !== 'all') + Number(assignedFilter !== 'all') + Number(sourceFilter !== 'all')}>
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-600" />
              <select aria-label="Estado de tareas" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="bg-transparent outline-none">
                <option value="active">Activas</option>
                <option value="all">Todas</option>
                <option value="open">Abiertas</option>
                <option value="in_progress">En curso</option>
                <option value="done">Cerradas</option>
                <option value="cancelled">Anuladas</option>
              </select>
            </div>
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium">
              <select aria-label="Categoria de tareas" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as any)} className="bg-transparent outline-none">
                <option value="all">Todas las categorías</option>
                {allowedCategoryEntries.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium">
              <select aria-label="Prioridad de tareas" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as PriorityFilter)} className="bg-transparent outline-none">
                <option value="all">Todas las prioridades</option>
                {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium">
              <select aria-label="Vencimiento de tareas" value={dueFilter} onChange={(e) => setDueFilter(e.target.value as DueFilter)} className="bg-transparent outline-none">
                <option value="all">Todos los vencimientos</option>
                <option value="today">Vencen hoy</option>
                <option value="overdue">Atrasadas</option>
              </select>
            </div>
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-slate-600" />
              <select aria-label="Responsable de tareas" value={assignedFilter} onChange={(e) => setAssignedFilter(e.target.value as any)} className="bg-transparent outline-none">
                <option value="all">Todos</option>
                <option value="me">Mis tareas</option>
                <option value="unassigned">Sin asignar</option>
              </select>
            </div>
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-slate-600" />
              <select aria-label="Origen de tareas" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as any)} className="bg-transparent outline-none">
                <option value="all">Todos los orígenes</option>
                <option value="dashboard_alert">Desde alertas</option>
                <option value="guard_shift_log">Desde bitácora</option>
                <option value="document">Desde documentos</option>
                <option value="finance_approval">Aprobaciones finanzas</option>
                <option value="finance_payment_adjustment">Ajustes de pago</option>
                <option value="finance_expense_approval">Aprobación de gastos</option>
                <option value="finance_monthly_close_approval">Cierre mensual</option>
                <option value="finance_monthly_reopen_approval">Reapertura mensual</option>
                <option value="manual">Manuales</option>
              </select>
            </div>
          </FilterBar>

          {focusedTaskId && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm font-bold text-emerald-700">Mostrando tarea #{focusedTaskId} desde notificación.</p>
              <button
                onClick={() => setFocusedTaskId(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
              >
                Ver todas
              </button>
            </div>
          )}

          {isLoading && <LoadingState label="Cargando tareas" />}{taskQuery.error && <p role="alert" className="text-sm text-red-800">{taskQuery.error.message}</p>}
          {!isLoading && visibleTaskCount === 0 && (
            <div className="glass-card p-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-600">{focusedTaskId ? 'No se encontró la tarea solicitada con tus permisos.' : 'No hay tareas para los filtros seleccionados.'}</p>
            </div>
          )}

          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-5">
            {(['open', 'in_progress', 'done', 'cancelled'] as OperationalTask['status'][]).map(status => {
              const visibleTasks = grouped[status];
              if (visibleTasks.length === 0) return null;
              return (
                <div key={status} className="glass-card overflow-hidden">
                  <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="text-sm font-bold text-slate-900">{statusLabels[status]}</h3>
                    <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">{visibleTasks.length}</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {visibleTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        assignees={assignees}
                        branches={branches}
                        categories={allowedCategoryEntries}
                        isSaving={isSaving}
                        isEditing={editingTaskId === task.id}
                        closeNote={closeNotes[task.id] || ''}
                        onCloseNoteChange={value => setCloseNotes(prev => ({ ...prev, [task.id]: value }))}
                        onStartEdit={() => startEditing(task)}
                        onCancelEdit={cancelEditing}
                        onSaveEdit={values => saveTaskEdit(task, values)}
                        history={{ open: historyTaskId === task.id, loading: isHistoryLoading, events: historyEvents }}
                        onShowHistory={() => fetchTaskHistory(task)}
                        onHideHistory={() => { setHistoryTaskId(null); setHistoryEvents([]); }}
                        comments={{ open: commentTaskId === task.id, items: comments }}
                        onShowComments={() => fetchTaskComments(task)}
                        onHideComments={() => { setCommentTaskId(null); setComments([]); }}
                        onAddComment={(values, file) => addTaskComment(task, values, file)}
                        onStart={() => updateTask(task, { status: 'in_progress' })}
                        onComplete={() => completeTask(task)}
                        onCancelTask={() => cancelTask(task)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TasksPage;
