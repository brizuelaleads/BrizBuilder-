/**
 * Walking CallRail's offset pagination to the end.
 *
 * Kept separate, and free of any dependency, so the walk can be driven over
 * whole multi-page datasets in a test rather than inferred from reading the
 * request code. Getting this wrong is silent: a walk that stops after the
 * first page still returns calls, still reports success, and simply never
 * mentions the ones it did not fetch.
 */

export type CallRailPage<TRow> = {
  rows: TRow[];
  /**
   * What CallRail said the total page count was, when it said anything.
   *
   * Null means the field was absent or unusable, not that there is one page.
   */
  totalPages: number | null;
};

export type CallRailPageWalk = {
  /** The ids discovered, de-duplicated, in the order they were seen. */
  ids: string[];
  /** Pages actually read, so a caller can tell a walk from a single fetch. */
  pagesRead: number;
  /** True when the cap was reached with pages still unread. */
  truncated: boolean;
};

/**
 * Whether another page should be read after this one.
 *
 * Two signals, in order of trust. A stated total page count is authoritative.
 * Without one, a full page is the only evidence more may exist and a short
 * page is the end — which also stops an unbounded walk when the count is
 * missing, rather than reading until the cap every time.
 */
export function hasMoreCallRailPages(input: {
  pageNumber: number;
  rowsOnPage: number;
  perPage: number;
  totalPages: number | null;
}): boolean {
  const { pageNumber, rowsOnPage, perPage, totalPages } = input;
  if (totalPages !== null && Number.isFinite(totalPages) && totalPages >= 1) {
    return pageNumber < totalPages;
  }
  return perPage > 0 && rowsOnPage >= perPage;
}

/**
 * Read pages until there are none left, or until the cap.
 *
 * `readPage` is given a 1-based page number, because that is what CallRail's
 * offset pagination counts in. `takeId` pulls the one value a discovery walk
 * is allowed to keep from a row.
 */
export async function collectCallRailPages<TRow>(
  readPage: (pageNumber: number) => Promise<CallRailPage<TRow>>,
  takeId: (row: TRow) => string,
  options: { perPage: number; maxPages: number },
): Promise<CallRailPageWalk> {
  const perPage = Math.max(1, Math.trunc(options.perPage));
  const maxPages = Math.max(1, Math.trunc(options.maxPages));
  const ids: string[] = [];
  const seen = new Set<string>();
  let totalPages: number | null = null;
  let pageNumber = 1;

  while (pageNumber <= maxPages) {
    const page = await readPage(pageNumber);
    const rows = Array.isArray(page.rows) ? page.rows : [];
    for (const row of rows) {
      const id = takeId(row);
      // A row with no id is a row nothing can be fetched from, so it is not
      // counted as discovered. Duplicates across pages collapse: CallRail can
      // shift rows between pages while the walk is in flight.
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }

    // The first stated count wins. A later page contradicting it would
    // otherwise be able to extend or cut the walk mid-flight.
    if (totalPages === null && page.totalPages !== null) {
      const reported = Number(page.totalPages);
      totalPages = Number.isFinite(reported) && reported >= 1 ? reported : null;
    }

    if (
      !hasMoreCallRailPages({
        pageNumber,
        rowsOnPage: rows.length,
        perPage,
        totalPages,
      })
    ) {
      return { ids, pagesRead: pageNumber, truncated: false };
    }
    pageNumber += 1;
  }

  return { ids, pagesRead: maxPages, truncated: true };
}
