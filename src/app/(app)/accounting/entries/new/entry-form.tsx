"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, inputClass, NativeSelect } from "@/components/shared/form";
import { formatMoney, parseEuros } from "@/lib/money";
import { cn } from "@/lib/utils";
import { postEntryAction, type EntryFormInput } from "../../actions";

type Option = { value: string; label: string };
type AccountOpt = { code: string; label: string; analytic: boolean; receivable: boolean; payable: boolean };
type Line = EntryFormInput["lines"][number];

const DEPARTMENTS = ["VN", "VO", "WORKSHOP", "PARTS", "ACCOUNTING", "OVERHEAD"];
const emptyLine = (): Line => ({ accountCode: "", debit: "", credit: "", label: "", departmentCode: "", partyType: "", partyId: "" });

function safeCents(v: string): number {
  try {
    return v.trim() ? parseEuros(v) : 0;
  } catch {
    return 0;
  }
}

export function EntryForm(props: {
  defaultDate: string;
  defaultSiteId: string;
  sites: Option[];
  journals: Option[];
  accounts: AccountOpt[];
  customers: Option[];
  suppliers: Option[];
}) {
  const t = useTranslations("accounting");
  const tu = useTranslations("ui");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [head, setHead] = useState({ journalCode: "OD", siteId: props.defaultSiteId, entryDate: props.defaultDate, label: "" });
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const accounts = useMemo(() => new Map(props.accounts.map((a) => [a.code, a])), [props.accounts]);

  const debit = lines.reduce((s, l) => s + safeCents(l.debit), 0);
  const credit = lines.reduce((s, l) => s + safeCents(l.credit), 0);
  const diff = debit - credit;

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        const acc = accounts.get(next.accountCode);
        if (patch.accountCode !== undefined) {
          next.partyType = acc?.receivable ? "CUSTOMER" : acc?.payable ? "SUPPLIER" : "";
          if (!next.partyType) next.partyId = "";
          if (!acc?.analytic) next.departmentCode = "";
        }
        return next;
      }),
    );

  const submit = () =>
    start(async () => {
      const res = await postEntryAction({ ...head, lines });
      if (!res) return;
      if (res.ok) {
        toast.success(tu("entryPosted"));
        router.push(res.data.redirectTo!);
      } else {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
      }
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("journal")} name="journalCode" error={errors.journalCode}>
          <NativeSelect name="journalCode" options={props.journals} value={head.journalCode} onChange={(e) => setHead({ ...head, journalCode: e.target.value })} />
        </Field>
        <Field label={t("site")} name="siteId" error={errors.siteId}>
          <NativeSelect name="siteId" options={props.sites} value={head.siteId} onChange={(e) => setHead({ ...head, siteId: e.target.value })} />
        </Field>
        <Field label={t("date")} name="entryDate" error={errors.entryDate}>
          <input id="entryDate" type="date" className={inputClass} value={head.entryDate} onChange={(e) => setHead({ ...head, entryDate: e.target.value })} />
        </Field>
        <Field label={t("label")} name="label" error={errors.label}>
          <input id="label" className={inputClass} value={head.label} onChange={(e) => setHead({ ...head, label: e.target.value })} />
        </Field>
      </div>

      <datalist id="accounts">
        {props.accounts.map((a) => (
          <option key={a.code} value={a.code}>
            {a.label}
          </option>
        ))}
      </datalist>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-1 pr-2 w-36">{t("account")}</th>
              <th className="pb-1 pr-2">{t("label")}</th>
              <th className="pb-1 pr-2 w-36">{t("department")}</th>
              <th className="pb-1 pr-2 w-56">{t("party")}</th>
              <th className="pb-1 pr-2 w-28 text-right">{t("debit")}</th>
              <th className="pb-1 pr-2 w-28 text-right">{t("credit")}</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const acc = accounts.get(l.accountCode);
              return (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-2">
                    <input
                      list="accounts"
                      aria-label={`Line ${i + 1} account`}
                      className={cn(inputClass, "font-mono")}
                      value={l.accountCode}
                      onChange={(e) => update(i, { accountCode: e.target.value.trim() })}
                    />
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{acc?.label ?? (l.accountCode ? tu("unknownAccount") : "")}</div>
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Line ${i + 1} label`} className={inputClass} value={l.label} placeholder={head.label} onChange={(e) => update(i, { label: e.target.value })} />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      aria-label={`Line ${i + 1} department`}
                      className={inputClass}
                      disabled={!acc?.analytic}
                      value={l.departmentCode}
                      onChange={(e) => update(i, { departmentCode: e.target.value })}
                    >
                      <option value="" />
                      {DEPARTMENTS.map((d) => (
                        <option key={d} value={d}>
                          {t(`departments.${d}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    {l.partyType && (
                      <select aria-label={`Line ${i + 1} party`} className={inputClass} value={l.partyId} onChange={(e) => update(i, { partyId: e.target.value })}>
                        <option value="" />
                        {(l.partyType === "CUSTOMER" ? props.customers : props.suppliers).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Line ${i + 1} debit`} inputMode="decimal" className={cn(inputClass, "text-right tabular-nums")} value={l.debit} onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={`Line ${i + 1} credit`} inputMode="decimal" className={cn(inputClass, "text-right tabular-nums")} value={l.credit} onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
                  </td>
                  <td className="py-1">
                    <Button type="button" variant="ghost" size="icon" aria-label={t("removeLine")} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="text-[13px] font-semibold">
              <td colSpan={4} className="pt-2 pr-2 text-right">
                {t("total")}
              </td>
              <td className="pt-2 pr-2 text-right tabular-nums">{formatMoney(debit)}</td>
              <td className="pt-2 pr-2 text-right tabular-nums">{formatMoney(credit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
          <Plus /> {t("addLine")}
        </Button>
        <div className="flex items-center gap-3">
          <span data-testid="entry-balance" className={cn("text-sm font-medium", diff === 0 && debit > 0 ? "text-emerald-600" : "text-destructive")}>
            {diff === 0 && debit > 0 ? t("balanced") : `${t("difference")}: ${formatMoney(diff)}`}
          </span>
          <Button type="button" disabled={pending || diff !== 0 || debit === 0} onClick={submit} data-testid="form-submit">
            {pending ? "…" : t("post")}
          </Button>
        </div>
      </div>
    </div>
  );
}
