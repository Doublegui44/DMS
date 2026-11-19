import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { getCoreDashboard } from "@/modules/core";
import { ROLE_LABELS, type RoleKey } from "@/modules/admin";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";

export const metadata = { title: "Dashboard" };

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-700 dark:text-amber-400" : ""}`}>
        {value}
      </div>
      {sub && <div className="text-xs tabular-nums text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const { actor } = await getRequestContext();
  const firstName = actor.name.split(" ")[0];
  const showStock = actor.permissions.has("vehicle:view");
  const d = await query((ctx) => getCoreDashboard(ctx), { resource: "dashboard", action: "view" });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("welcome", { name: firstName })}
        badges={actor.roleKeys.map((k) => (
          <StatusBadge key={k} status={k} tone="indigo" label={ROLE_LABELS[k as RoleKey] ?? k} />
        ))}
        subtitle="Role-specific dashboards arrive in phase 6. Below: group figures from the shared core."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label={t("customers")} value={d.customers} />
        {showStock && (
          <>
            <Kpi label={t("vnStock")} value={d.vnCount} sub={formatMoney(d.vnValueCents, { decimals: false })} />
            <Kpi label={t("inTransit")} value={d.pipelineVn} />
            <Kpi label={t("voStock")} value={d.voCount} sub={formatMoney(d.voValueCents, { decimals: false })} />
            <Kpi label={t("agedStock")} value={d.agedVo} tone={d.agedVo > 0 ? "warn" : undefined} />
          </>
        )}
      </div>
      {showStock && (
        <Section title={t("bySite")}>
          <table className="w-full text-[13px]">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 text-left font-medium">Site</th>
                <th className="py-1.5 text-right font-medium">VN</th>
                <th className="py-1.5 text-right font-medium">VN value</th>
                <th className="py-1.5 text-right font-medium">VO</th>
                <th className="py-1.5 text-right font-medium">VO value</th>
                <th className="py-1.5 text-right font-medium">{t("stockValue")}</th>
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {d.bySite.map((s) => (
                <tr key={s.code}>
                  <td className="py-1.5">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">{s.code}</span>
                    {s.site}
                  </td>
                  <td className="py-1.5 text-right">{s.vn}</td>
                  <td className="py-1.5 text-right">{formatMoney(s.vnValueCents, { decimals: false })}</td>
                  <td className="py-1.5 text-right">{s.vo}</td>
                  <td className="py-1.5 text-right">{formatMoney(s.voValueCents, { decimals: false })}</td>
                  <td className="py-1.5 text-right font-medium">{formatMoney(s.vnValueCents + s.voValueCents, { decimals: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
