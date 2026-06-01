import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Building2, CheckCircle2, Clock, Edit3, Filter, History, Plus, RefreshCw, Save, UserCheck, X } from 'lucide-react';
import type { Branch, OperationalTask, StaffUser, TaskComment } from '../types';
import Toast from '../components/ui/Toast';
import { cn } from '../lib/utils';

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

type Assignee = Pick<StaffUser, 'id' | 'name' | 'email' | 'role'>;

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

type TaskHistoryEvent = {
  id: number;
  action: string;
  metadata: string | null;
  created_at: string;
  staff_name: string | null;
  staff_email: string | null;
};

type EditTaskForm = {
  title: string;
  description: string;
  category: OperationalTask['category'];
  priority: OperationalTask['priority'];
  assigned_staff_id: string;
  branch_id: string;
  due_date: string;
};

const categoryLabels: Record<OperationalTask['category'], string> = {
  finance: 'Finanzas',
  access: 'Seguridad',
  documents: 'Documentos',
  contracts: 'Contratos',
  maintenance: 'Mantención',
  general: 'General',
};

const taskCategoriesByRole: Record<StaffUser['role'], OperationalTask['category'][]> = {
  admin: ['finance', 'access', 'documents', 'contracts', 'maintenance', 'general'],
  finance: ['finance', 'documents', 'contracts', 'general'],
  guard: ['access', 'maintenance', 'general'],
  cashier: ['access', 'general'],
};

const canAssigneeHandleCategory = (assignee: Assignee, category: OperationalTask['category']) =>
  taskCategoriesByRole[assignee.role].includes(category);

const priorityLabels: Record<OperationalTask['priority'], string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
};

const statusLabels: Record<OperationalTask['status'], string> = {
  open: 'Abierta',
  in_progress: 'En curso',
  done: 'Cerrada',
  cancelled: 'Anulada',
};

