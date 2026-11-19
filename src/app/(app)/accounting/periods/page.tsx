import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";
import { getPeriodChecklist, listPeriods, periodLabel } from "@/modules/accounting";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { cn } from "@/lib/utils";
import { lockPeriodAction } from "../actions";
import { ReopenForm } from "./reopen-form";

export const metadata = { title: "Fiscal periods" };

export default async function PeriodsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations("accounting");
  const { actor } = await getRequestContext();
  const periods = await query((ctx) => listPeriods(ctx), { resource: "accounting.period", action: "view" });
  // Default selection: the earliest open period that has ended.
  const selectedId = sp.period ?? [...periods].reverse().find((p) => p.status === "OPEN" && p.entryCount > 0)?.id;
  const selected = periods.find((p) => p.id === selectedId);
  const checklist = selected ? await query((ctx) => getPeriodChecklist(ctx, selected.id)) : null;

  return (
    <div>
      <PageHeader title={t("periods")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Section>
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-3">{t("period")}</th>
                <th className="py-1.5 pr-3">{t("status")}</th>
                <th className="py-1.5 pr-3 text-right">{t("entriesCount")}</th>
                <th className="py-1.5">{t("lockedAt")}</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className={cn("border-b last:border-0", p.id === selectedId && "bg-muted/60")}>
                  <td className="py-1.5 pr-3">
                    <Link href={`?period=${p.id}`} className="font-medium text-primary hover:underline">
                      {periodLabel(p)}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3">
                    <StatusBadge status={p.status} label={t(`statuses.${p.status}`)} />
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{p.entryCount}</td>
                  <td className="py-1.5">{p.lockedAt ? formatDate(p.lockedAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title={selected ? `${t("checklist")} — ${periodLabel(selected)}` : t("checklist")}>
          {!selected || !checklist ? (
            <p className="text-sm text-muted-foreground">{t("selectPeriod")}</p>
          ) : (
            <div className="space-y-4">
              <ul className="space-y-2 text-sm" data-testid="close-checklist">
                {checklist.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    ) : c.blocking ? (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    )}
                    <span>
                      {c.message}
                      {!c.ok && <span className="ml-1 text-xs text-muted-foreground">({c.blocking ? t("blocking") : t("warning")})</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Link href={`/accounting/trial-balance?from=${selected.startDate.toISOString().slice(0, 10)}&to=${selected.endDate.toISOString().slice(0, 10)}`} className="text-sm text-primary hover:underline">
                  {t("trialBalance")} →
                </Link>
              </div>
              {selected.status === "OPEN" && can(actor.permissions, "accounting.period", "validate") && (
                <ActionButton
                  action={lockPeriodAction.bind(null, selected.id)}
                  label={t("lock")}
                  successMessage="Period locked"
                  confirm={`Lock ${periodLabel(selected)}? No entry can be posted in it afterwards.`}
                />
              )}
              {selected.status === "LOCKED" && can(actor.permissions, "accounting.period", "delete") && <ReopenForm periodId={selected.id} />}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
