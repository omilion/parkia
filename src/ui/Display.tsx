import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><h1 className="break-words text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>{description && <div className="mt-1 text-sm text-slate-600">{description}</div>}</div>{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}</header>;
}

const badgeTones = {
  neutral: 'bg-slate-100 text-slate-700',
  success: 'bg-emerald-50 text-emerald-800',
  warning: 'bg-amber-50 text-amber-800',
  danger: 'bg-red-50 text-red-800',
  info: 'bg-sky-50 text-sky-800',
} as const;
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  return <span className={cn('inline-flex max-w-full items-center rounded-lg px-2 py-1 text-xs font-semibold', badgeTones[tone])}>{children}</span>;
}
export function StatCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4"><p className="text-sm font-medium text-slate-600">{label}</p><div className="mt-2 break-words text-2xl font-bold tabular-nums text-slate-900">{value}</div>{detail && <div className="mt-1 text-sm text-slate-600">{detail}</div>}</div>;
}
export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return <div className="px-4 py-10 text-center"><p className="font-semibold text-slate-900">{title}</p>{description && <div className="mt-1 text-sm text-slate-600">{description}</div>}{action && <div className="mt-4">{action}</div>}</div>;
}
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none', className)} />;
}
