/**
 * T15 — the "N of M" pagination summary and "page X of Y" line must derive
 * from the same slice. Virtualized lists render every filtered item (no true
 * paging), so "shown" is the full display-list count. Paginated
 * (non-virtualized) lists render only the current page's slice, so "shown"
 * must be that slice's length — otherwise the two lines contradict each
 * other (e.g. "62 of 62 · page 1 of 7").
 */

/** 9 cards per page — DOM never holds more than 9 <div>s regardless of dataset size. */
export const EQUIPMENT_LIST_PAGE_SIZE = 9;

/**
 * Resolves the "shown" count for the equipment-list pagination summary.
 * Must always agree with the item count actually rendered on screen.
 */
export function resolveEquipmentListShownCount(
  isVirtualized: boolean,
  displayListLength: number,
  pageItemsLength: number,
): number {
  return isVirtualized ? displayListLength : pageItemsLength;
}
