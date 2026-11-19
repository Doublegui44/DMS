import { DEMO_MODE } from "@/auth";
import { db } from "@/lib/db";
import { getRequestContext } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatDate, localToday } from "@/lib/dates";
import { ROLE_LABELS, type RoleKey } from "@/modules/admin";
import { NAV } from "@/components/shell/nav";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor, siteId, sites } = await getRequestContext();

  // Menus are filtered by the "view" permission on each screen's resource.
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => can(actor.permissions, i.resource, "view")),
  })).filter((g) => g.items.length > 0);

  const clock = await db.businessClock.findUnique({ where: { id: 1 } });
  const businessDate = formatDate(clock?.currentDate ?? localToday());

  const demoUsers = DEMO_MODE
    ? (
        await db.user.findMany({
          where: { active: true },
          orderBy: [{ lastName: "asc" }],
          select: {
            email: true,
            firstName: true,
            lastName: true,
            roles: { select: { role: { select: { key: true, name: true } }, site: { select: { code: true } } } },
          },
        })
      )
        .map((u) => ({
          email: u.email,
          name: `${u.firstName} ${u.lastName}`,
          role: u.roles[0]?.role.name ?? "",
          roleKey: u.roles[0]?.role.key ?? "",
          site: u.roles[0]?.site?.code ?? "All",
        }))
        .sort((a, b) => a.roleKey.localeCompare(b.roleKey) || a.site.localeCompare(b.site))
    : null;

  return (
    <div className="flex h-dvh overflow-hidden bg-muted/30">
      <Sidebar groups={groups} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          userName={actor.name}
          roleLabels={actor.roleKeys.map((k) => ROLE_LABELS[k as RoleKey] ?? k)}
          sites={sites}
          activeSiteId={siteId}
          businessDate={businessDate}
          demoUsers={demoUsers}
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
