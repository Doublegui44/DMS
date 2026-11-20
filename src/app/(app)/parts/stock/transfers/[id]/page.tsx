import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { EntryLink } from "../../../entry-link";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getTransfer } from "@/modules/parts";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { fmtQty, pmpCents } from "../../../format";

export const metadata = { title: "Transfer" };

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("parts");
  const { transfer, entries } = await query((ctx) => getTransfer(ctx, id));
  return (
    <div className="space-y-4">
      <PageHeader title={`${t("transfer")} ${transfer.number}`} subtitle={`${transfer.fromSite.name} → ${transfer.toSite.name}`} backHref="/parts/stock/transfers" />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Section title={t("lines")}>
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-3 font-medium">{t("partNumber")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("description")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("qty")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("unitCost")}</th>
                <th className="py-1.5 text-right font-medium">{t("value")}</th>
              </tr>
            </thead>
            <tbody>
              {transfer.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">
                    <Link className="text-primary hover:underline" href={`/parts/catalogue/${l.part.id}`}>
                      {l.part.partNumber}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3">{l.part.description}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(l.qty)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(pmpCents(l.unitCostCents))}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(l.valueCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t">
                <td colSpan={4} className="pt-2 font-medium">
                  {t("total")}
                </td>
                <td className="pt-2 text-right font-semibold tabular-nums">{formatMoney(transfer.valueCents)}</td>
              </tr>
            </tfoot>
          </table>
        </Section>
        <Section title={t("transfer")}>
          <Fields
            items={[
              { label: t("date"), value: formatDate(transfer.transferredOn) },
              { label: t("fromSite"), value: transfer.fromSite.name },
              { label: t("toSite"), value: transfer.toSite.name },
              { label: t("notes"), value: transfer.notes },
              {
                label: t("entries"),
                value: entries.length
                  ? entries.map((e, i) => (
                      <span key={e.id}>
                        {i > 0 && ", "}
                        <EntryLink id={e.id} number={e.number} />
                      </span>
                    ))
                  : null,
              },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
