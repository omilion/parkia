export type Pagination = {
  requested: boolean;
  page: number;
  pageSize: number;
  offset: number;
};

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : undefined;
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(firstQueryValue(value));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function nonNegativeInt(value: unknown, fallback: number) {
  const parsed = Number(firstQueryValue(value));
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function queryText(value: unknown) {
  return firstQueryValue(value)?.trim() || "";
}

export function parsePagination(query: Record<string, unknown>, defaultPageSize = 25, maxPageSize = 100): Pagination {
  const requested = query.page !== undefined || query.pageSize !== undefined || query.limit !== undefined || query.offset !== undefined;
  const pageSize = Math.min(positiveInt(query.pageSize ?? query.limit, defaultPageSize), maxPageSize);

  if (query.offset !== undefined) {
    const offset = nonNegativeInt(query.offset, 0);
    return {
      requested,
      page: Math.floor(offset / pageSize) + 1,
      pageSize,
      offset,
    };
  }

  const page = positiveInt(query.page, 1);
  return {
    requested,
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function paginatedResponse<T>(items: T[], total: number, pagination: Pagination) {
  return {
    items,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
  };
}

export function likeValue(value: string) {
  return `%${value}%`;
}