const sourceTone = (sourceType: string | null) => {
  if (sourceType === 'dashboard_alert') return 'bg-violet-50 text-violet-700';
  if (sourceType === 'guard_shift_log') return 'bg-sky-50 text-sky-700';
  if (sourceType === 'document') return 'bg-cyan-50 text-cyan-700';
  if (sourceType?.startsWith('finance_') || sourceType?.startsWith('monthly_finance_')) return 'bg-emerald-50 text-emerald-700';
  return 'bg-slate-100 text-slate-600';
};

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
  const location = useLocation();
  const initialParams = new URLSearchParams(location.search);
  const initialTaskId = numberParam(initialParams, 'taskId');
  const allowedTaskCategories = taskCategoriesByRole[user.role];
  const allowedCategoryEntries = Object.entries(categoryLabels).filter(([value]) =>
    allowedTaskCategories.includes(value as OperationalTask['category'])
  );
  const [tasks, setTasks] = useState<OperationalTask[]>([]);
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [newTaskCategory, setNewTaskCategory] = useState<OperationalTask['category']>('general');
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
  const [commentNotes, setCommentNotes] = useState<Record<number, string>>({});
  const [commentFileNames, setCommentFileNames] = useState<Record<number, string>>({});
  const [closeNotes, setCloseNotes] = useState<Record<number, string>>({});
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditTaskForm | null>(null);
  const [historyTaskId, setHistoryTaskId] = useState<number | null>(null);
  const [historyEvents, setHistoryEvents] = useState<TaskHistoryEvent[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const isApplyingLocationFilters = useRef(false);
  const createAssignees = assignees.filter(assignee => canAssigneeHandleCategory(assignee, newTaskCategory));
  const editAssignees = editForm ? assignees.filter(assignee => canAssigneeHandleCategory(assignee, editForm.category)) : assignees;

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

  const fetchTasks = async () => {
    setIsLoading(true);
    try {
      const safeCategoryFilter = categoryFilter === 'all' || allowedTaskCategories.includes(categoryFilter) ? categoryFilter : 'all';
      const params = new URLSearchParams({
        status: statusFilter,
        category: safeCategoryFilter,
        priority: priorityFilter,
        due: dueFilter,
        assigned: assignedFilter,
        source: sourceFilter,
      });
      if (selectedBranchId !== 'all') params.set('branch_id', selectedBranchId);
      const summaryParams = selectedBranchId === 'all' ? '' : `?branch_id=${selectedBranchId}`;
      const [tasksRes, summaryRes, assigneesRes, branchesRes] = await Promise.all([
        fetch(`/api/tasks?${params.toString()}`),
        fetch(`/api/tasks/summary${summaryParams}`),
        fetch('/api/tasks/assignees'),
        fetch('/api/branches'),
      ]);
      if (!tasksRes.ok || !summaryRes.ok || !assigneesRes.ok || !branchesRes.ok) throw new Error('No se pudo cargar tareas');
      setTasks(await tasksRes.json());
      setSummary(await summaryRes.json());
      setAssignees(await assigneesRes.json());
      setBranches(await branchesRes.json());
    } catch {
      setToast({ message: 'No se pudo cargar el centro de tareas.', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const fileToPayload = (file: File) => new Promise<{ fileName: string, mimeType: string, dataBase64: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const [, dataBase64] = result.split(',');
      resolve({ fileName: file.name, mimeType: file.type, dataBase64 });
    };
    reader.onerror = () => reject(new Error('No se pudo leer el adjunto'));
    reader.readAsDataURL(file);
  });

  useEffect(() => {
    if (categoryFilter !== 'all' && !allowedTaskCategories.includes(categoryFilter)) {
      setCategoryFilter('all');
      return;
    }
    fetchTasks();
  }, [statusFilter, categoryFilter, priorityFilter, dueFilter, assignedFilter, sourceFilter, selectedBranchId, user.role]);

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

  const handleCreateTask = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setIsSaving(true);
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: formData.get('title'),
        description: formData.get('description'),
        category: formData.get('category'),
        priority: formData.get('priority'),
        assigned_staff_id: formData.get('assigned_staff_id') || null,
        branch_id: formData.get('branch_id') || null,
        due_date: formData.get('due_date') || null,
      }),
    });
    const result = await res.json();
    if (res.ok) {
      setToast({ message: 'Tarea creada.', type: 'success' });
      e.currentTarget.reset();
      setNewTaskCategory('general');
      fetchTasks();
    } else {
      setToast({ message: result.error || 'No se pudo crear la tarea.', type: 'error' });
    }
    setIsSaving(false);
  };

  const updateTask = async (task: OperationalTask, payload: Record<string, unknown>) => {
    setIsSaving(true);
    const res = await fetch(`/api/tasks/${task.id}`, {
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

  const startEditing = (task: OperationalTask) => {
    setEditingTaskId(task.id);
    setEditForm({
      title: task.title,
      description: task.description || '',
      category: task.category,
      priority: task.priority,
      assigned_staff_id: task.assigned_staff_id ? String(task.assigned_staff_id) : '',
      branch_id: task.branch_id ? String(task.branch_id) : '',
      due_date: task.due_date || '',
    });
  };

  const cancelEditing = () => {
    setEditingTaskId(null);
    setEditForm(null);
  };

  const saveTaskEdit = async (task: OperationalTask) => {
    if (!editForm) return;
    await updateTask(task, {
      ...editForm,
      assigned_staff_id: editForm.assigned_staff_id || null,
      branch_id: editForm.branch_id || null,
      due_date: editForm.due_date || null,
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

  const addTaskComment = async (task: OperationalTask, form: HTMLFormElement) => {
    const note = commentNotes[task.id]?.trim() || '';
    const file = new FormData(form).get('attachment');
    if (!note) {
      setToast({ message: 'El comentario requiere una nota.', type: 'error' });
      return;
    }

    setIsSaving(true);
    try {
      const attachment = file instanceof File && file.size > 0 ? await fileToPayload(file) : undefined;
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, attachment }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'No se pudo guardar el comentario.');
      setCommentNotes(prev => ({ ...prev, [task.id]: '' }));
      setCommentFileNames(prev => ({ ...prev, [task.id]: '' }));
      form.reset();
      fetchTaskComments(task);
      setToast({ message: 'Seguimiento agregado.', type: 'success' });
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo guardar el comentario.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const formatHistoryMetadata = (metadata: string | null) => {
    if (!metadata) return '-';
    try {
      const parsed = JSON.parse(metadata);
      if (parsed.next) {
        return `Estado: ${parsed.previous?.status || '-'} -> ${parsed.next.status || '-'} · Prioridad: ${parsed.previous?.priority || '-'} -> ${parsed.next.priority || '-'}`;
      }
      if (parsed.note !== undefined) return `Nota: ${parsed.note || '-'}`;
      return Object.entries(parsed).map(([key, value]) => `${key}: ${value}`).join(' · ');
    } catch {
      return metadata;
    }
  };

  const completeTask = async (task: OperationalTask) => {
    const note = closeNotes[task.id]?.trim() || '';
    setIsSaving(true);
    const res = await fetch(`/api/tasks/${task.id}/complete`, {
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
    <div className="p-8 space-y-8">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Centro de Tareas</h2>
          <p className="text-slate-500 mt-1">Seguimiento operativo para pendientes financieros, documentales y de seguridad.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">
            <Building2 className="w-4 h-4 text-slate-400" />
            <select
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
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-4">
        <button onClick={() => applyQuickFilters({ status: 'active' })} className="glass-card p-5 text-left border-l-4 border-l-slate-900">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Activas</p>
          <p className="text-2xl font-bold mt-1">{Number(summary?.open || 0) + Number(summary?.inProgress || 0)}</p>
        </button>
        <button onClick={() => applyQuickFilters({ assigned: 'me' })} className="glass-card p-5 text-left border-l-4 border-l-blue-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Asignadas a mí</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{summary?.assignedToMe ?? 0}</p>
        </button>
        <button onClick={() => applyQuickFilters({ due: 'today' })} className="glass-card p-5 text-left border-l-4 border-l-amber-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vencen hoy</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{summary?.dueToday ?? 0}</p>
        </button>
        <button onClick={() => applyQuickFilters({ due: 'overdue' })} className="glass-card p-5 text-left border-l-4 border-l-red-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Atrasadas</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{summary?.overdue ?? 0}</p>
        </button>
        <button onClick={() => applyQuickFilters({ source: user.role === 'guard' ? 'guard_shift_log' : 'dashboard_alert' })} className="glass-card p-5 text-left border-l-4 border-l-violet-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{user.role === 'guard' ? 'Desde bitácora' : 'Desde alertas'}</p>
          <p className="text-2xl font-bold text-violet-600 mt-1">{user.role === 'guard' ? (summary?.fromShiftLogs ?? 0) : (summary?.fromAlerts ?? 0)}</p>
        </button>
        <button onClick={() => applyQuickFilters({ source: 'document' })} className="glass-card p-5 text-left border-l-4 border-l-cyan-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Desde documentos</p>
          <p className="text-2xl font-bold text-cyan-600 mt-1">{summary?.fromDocuments ?? 0}</p>
        </button>
        <button onClick={() => applyQuickFilters({ priority: 'critical' })} className="glass-card p-5 text-left border-l-4 border-l-rose-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Críticas activas</p>
          <p className="text-2xl font-bold text-rose-600 mt-1">{summary?.criticalActive ?? 0}</p>
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
        <form onSubmit={handleCreateTask} className="glass-card p-5 space-y-4 h-fit">
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-slate-400" />
            <h3 className="font-bold">Nueva tarea</h3>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Título</label>
            <input name="title" required minLength={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Detalle</label>
            <textarea name="description" rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Categoría</label>
              <select
                name="category"
                value={newTaskCategory}
                onChange={(e) => setNewTaskCategory(e.target.value as OperationalTask['category'])}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none"
              >
                {allowedCategoryEntries.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Prioridad</label>
              <select name="priority" defaultValue="medium" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none">
                {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Responsable</label>
            <select name="assigned_staff_id" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none">
              <option value="">Sin asignar</option>
              {createAssignees.map(assignee => <option key={assignee.id} value={assignee.id}>{assignee.name} · {assignee.role}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Sucursal</label>
            <select name="branch_id" defaultValue={selectedBranchId === 'all' ? '' : selectedBranchId} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none">
              <option value="">Sin sucursal</option>
              {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Vencimiento</label>
            <input type="date" name="due_date" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
          </div>
          <button type="submit" disabled={isSaving} className="w-full py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50">
            {isSaving ? 'Guardando...' : 'Crear Tarea'}
          </button>
        </form>

        <div className="space-y-5">
          <div className="flex flex-wrap gap-3">
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="bg-transparent outline-none">
                <option value="active">Activas</option>
                <option value="all">Todas</option>
                <option value="open">Abiertas</option>
                <option value="in_progress">En curso</option>
                <option value="done">Cerradas</option>
                <option value="cancelled">Anuladas</option>
              </select>
            </div>
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium">
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as any)} className="bg-transparent outline-none">
                <option value="all">Todas las categorías</option>
                {allowedCategoryEntries.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium">
              <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as PriorityFilter)} className="bg-transparent outline-none">
                <option value="all">Todas las prioridades</option>
                {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium">
              <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value as DueFilter)} className="bg-transparent outline-none">
                <option value="all">Todos los vencimientos</option>
                <option value="today">Vencen hoy</option>
                <option value="overdue">Atrasadas</option>
              </select>
            </div>
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-slate-400" />
              <select value={assignedFilter} onChange={(e) => setAssignedFilter(e.target.value as any)} className="bg-transparent outline-none">
                <option value="all">Todos</option>
                <option value="me">Mis tareas</option>
                <option value="unassigned">Sin asignar</option>
              </select>
            </div>
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-slate-400" />
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as any)} className="bg-transparent outline-none">
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
          </div>

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

          {isLoading && <p className="text-sm text-slate-400 font-bold">Cargando tareas...</p>}
          {!isLoading && visibleTaskCount === 0 && (
            <div className="glass-card p-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-500">{focusedTaskId ? 'No se encontró la tarea solicitada con tus permisos.' : 'No hay tareas para los filtros seleccionados.'}</p>
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
                    <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-lg">{visibleTasks.length}</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {visibleTasks.map(task => {
                      const requiresCloseNote = task.priority === 'critical' || task.source_type === 'dashboard_alert';
                      const closeNote = closeNotes[task.id]?.trim() || '';
                      return (
                      <div key={task.id} className="p-4 space-y-3">
                        <div className="flex justify-between gap-4">
                          {editingTaskId === task.id && editForm && (
                            <div className="flex-1 space-y-3">
                              <input
                                value={editForm.title}
                                onChange={(e) => setEditForm(prev => prev ? ({ ...prev, title: e.target.value }) : prev)}
                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-slate-900"
                              />
                              <textarea
                                value={editForm.description}
                                onChange={(e) => setEditForm(prev => prev ? ({ ...prev, description: e.target.value }) : prev)}
                                rows={3}
                                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-900 resize-none"
                              />
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <select value={editForm.category} onChange={(e) => {
                                  const nextCategory = e.target.value as OperationalTask['category'];
                                  setEditForm(prev => {
                                    if (!prev) return prev;
                                    const currentAssignee = assignees.find(assignee => String(assignee.id) === prev.assigned_staff_id);
                                    return {
                                      ...prev,
                                      category: nextCategory,
                                      assigned_staff_id: currentAssignee && canAssigneeHandleCategory(currentAssignee, nextCategory) ? prev.assigned_staff_id : '',
                                    };
                                  });
                                }} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none">
                                  {allowedCategoryEntries.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                                <select value={editForm.priority} onChange={(e) => setEditForm(prev => prev ? ({ ...prev, priority: e.target.value as OperationalTask['priority'] }) : prev)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none">
                                  {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                                <select value={editForm.assigned_staff_id} onChange={(e) => setEditForm(prev => prev ? ({ ...prev, assigned_staff_id: e.target.value }) : prev)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none">
                                  <option value="">Sin asignar</option>
                                  {editAssignees.map(assignee => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}
                                </select>
                                <select value={editForm.branch_id} onChange={(e) => setEditForm(prev => prev ? ({ ...prev, branch_id: e.target.value }) : prev)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none">
                                  <option value="">Sin sucursal</option>
                                  {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                                </select>
                                <input type="date" value={editForm.due_date} onChange={(e) => setEditForm(prev => prev ? ({ ...prev, due_date: e.target.value }) : prev)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none" />
                              </div>
                            </div>
                          )}
                          <div className={editingTaskId === task.id ? 'hidden' : ''}>
                            <p className="text-sm font-bold text-slate-900">{task.title}</p>
                            {task.branch_name && <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">{task.branch_name}</p>}
                            <p className="text-xs text-slate-500 mt-1">{categoryLabels[task.category]} · {task.assigned_staff_name || 'Sin responsable'}</p>
                          </div>
                          <span className={cn(
                            "h-fit px-2 py-1 rounded-lg text-[10px] font-bold uppercase",
                            task.priority === 'critical' ? "bg-red-100 text-red-700" :
                              task.priority === 'high' ? "bg-amber-100 text-amber-700" :
                                task.priority === 'medium' ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                          )}>
                            {priorityLabels[task.priority]}
                          </span>
                        </div>
                        {editingTaskId !== task.id && task.description && <p className="text-sm text-slate-600 whitespace-pre-line">{task.description}</p>}
                        {task.source_type && (
                          <span className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase", sourceTone(task.source_type))}>
                            <AlertTriangle className="w-3 h-3" />
                            {task.source_label || 'Origen'}
                          </span>
                        )}
                        {task.source_href && (
                          <Link to={task.source_href} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold uppercase hover:bg-slate-50">
                            Abrir {task.source_label || 'origen'}
                          </Link>
                        )}
                        {task.status !== 'done' && task.status !== 'cancelled' && (
                          <textarea
                            value={closeNotes[task.id] || ''}
                            onChange={(e) => setCloseNotes(prev => ({ ...prev, [task.id]: e.target.value }))}
                            placeholder={requiresCloseNote ? 'Nota de cierre o anulacion obligatoria' : 'Nota de cierre o anulacion'}
                            rows={2}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:bg-white focus:border-slate-900 resize-none"
                          />
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs text-slate-400 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {task.due_date ? `Vence ${task.due_date}` : 'Sin vencimiento'}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {editingTaskId === task.id ? (
                              <>
                                <button onClick={() => saveTaskEdit(task)} disabled={isSaving || !editForm?.title.trim()} className="text-xs font-bold text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded-lg disabled:opacity-40 inline-flex items-center gap-1">
                                  <Save className="w-3.5 h-3.5" />
                                  Guardar
                                </button>
                                <button onClick={cancelEditing} disabled={isSaving} className="text-xs font-bold text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-lg inline-flex items-center gap-1">
                                  <X className="w-3.5 h-3.5" />
                                  Cancelar
                                </button>
                              </>
                            ) : (
                              <button onClick={() => startEditing(task)} disabled={isSaving || task.status === 'done' || task.status === 'cancelled'} className="text-xs font-bold text-slate-700 hover:bg-slate-100 px-3 py-1.5 rounded-lg disabled:opacity-40 inline-flex items-center gap-1">
                                <Edit3 className="w-3.5 h-3.5" />
                                Editar
                              </button>
                            )}
                            {editingTaskId !== task.id && (
                              <>
                                <button onClick={() => fetchTaskHistory(task)} disabled={isHistoryLoading && historyTaskId === task.id} className="text-xs font-bold text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-lg inline-flex items-center gap-1">
                                  <History className="w-3.5 h-3.5" />
                                  Historial
                                </button>
                                <button onClick={() => fetchTaskComments(task)} className="text-xs font-bold text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-lg inline-flex items-center gap-1">
                                  <Plus className="w-3.5 h-3.5" />
                                  Seguimiento
                                </button>
                                {task.status === 'open' && (
                                  <button onClick={() => updateTask(task, { status: 'in_progress' })} disabled={isSaving} className="text-xs font-bold text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-lg">Iniciar</button>
                                )}
                                {task.status !== 'done' && task.status !== 'cancelled' && (
                                  <button onClick={() => completeTask(task)} disabled={isSaving || (requiresCloseNote && !closeNote)} className="text-xs font-bold text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded-lg disabled:opacity-40">Cerrar</button>
                                )}
                                {task.status !== 'cancelled' && task.status !== 'done' && (
                                  <button onClick={() => cancelTask(task)} disabled={isSaving || !closeNote} className="text-xs font-bold text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-lg disabled:opacity-40">Anular</button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {historyTaskId === task.id && (
                          <div className="border-t border-slate-100 pt-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold text-slate-500 uppercase">Historial</p>
                              <button onClick={() => { setHistoryTaskId(null); setHistoryEvents([]); }} className="text-xs font-bold text-slate-400 hover:text-slate-700">Ocultar</button>
                            </div>
                            {isHistoryLoading ? (
                              <p className="text-xs text-slate-400">Cargando historial...</p>
                            ) : historyEvents.length === 0 ? (
                              <p className="text-xs text-slate-400">Sin eventos registrados.</p>
                            ) : (
                              <div className="space-y-2">
                                {historyEvents.map(event => (
                                  <div key={event.id} className="bg-slate-50 rounded-xl p-3">
                                    <p className="text-xs font-bold text-slate-700">{event.action}</p>
                                    <p className="text-[11px] text-slate-500 mt-1">{formatHistoryMetadata(event.metadata)}</p>
                                    <p className="text-[10px] text-slate-400 mt-1">{event.staff_name || 'Sistema'} · {new Date(event.created_at).toLocaleString()}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {commentTaskId === task.id && (
                          <div className="border-t border-slate-100 pt-3 space-y-3">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold text-slate-500 uppercase">Seguimiento</p>
                              <button onClick={() => { setCommentTaskId(null); setComments([]); }} className="text-xs font-bold text-slate-400 hover:text-slate-700">Ocultar</button>
                            </div>
                            {comments.length === 0 ? (
                              <p className="text-xs text-slate-400">Sin comentarios registrados.</p>
                            ) : (
                              <div className="space-y-2">
                                {comments.map(comment => (
                                  <div key={comment.id} className="bg-slate-50 rounded-xl p-3">
                                    <p className="text-xs text-slate-700 whitespace-pre-line">{comment.note}</p>
                                    <p className="text-[10px] text-slate-400 mt-1">{comment.staff_name || 'Sistema'} · {new Date(comment.created_at).toLocaleString()}</p>
                                    {comment.attachment_id && (
                                      <a
                                        href={`/api/tasks/${task.id}/attachments/${comment.attachment_id}/download`}
                                        className="mt-2 inline-flex text-xs font-bold text-blue-700 hover:underline"
                                      >
                                        Descargar adjunto: {comment.attachment_file_name}
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {task.status !== 'done' && task.status !== 'cancelled' && (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  addTaskComment(task, e.currentTarget);
                                }}
                                className="space-y-2"
                              >
                                <textarea
                                  value={commentNotes[task.id] || ''}
                                  onChange={(e) => setCommentNotes(prev => ({ ...prev, [task.id]: e.target.value }))}
                                  placeholder="Agregar avance, llamada, evidencia o decisión..."
                                  rows={2}
                                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-slate-900 resize-none"
                                />
                                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 hover:bg-slate-50">
                                  <span className="truncate">{commentFileNames[task.id] || 'Adjuntar PDF, JPG o PNG opcional'}</span>
                                  <span className="font-bold text-slate-700">Examinar</span>
                                  <input
                                    type="file"
                                    name="attachment"
                                    accept="application/pdf,image/jpeg,image/png"
                                    className="sr-only"
                                    onChange={(event) => setCommentFileNames(prev => ({ ...prev, [task.id]: event.target.files?.[0]?.name || '' }))}
                                  />
                                </label>
                                <button type="submit" disabled={isSaving || !commentNotes[task.id]?.trim()} className="w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40">
                                  Agregar seguimiento
                                </button>
                              </form>
                            )}
                          </div>
                        )}
                      </div>
                      );
                    })}
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
