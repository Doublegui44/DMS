"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, inputClass, NativeSelect } from "@/components/shared/form";
import { applyRate, formatMoney, parseEuros, roundCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { saveInvoiceAction, type InvoiceFormInput } from "../../actions";

type Option = { value: string; label: string };
type Line = InvoiceFormInput["lines"][number];

const safe = (fn: () => number) => {
  try {
    return fn();
  } catch {
    return 0;
  }
};

export function InvoiceForm(props: {
  defaultSiteId: string;
  defaultCustomerId: string;
  canIssue: boolean;
  sites: Option[];
  customers: Option[];
  vatRates: (Option & { bp: number })[];
  revenueKeys: Option[];
}) {
  const t = useTranslations("accounting");
  const tu = useTranslations("ui");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [siteId, setSiteId] = useState(props.defaultSiteId);
  const [customerId, setCustomerId] = useState(props.defaultCustomerId);
  const [notes, setNotes] = useState("");
  const newLine = (): Line => ({ label: "", quantity: "1", unitPrice: "", discount: "", vatRateCode: "STANDARD", revenueKey: props.revenueKeys[0]?.value ?? "" });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const computed = lines.map((l) => {
    const qty = Number(l.quantity.replace(",", ".")) || 0;
    const gross = safe(() => roundCents(qty * parseEuros(l.unitPrice || "0")));
    const disc = safe(() => applyRate(gross, l.discount ? parseEuros(l.discount) : 0));
    const excl = gross - disc;
    const bp = props.vatRates.find((r) => r.value === l.vatRateCode)?.bp ?? 0;
    return { excl, vat: applyRate(excl, bp) };
  });
  const totalExcl = computed.reduce((s, c) => s + c.excl, 0);
  const totalVat = computed.reduce((s, c) => s + c.vat, 0);
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = (issue: boolean) =>
    start(async () => {
      const res = await saveInvoiceAction({ siteId, customerId, notes, issue, lines });
      if (!res) return;
      if (res.ok) {
        toast.success(issue ? tu("invoiceIssued") : tu("draftSaved"));
        router.push(res.data.redirectTo!);
      } else {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
      }
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("site")} name="siteId" error={errors.siteId}>
          <NativeSelect name="siteId" options={props.sites} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </Field>
        <Field label={t("customer")} name="customerId" error={errors.customerId} className="sm:col-span-2">
          <NativeSelect name="customerId" placeholder="—" options={props.customers} value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
        </Field>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-1 pr-2">{t("label")}</th>
              <th className="pb-1 pr-2 w-44">{t("revenue")}</th>
              <th className="pb-1 pr-2 w-20 text-right">{t("quantity")}</th>
              <th className="pb-1 pr-2 w-28 text-right">{t("unitPrice")}</th>
              <th className="pb-1 pr-2 w-20 text-right">{t("discount")}</th>
              <th className="pb-1 pr-2 w-28">{t("vatRate")}</th>
              <th className="pb-1 pr-2 w-28 text-right">{t("totalExcl")}</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <input aria-label={`Line ${i + 1} label`} className={inputClass} value={l.label} onChange={(e) => update(i, { label: e.target.value })} />
                </td>
                <td className="py-1 pr-2">
                  <select aria-label={`Line ${i + 1} revenue`} className={inputClass} value={l.revenueKey} onChange={(e) => update(i, { revenueKey: e.target.value })}>
                    {props.revenueKeys.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" className={cn(inputClass, "text-right")} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                </td>
                <td className="py-1 pr-2">
                  <input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" className={cn(inputClass, "text-right")} value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} />
                </td>
                <td className="py-1 pr-2">
                  <input aria-label={`Line ${i + 1} discount`} inputMode="decimal" className={cn(inputClass, "text-right")} value={l.discount} onChange={(e) => update(i, { discount: e.target.value })} />
                </td>
                <td className="py-1 pr-2">
                  <select aria-label={`Line ${i + 1} VAT`} className={inputClass} value={l.vatRateCode} onChange={(e) => update(i, { vatRateCode: e.target.value })}>
                    {props.vatRates.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(computed[i].excl)}</td>
                <td className="py-1">
                  <Button type="button" variant="ghost" size="icon" aria-label={t("removeLine")} disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
          <Plus /> {t("addLine")}
        </Button>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t("totalExcl")}</dt>
          <dd className="text-right tabular-nums">{formatMoney(totalExcl)}</dd>
          <dt className="text-muted-foreground">{t("vat")}</dt>
          <dd className="text-right tabular-nums">{formatMoney(totalVat)}</dd>
          <dt className="font-semibold">{t("totalIncl")}</dt>
          <dd className="text-right font-semibold tabular-nums" data-testid="invoice-total">
            {formatMoney(totalExcl + totalVat)}
          </dd>
        </dl>
      </div>
      <Field label={t("notes")} name="notes">
        <textarea id="notes" className={cn(inputClass, "h-16 py-1.5")} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        {props.canIssue && (
          <Button type="button" disabled={pending} onClick={() => submit(true)} data-testid="invoice-issue">
            {t("issue")}
          </Button>
        )}
        <Button type="button" variant="outline" disabled={pending} onClick={() => submit(false)}>
          {t("saveDraft")}
        </Button>
      </div>
    </div>
  );
}
