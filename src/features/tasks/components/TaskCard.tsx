import { AlertTriangle, Clock, Edit3, History, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Branch, OperationalTask, TaskComment } from '../../../types';
import type { TaskCommentValues, TaskFormValues } from '../../../../shared/schemas/tasks';
import { cn } from '../../../lib/utils';
import { categoryLabels, formatHistoryMetadata, priorityLabels, sourceTone, type Assignee, type TaskHistoryEvent } from '../taskShared';
import { TaskEditForm } from './TaskEditForm';
import { TaskCommentForm } from './TaskCommentForm';

export type TaskCardProps = {
  /** El proyecto aún no instala @types/react; sin esto TypeScript rechaza `key` en la lista. */
  key?: number | string;
  task: OperationalTask;
  assignees: Assignee[];
  branches: Branch[];
  categories: [string, string][];
  isSaving: boolean;
  isEditing: boolean;
  closeNote: string;
  onCloseNoteChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (values: TaskFormValues) => Promise<unknown>;
  history: { open: boolean; loading: boolean; events: TaskHistoryEvent[] };
  onShowHistory: () => void;
  onHideHistory: () => void;
  comments: { open: boolean; items: TaskComment[] };
  onShowComments: () => void;
  onHideComments: () => void;
  onAddComment: (values: TaskCommentValues, file: File | null) => Promise<boolean>;
  onStart: () => void;
  onComplete: () => void;
  onCancelTask: () => void;
};

const actionButton = 'min-h-11 text-xs font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-40';

/** Una tarea con sus acciones, historial y seguimiento. */
export function TaskCard(props: TaskCardProps) {
  const { task, isSaving, isEditing, closeNote } = props;
  const isActive = task.status !== 'done' && task.status !== 'cancelled';
  const requiresCloseNote = task.priority === 'critical' || task.source_type === 'dashboard_alert';
  const trimmedCloseNote = closeNote.trim();
  const closeNoteLabel = requiresCloseNote ? 'Nota de cierre o anulacion obligatoria' : 'Nota de cierre o anulacion';
  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between gap-4">
        {isEditing ? (
          <TaskEditForm
            task={task}
            assignees={props.assignees}
            branches={props.branches}
            categories={props.categories}
            isSaving={isSaving}
            onSave={props.onSaveEdit}
            onCancel={props.onCancelEdit}
          />
        ) : (
          <div>
            <p className="text-sm font-bold text-slate-900">{task.title}</p>
            {task.branch_name && <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mt-1">{task.branch_name}</p>}
            <p className="text-xs text-slate-600 mt-1">{categoryLabels[task.category]} · {task.assigned_staff_name || 'Sin responsable'}</p>
          </div>
        )}
        <span className={cn(
          'h-fit px-2 py-1 rounded-lg text-xs font-bold uppercase',
          task.priority === 'critical' ? 'bg-red-100 text-red-700' :
            task.priority === 'high' ? 'bg-amber-100 text-amber-700' :
              task.priority === 'medium' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
        )}>
          {priorityLabels[task.priority]}
        </span>
      </div>
      {!isEditing && task.description && <p className="text-sm text-slate-600 whitespace-pre-line">{task.description}</p>}
      {task.source_type && (
        <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold uppercase', sourceTone(task.source_type))}>
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
          {task.source_label || 'Origen'}
        </span>
      )}
      {task.source_href && (
        <Link to={task.source_href} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-slate-600 text-xs font-bold uppercase hover:bg-slate-50">
          Abrir {task.source_label || 'origen'}
        </Link>
      )}
      {isActive && !isEditing && (
        <textarea
          aria-label={closeNoteLabel}
          value={closeNote}
          onChange={(e) => props.onCloseNoteChange(e.target.value)}
          placeholder={closeNoteLabel}
          rows={2}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-base md:text-xs outline-none focus:bg-white focus:border-slate-900 resize-none"
        />
      )}
      {!isEditing && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-600 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            {task.due_date ? `Vence ${task.due_date}` : 'Sin vencimiento'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={props.onStartEdit} disabled={isSaving || !isActive} className={`${actionButton} text-slate-700 hover:bg-slate-100`}>
              <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
              Editar
            </button>
            <button onClick={props.onShowHistory} disabled={props.history.loading && props.history.open} className={`${actionButton} text-slate-600 hover:bg-slate-100`}>
              <History className="w-3.5 h-3.5" aria-hidden="true" />
              Historial
            </button>
            <button onClick={props.onShowComments} className={`${actionButton} text-slate-600 hover:bg-slate-100`}>
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Seguimiento
            </button>
            {task.status === 'open' && (
              <button onClick={props.onStart} disabled={isSaving} className={`${actionButton} text-blue-700 hover:bg-blue-50`}>Iniciar</button>
            )}
            {isActive && (
              <button onClick={props.onComplete} disabled={isSaving || (requiresCloseNote && !trimmedCloseNote)} className={`${actionButton} text-emerald-700 hover:bg-emerald-50`}>Cerrar</button>
            )}
            {isActive && (
              <button onClick={props.onCancelTask} disabled={isSaving || !trimmedCloseNote} className={`${actionButton} text-slate-600 hover:bg-slate-100`}>Anular</button>
            )}
          </div>
        </div>
      )}
      {props.history.open && (
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-600 uppercase">Historial</p>
            <button onClick={props.onHideHistory} className="min-h-11 px-2 text-xs font-bold text-slate-600 hover:text-slate-700">Ocultar</button>
          </div>
          {props.history.loading ? (
            <p className="text-xs text-slate-600">Cargando historial...</p>
          ) : props.history.events.length === 0 ? (
            <p className="text-xs text-slate-600">Sin eventos registrados.</p>
          ) : (
            <div className="space-y-2">
              {props.history.events.map(event => (
                <div key={event.id} className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs font-bold text-slate-700">{event.action}</p>
                  <p className="text-xs text-slate-600 mt-1">{formatHistoryMetadata(event.metadata)}</p>
                  <p className="text-xs text-slate-600 mt-1">{event.staff_name || 'Sistema'} · {new Date(event.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {props.comments.open && (
        <div className="border-t border-slate-100 pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-600 uppercase">Seguimiento</p>
            <button onClick={props.onHideComments} className="min-h-11 px-2 text-xs font-bold text-slate-600 hover:text-slate-700">Ocultar</button>
          </div>
          {props.comments.items.length === 0 ? (
            <p className="text-xs text-slate-600">Sin comentarios registrados.</p>
          ) : (
            <div className="space-y-2">
              {props.comments.items.map(comment => (
                <div key={comment.id} className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-700 whitespace-pre-line">{comment.note}</p>
                  <p className="text-xs text-slate-600 mt-1">{comment.staff_name || 'Sistema'} · {new Date(comment.created_at).toLocaleString()}</p>
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
          {isActive && <TaskCommentForm taskId={task.id} isSaving={isSaving} onSubmit={props.onAddComment} />}
        </div>
      )}
    </div>
  );
}
