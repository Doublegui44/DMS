import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { formatBp, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { listAllSites } from "@/modules/core";
import { PageHeader, Section } from "@/components/shared/page-header";

export const metadata = { title: "Settings" };

/** Read-only in phase 1; editing of rates, numbering and mappings arrives with the modules that use them. */
export default async function SettingsPage() {
  const t = await getTranslations("admin");
  const { sites, vatRates, settings, sequences } = await query(
    async (ctx) => ({
      sites: await listAllSites(ctx),
      vatRates: await ctx.tx.vatRate.findMany({ orderBy: { rateBp: "desc" } }),
      settings: await ctx.tx.setting.findMany({ orderBy: { key: "asc" } }),
      sequences: await ctx.tx.documentSequence.findMany({ orderBy: [{ scope: "asc" }, { docType: "asc" }] }),
    }),
    { resource: "admin.settings", action: "view" },
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t("settingsTitle")} subtitle="Read-only in phase 1. Values come from the seed and drive the business rules." />
      <Section title={t("sites")}>
        <table className="w-full text-[13px]">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b text-left">
              <th className="py-1.5 font-medium">Code</th>
              <th className="py-1.5 font-medium">Name</th>
              <th className="py-1.5 font-medium">City</th>
              <th className="py-1.5 font-medium">{t("brands")}</th>
              <th className="py-1.5 text-right font-medium">{t("labourRate")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sites.map((s) => (
              <tr key={s.id}>
                <td className="py-1.5 font-mono text-xs">{s.code}</td>
                <td className="py-1.5">{s.name}</td>
                <td className="py-1.5">{s.city}</td>
                <td className="py-1.5">{s.brands.map((b) => b.brand.name).join(", ")}</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(s.labourRateCents)} / h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("vatRates")}>
          <ul className="divide-y text-[13px]">
            {vatRates.map((v) => (
              <li key={v.id} className="flex justify-between py-1.5">
                <span>
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{v.countryCode}</span>
                  {v.label} <span className="text-muted-foreground">({v.code})</span>
                </span>
                <span className="tabular-nums">
                  {formatBp(v.rateBp)} <span className="text-xs text-muted-foreground">since {formatDate(v.validFrom)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Document numbering">
          <ul className="divide-y text-[13px]">
            {sequences.map((s) => (
              <li key={`${s.scope}-${s.docType}-${s.fiscalYear}`} className="flex justify-between py-1.5">
                <span>
                  {s.docType} <span className="text-xs text-muted-foreground">{s.scope === "GROUP" ? "group" : "site"}</span>
                </span>
                <span className="font-mono text-xs">
                  {s.prefix}
                  {s.fiscalYear ? `-${s.fiscalYear}-` : ""}… next {s.nextValue}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <Section title="Business rules">
        <ul className="divide-y text-[13px]">
          {settings.map((s) => (
            <li key={s.id} className="flex justify-between gap-4 py-1.5">
              <span className="font-mono text-xs">{s.key}</span>
              <span className="truncate text-right font-mono text-xs text-muted-foreground">{JSON.stringify(s.value)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
