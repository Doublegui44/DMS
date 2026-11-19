import type { Resource } from "@/lib/rbac";

export interface NavItem {
  key: string; // message key under "nav"
  href: string;
  resource: Resource;
  icon: string; // lucide icon name, resolved in the client sidebar
  /** Roadmap phase that delivers the screen; omitted when built. */
  phase?: number;
}

export interface NavGroup {
  key: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    key: "dashboard",
    items: [{ key: "dashboard", href: "/dashboard", resource: "dashboard", icon: "LayoutDashboard" }],
  },
  {
    key: "crm",
    items: [
      { key: "customers", href: "/customers", resource: "customer", icon: "Users" },
      { key: "vehicles", href: "/vehicles", resource: "vehicle", icon: "Car" },
    ],
  },
  {
    key: "sales",
    items: [
      { key: "pipeline", href: "/sales/pipeline", resource: "sales.lead", icon: "KanbanSquare", phase: 3 },
      { key: "voStock", href: "/sales/vo-stock", resource: "sales.vo_stock", icon: "CarFront", phase: 3 },
      { key: "catalogue", href: "/sales/catalogue", resource: "sales.catalogue", icon: "BookOpen", phase: 3 },
    ],
  },
  {
    key: "workshop",
    items: [
      { key: "planner", href: "/workshop/planner", resource: "workshop.appointment", icon: "CalendarDays", phase: 5 },
      { key: "repairOrders", href: "/workshop/repair-orders", resource: "workshop.repair_order", icon: "Wrench", phase: 5 },
      { key: "clocking", href: "/workshop/clocking", resource: "workshop.clocking", icon: "Timer", phase: 5 },
      { key: "warranty", href: "/workshop/warranty", resource: "workshop.warranty", icon: "ShieldCheck", phase: 5 },
    ],
  },
  {
    key: "parts",
    items: [
      { key: "partsCatalogue", href: "/parts/catalogue", resource: "parts.part", icon: "Package", phase: 4 },
      { key: "stock", href: "/parts/stock", resource: "parts.stock", icon: "Boxes", phase: 4 },
      { key: "purchasing", href: "/parts/purchasing", resource: "parts.purchase_order", icon: "Truck", phase: 4 },
      { key: "counter", href: "/parts/counter", resource: "parts.counter_sale", icon: "ShoppingCart", phase: 4 },
      { key: "inventory", href: "/parts/inventory", resource: "parts.inventory", icon: "ClipboardList", phase: 4 },
    ],
  },
  {
    key: "accounting",
    items: [
      { key: "entries", href: "/accounting/entries", resource: "accounting.entry", icon: "BookText", phase: 2 },
      { key: "invoices", href: "/accounting/invoices", resource: "accounting.invoice", icon: "Receipt", phase: 2 },
      { key: "payments", href: "/accounting/payments", resource: "accounting.payment", icon: "Banknote", phase: 2 },
      { key: "periods", href: "/accounting/periods", resource: "accounting.period", icon: "Lock", phase: 2 },
      { key: "reports", href: "/accounting/reports", resource: "accounting.report", icon: "BarChart3", phase: 6 },
    ],
  },
  {
    key: "admin",
    items: [
      { key: "users", href: "/admin/users", resource: "admin.user", icon: "UserCog" },
      { key: "roles", href: "/admin/roles", resource: "admin.role", icon: "KeyRound" },
      { key: "settings", href: "/admin/settings", resource: "admin.settings", icon: "Settings" },
      { key: "audit", href: "/admin/audit", resource: "admin.audit", icon: "History" },
      { key: "simulation", href: "/admin/simulation", resource: "admin.simulation", icon: "FlaskConical", phase: 7 },
    ],
  },
];

export function findNavItem(pathname: string): { group: NavGroup; item: NavItem } | null {
  for (const group of NAV) {
    for (const item of group.items) if (item.href === pathname) return { group, item };
  }
  return null;
}
