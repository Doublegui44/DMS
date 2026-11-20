import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { getDiscountMatrix } from "@/modules/parts";
import { PageHeader, Section } from "@/components/shared/page-header";
import { TableForm } from "../../table-form";
import { saveDiscountMatrixAction } from "../../actions";
import { bpToPercent } from "../../format";

export const metadata = { title: "Discount matrix" };

export default async function DiscountMatrixPage() {
  const t = await getTranslations("parts");
  const m = await query((ctx) => getDiscountMatrix(ctx), { resource: "parts.part", action: "view" });
  const classes = m.priceClasses.map((c) => t(`priceClasses.${c}`));
  return (
    <div className="max-w-4xl">
      <PageHeader title={t("discountMatrix")} subtitle={t("discountMatrixHint")} backHref="/parts/catalogue" />
      <Section>
        {m.canEdit ? (
          <TableForm
            action={saveDiscountMatrixAction}
            submitLabel={t("saveMatrix")}
            successMessage={t("matrixSaved")}
            headers={[t("discountCode"), t("parts")]}
            rightAligned={[1]}
            inputHeaders={classes.map((c) => `${c} %`)}
            rows={m.rows.map((r) => ({
              id: r.id,
              cells: [`${r.code} — ${r.label}`, r.parts],
              inputs: m.priceClasses.map((c) => ({ name: c, defaultValue: String(r.rates[c] / 100), testId: `rate-${r.code}-${c}` })),
            }))}
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-3 font-medium">{t("discountCode")}</th>
                {classes.map((c) => (
                  <th key={c} className="py-1.5 pr-3 text-right font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">
                    {r.code} — {r.label}
                  </td>
                  {m.priceClasses.map((c) => (
                    <td key={c} className="py-1.5 pr-3 text-right tabular-nums">
                      {bpToPercent(r.rates[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
