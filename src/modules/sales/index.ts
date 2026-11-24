// Public API of the sales module (VN / VO). Accounting is reached through its own index only.
export * from "./domain/pricing";
export * from "./domain/fees";
export * from "./domain/financing";
export * from "./domain/workflow";
export * from "./domain/market";
export { getMarketValuation, FALLBACK_NEW_PRICE_CENTS } from "./services/market";
export * from "./schemas/sales";
export { registerSalesHandlers } from "./handlers";
export { createLead, setLeadStage } from "./services/leads";
export {
  previewQuote,
  createQuote,
  updateQuote,
  submitQuote,
  decideQuoteApproval,
  declineQuote,
  reviseQuote,
  expireQuotes,
  reserveQuoteVehicle,
  type QuotePreview,
  type FinancingPlanData,
} from "./services/quotes";
export { reserveVehicle, releaseReservation, expireReservations } from "./services/reservations";
export { acceptQuote, recordOrderPayment, invoiceOrder, deliverOrder, cancelOrder } from "./services/orders";
export * from "./domain/oem-portal";
export { getOemPortal } from "./queries/oem-portal";
export { orderForStock, delayFactoryOrder, shipFactoryOrder, receiveVehicle, registerOpeningFactoryOrder, registerPastArrival } from "./services/vn-stock";
export { purchaseVo, addVehicleCost, capitaliseRepairOrder, startReconditioning, setForSale, repriceVo, registerOpeningVo, registerPastVoPurchase } from "./services/vo-stock";
export { salesSettings, type SalesSettings } from "./services/shared";
export { getPipeline, listLeads, getLead, getLeadFormData, LEAD_SORTS, type PipelineCard } from "./queries/pipeline";
export { getQuote, getQuoteFormData, listOrders, getOrder, ORDER_SORTS } from "./queries/deals";
export {
  listVnStock,
  listVoStock,
  getVoVehicle,
  getVnVehicle,
  getStockOrderFormData,
  getVoFormData,
  listPoliceRegister,
  getCatalogue,
  getSalesDashboard,
  STOCK_SORTS,
  POLICE_SORTS,
} from "./queries/stock";
export { getUnitsSold, getStockAgeing } from "./queries/performance";
