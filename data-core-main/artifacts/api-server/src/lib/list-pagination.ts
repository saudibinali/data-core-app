/**
 * F9.3 — Standard list pagination (enterprise default: 50, cap 200).
 */
export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;

export type ListPagination = {
  limit: number;
  offset: number;
};

export function parseListPagination(
  query: Record<string, unknown>,
  defaults?: Partial<ListPagination>,
): ListPagination {
  const defLimit = defaults?.limit ?? LIST_DEFAULT_LIMIT;
  const defOffset = defaults?.offset ?? 0;

  const rawLimit = query.limit ?? query.pageSize ?? query.page_size;
  const rawOffset = query.offset ?? query.skip;

  let limit = defLimit;
  if (rawLimit !== undefined && rawLimit !== "") {
    const n = Number(rawLimit);
    if (Number.isFinite(n) && n > 0) {
      limit = Math.min(Math.floor(n), LIST_MAX_LIMIT);
    }
  }

  let offset = defOffset;
  if (rawOffset !== undefined && rawOffset !== "") {
    const n = Number(rawOffset);
    if (Number.isFinite(n) && n >= 0) {
      offset = Math.floor(n);
    }
  }

  return { limit, offset };
}

export function paginationMeta(total: number, { limit, offset }: ListPagination) {
  const page = limit > 0 ? Math.floor(offset / limit) + 1 : 1;
  const pageCount = limit > 0 ? Math.ceil(total / limit) : 1;
  return {
    total,
    limit,
    offset,
    page,
    pageCount,
    hasMore: offset + limit < total,
  };
}
