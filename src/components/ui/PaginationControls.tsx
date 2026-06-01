import { ChevronLeft, ChevronRight } from 'lucide-react';

type PaginationControlsProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

const PaginationControls = ({ page, pageSize, total, onPageChange }: PaginationControlsProps) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <span className="font-bold">
        {start}-{end} de {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label="Página anterior"
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-all hover:bg-slate-50 disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-20 text-center font-bold text-slate-600">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          aria-label="Página siguiente"
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-all hover:bg-slate-50 disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default PaginationControls;
