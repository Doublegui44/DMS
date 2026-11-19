import { ACTIONS, ALL_RESOURCES, RESOURCES, type Action, type Resource } from "@/lib/rbac";

/** The ten seeded roles. */
export const ROLE_KEYS = [
  "ADMIN",
  "DEALER_PRINCIPAL",
  "SALES_MANAGER",
  "SALESPERSON",
  "SERVICE_MANAGER",
  "SERVICE_ADVISOR",
  "TECHNICIAN",
  "PARTS_MANAGER",
  "PARTS_ADVISOR",
  "ACCOUNTANT",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  ADMIN: "Admin",
  DEALER_PRINCIPAL: "Dealer Principal",
  SALES_MANAGER: "Sales Manager",
  SALESPERSON: "Salesperson",
  SERVICE_MANAGER: "Service Manager",
  SERVICE_ADVISOR: "Service Advisor",
  TECHNICIAN: "Technician",
  PARTS_MANAGER: "Parts Manager",
  PARTS_ADVISOR: "Parts Advisor",
  ACCOUNTANT: "Accountant",
};

type Grants = Partial<Record<Resource, readonly Action[]>>;

const ALL = ACTIONS;
const VIEW = ["view"] as const;
const VCE = ["view", "create", "edit"] as const;
const VCEV = ["view", "create", "edit", "validate"] as const;

function each(resources: readonly Resource[], actions: readonly Action[]): Grants {
  return Object.fromEntries(resources.map((r) => [r, actions]));
}

/**
 * Default permission matrix. Editable afterwards in Admin → Roles.
 * Principle: managers validate, operators create/edit, everyone sees what they need to serve a customer.
 */
export const DEFAULT_ROLE_MATRIX: Record<RoleKey, Grants> = {
  ADMIN: each(ALL_RESOURCES, ALL),

  DEALER_PRINCIPAL: {
    ...each(ALL_RESOURCES, VIEW),
    ...each(RESOURCES.sales, VCEV),
    customer: VCE,
    vehicle: VCE,
    "workshop.repair_order": ["view", "validate"],
    "accounting.period": ["view", "validate"],
  },

  SALES_MANAGER: {
    dashboard: VIEW,
    customer: VCE,
    vehicle: VCEV,
    ...each(RESOURCES.sales, ["view", "create", "edit", "validate", "delete"]),
    "workshop.repair_order": VIEW,
    "accounting.invoice": VIEW,
    "accounting.payment": ["view", "create"],
    "accounting.report": VIEW,
  },

  SALESPERSON: {
    dashboard: VIEW,
    customer: VCE,
    vehicle: VIEW,
    "sales.lead": VCE,
    "sales.quote": VCE,
    "sales.order": VCE,
    "sales.trade_in": VCE,
    "sales.vo_stock": VIEW,
    "sales.catalogue": VIEW,
  },

  SERVICE_MANAGER: {
    dashboard: VIEW,
    customer: VCE,
    vehicle: VCE,
    ...each(RESOURCES.workshop, ["view", "create", "edit", "validate", "delete"]),
    "parts.part": VIEW,
    "parts.stock": VIEW,
    "accounting.invoice": VIEW,
    "accounting.payment": ["view", "create"],
    "accounting.report": VIEW,
  },

  SERVICE_ADVISOR: {
    dashboard: VIEW,
    customer: VCE,
    vehicle: VCE,
    "workshop.appointment": VCE,
    "workshop.repair_order": VCEV,
    "workshop.clocking": VIEW,
    "workshop.warranty": VCE,
    "workshop.labour_catalogue": VIEW,
    "parts.part": VIEW,
    "parts.stock": VIEW,
    "accounting.invoice": ["view", "create"],
    "accounting.payment": ["view", "create"],
  },

  TECHNICIAN: {
    dashboard: VIEW,
    vehicle: VIEW,
    "workshop.repair_order": ["view", "edit"],
    "workshop.clocking": ["view", "create", "edit"],
    "workshop.labour_catalogue": VIEW,
    "parts.part": VIEW,
  },

  PARTS_MANAGER: {
    dashboard: VIEW,
    customer: VCE,
    vehicle: VIEW,
    ...each(RESOURCES.parts, ["view", "create", "edit", "validate", "delete"]),
    "workshop.repair_order": VIEW,
    "accounting.invoice": VIEW,
    "accounting.payment": ["view", "create"],
    "accounting.report": VIEW,
  },

  PARTS_ADVISOR: {
    dashboard: VIEW,
    customer: VCE,
    vehicle: VIEW,
    "parts.part": VIEW,
    "parts.stock": VIEW,
    "parts.purchase_order": VCE,
    "parts.counter_sale": VCE,
    "parts.inventory": ["view", "edit"],
    "workshop.repair_order": VIEW,
  },

  ACCOUNTANT: {
    dashboard: VIEW,
    customer: VCE,
    vehicle: VIEW,
    ...each(RESOURCES.accounting, ["view", "create", "edit", "validate"]),
    "sales.order": VIEW,
    "sales.vo_stock": VIEW,
    "workshop.repair_order": VIEW,
    "workshop.warranty": VIEW,
    "parts.stock": VIEW,
    "parts.purchase_order": VIEW,
    "parts.inventory": ["view", "validate"],
    "admin.audit": VIEW,
  },
};

/** Flatten a role's grants into resource/action pairs. */
export function flattenGrants(grants: Grants): { resource: Resource; action: Action }[] {
  return Object.entries(grants).flatMap(([resource, actions]) =>
    (actions ?? []).map((action) => ({ resource: resource as Resource, action })),
  );
}
