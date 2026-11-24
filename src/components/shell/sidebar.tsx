"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BarChart3, Banknote, BookOpen, BookText, BookUser, Boxes, Car, CarFront, CalendarDays, ClipboardCheck, ClipboardList, Factory, FlaskConical, Globe,
  History, KanbanSquare, KeyRound, LayoutDashboard, ListTree, Lock, Package, Receipt, Settings, ShieldCheck,
  Scale, ScrollText, ShoppingCart, Timer, Truck, UserCog, Users, Wrench, Gauge, ListChecks, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavGroup } from "./nav";

const ICONS: Record<string, LucideIcon> = {
  BarChart3, Banknote, BookOpen, BookText, BookUser, Boxes, Car, CarFront, CalendarDays, ClipboardCheck, ClipboardList, Factory, FlaskConical, Globe,
  History, KanbanSquare, KeyRound, LayoutDashboard, ListTree, Lock, Package, Receipt, Settings, ShieldCheck,
  Scale, ScrollText, ShoppingCart, Timer, Truck, UserCog, Users, Wrench, Gauge, ListChecks,
};

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tApp = useTranslations("app");
  const tu = useTranslations("ui");
  return (
    <aside className="hidden w-56 shrink-0 border-r bg-sidebar text-sidebar-foreground md:flex md:flex-col">
      <div className="flex h-12 items-center gap-2 border-b px-4">
        <div className="grid size-6 place-items-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
          DMS
        </div>
        <span className="text-sm font-semibold tracking-tight">{tApp("name")}</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label={tu("mainMenu")}>
        {groups.map((group) => (
          <div key={group.key} className="mb-3">
            {group.key !== "dashboard" && (
              <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t(group.key)}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
                        item.phase && "text-sidebar-foreground/50",
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="flex-1 truncate">{t(item.key)}</span>
                      {item.phase && <span className="text-[10px] text-muted-foreground">P{item.phase}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
