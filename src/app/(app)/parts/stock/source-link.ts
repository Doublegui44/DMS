/** Where a stock movement came from (receipt pages redirect to their order). */
export function sourceHref(sourceType: string, sourceId: string | null): string | null {
  if (!sourceId) return null;
  switch (sourceType) {
    case "GOODS_RECEIPT":
      return `/parts/purchasing/receipts/${sourceId}`;
    case "COUNTER_SALE":
      return `/parts/counter/${sourceId}`;
    case "STOCK_TRANSFER":
      return `/parts/stock/transfers/${sourceId}`;
    case "CYCLE_COUNT":
      return `/parts/inventory/${sourceId}`;
    default:
      return null;
  }
}
