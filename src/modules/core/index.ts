// Public API of the core module. Other modules import only from here.
export * from "./domain/customer";
export * from "./domain/vehicle";
export * from "./domain/numbering";
export { customerInputSchema, contactInputSchema, type CustomerInput, type ContactInput } from "./schemas/customer";
export { vehicleInputSchema, type VehicleInput } from "./schemas/vehicle";
export { createCustomer, updateCustomer, addContact, removeContact } from "./services/customers";
export { supplierInputSchema, type SupplierInput } from "./schemas/supplier";
export { createSupplier } from "./services/suppliers";
export {
  createVehicle,
  updateVehicle,
  changeVehicleStatus,
  patchVehicle,
  moveVehicleStock,
  type StockMovement,
  type VehiclePatch,
  type VehicleCommandOptions,
} from "./services/vehicles";
export { nextDocumentNumber } from "./services/numbering";
export { setBusinessDate, advanceBusinessDay } from "./services/clock";
export { listCustomers, getCustomer, searchCustomers, CUSTOMER_SORTS } from "./queries/customers";
export { listVehicles, getVehicle, VEHICLE_SORTS } from "./queries/vehicles";
export { getTimeline, type TimelineItem } from "./queries/timeline";
export { listAccessibleSites, listBrands, listAllSites } from "./queries/org";
export { getCoreDashboard } from "./queries/dashboard";
export { getSetting } from "./queries/settings";
export { vehicleStockLedger } from "./queries/stock";
