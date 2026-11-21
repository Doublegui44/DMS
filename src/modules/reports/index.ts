// Public API of the reports module: cross-module read models (role dashboards, stock value).
// It reads through the other modules' public APIs and never writes.
export * from "./domain/dashboards";
export { getRoleDashboard, TURNOVER_DAYS, type RoleDashboard } from "./queries/dashboard";
export { getStockValueReport, STOCK_ACCOUNTS, type StockKind } from "./queries/stock-value";
export * from "./domain/documents";
export { getPrintableDocument } from "./queries/documents";
