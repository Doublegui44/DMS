"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, inputClass, NativeSelect } from "@/components/shared/form";
import { formatMoney, parseEuros } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { recordPaymentAction } from "../../actions";

type Option = { value: string; label: string };
type OpenItem = { id: string; number: string; kind: "INVOICE" | "CREDIT_NOTE"; dueDate: string | null; dueCents: number };

const euros = (cents: number) => (cents / 100).toFixed(2);
const safe = (v: string) => {
  try {
    return v.trim() ? parseEuros(v) : 0;
  } catch {
    return 0;
  }
};

export function PaymentForm(props: {
  defaultSiteId: string;
  customerId: string;
  preselectInvoiceId: string | null;
  sites: Option[];
  customers: Option[];
  suppliers: Option[];
  openItems: OpenItem[];
}) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [partyKind, setPartyKind] = useState<"CUSTOMER" | "SUPPLIER">("CUSTOMER");
  const [siteId, setSiteId] = useState(props.defaultSiteId);
  const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [method, setMethod] = useState("CARD");
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>(() =>
    props.preselectInvoiceId ? Object.fromEntries(props.openItems.filter((i) => i.id === props.preselectInvoiceId).map((i) => [i.id, euros(i.dueCents)])) : {},
  );
  const allocatedCents = Object.values(alloc).reduce((s, v) => s + safe(v), 0);
  const [amount, setAmount] = useState(() => (allocatedCents ? euros(allocatedCents) : ""));
  const settleKind = direction === "IN" ? "INVOICE" : "CREDIT_NOTE";
  const items = props.openItems.filter((i) => i.kind === settleKind);

  const toggle = (item: OpenItem, on: boolean) => {
    const next = { ...alloc };
    if (on) next[item.id] = euros(item.dueCents);
    else delete next[item.id];
    setAlloc(next);
    setAmount(euros(Object.values(next).reduce((s, v) => s + safe(v), 0)));
  };

  const submit = () =>
    start(async () => {
      const res = await recordPaymentAction({
        siteId,
        direction: partyKind === "SUPPLIER" ? "OUT" : direction,
        method,
        customerId: partyKind === "CUSTOMER" ? props.customerId : "",
        supplierId: partyKind === "SUPPLIER" ? supplierId : "",
        amount,
        reference,
        allocations: partyKind === "CUSTOMER" ? Object.entries(alloc).map(([invoiceId, a]) => ({ invoiceId, amount: a })) : [],
      });
      if (!res) return;
      if (res.ok) {
        toast.success("Payment recorded");
        router.push(res.data.redirectTo!);
      } else toast.error(res.error.message);
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("partyKind")} name="partyKind">
          <NativeSelect
            name="partyKind"
            value={partyKind}
            onChange={(e) => setPartyKind(e.target.value as "CUSTOMER" | "SUPPLIER")}
            options={[
              { value: "CUSTOMER", label: t("customer") },
              { value: "SUPPLIER", label: t("supplier") },
            ]}
          />
        </Field>
        {partyKind === "CUSTOMER" ? (
          <Field label={t("customer")} name="customerId" className="sm:col-span-2">
            <NativeSelect
              name="customerId"
              placeholder="—"
              options={props.customers}
              value={props.customerId}
              onChange={(e) => router.push(`${pathname}?customer=${e.target.value}&site=${siteId}`)}
            />
          </Field>
        ) : (
          <Field label={t("supplier")} name="supplierId" className="sm:col-span-2">
            <NativeSelect name="supplierId" placeholder="—" options={props.suppliers} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} />
          </Field>
        )}
        <Field label={t("site")} name="siteId">
          <NativeSelect name="siteId" options={props.sites} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </Field>
        {partyKind === "CUSTOMER" && (
          <Field label={t("direction")} name="direction">
            <NativeSelect
              name="direction"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as "IN" | "OUT");
                setAlloc({});
              }}
              options={[
                { value: "IN", label: t("directions.IN") },
                { value: "OUT", label: `${t("directions.OUT")} (refund)` },
              ]}
            />
          </Field>
        )}
        <Field label={t("method")} name="method">
          <NativeSelect
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            options={["CARD", "TRANSFER", "CHEQUE", "CASH", "FINANCE_COMPANY"].map((m) => ({ value: m, label: t(`methods.${m}`) }))}
          />
        </Field>
        <Field label={t("amount")} name="amount">
          <input id="amount" inputMode="decimal" className={cn(inputClass, "text-right")} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t("reference")} name="reference">
          <input id="reference" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      {partyKind === "CUSTOMER" && props.customerId && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t("openItems")}</h3>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noOpenItems")}</p>
          ) : (
            <table className="w-full max-w-2xl text-[13px]">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8" />
                  <th className="py-1 pr-3">{t("number")}</th>
                  <th className="py-1 pr-3">{t("dueDate")}</th>
                  <th className="py-1 pr-3 text-right">{t("due")}</th>
                  <th className="py-1 text-right">{t("allocate")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="py-1">
                      <input type="checkbox" aria-label={`Allocate ${i.number}`} checked={i.id in alloc} onChange={(e) => toggle(i, e.target.checked)} />
                    </td>
                    <td className="py-1 pr-3 font-mono text-xs">{i.number}</td>
                    <td className="py-1 pr-3">{formatDate(i.dueDate)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(i.dueCents)}</td>
                    <td className="py-1 text-right">
                      <input
                        aria-label={`Amount for ${i.number}`}
                        inputMode="decimal"
                        disabled={!(i.id in alloc)}
                        className={cn(inputClass, "ml-auto w-28 text-right")}
                        value={alloc[i.id] ?? ""}
                        onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            {t("allocated")}: <span className="tabular-nums">{formatMoney(allocatedCents)}</span> · {t("unallocated")}:{" "}
            <span className="tabular-nums">{formatMoney(safe(amount) - allocatedCents)}</span>
          </p>
        </div>
      )}
      <Button type="button" disabled={pending} onClick={submit} data-testid="form-submit">
        {pending ? "…" : t("recordPayment")}
      </Button>
    </div>
  );
}
