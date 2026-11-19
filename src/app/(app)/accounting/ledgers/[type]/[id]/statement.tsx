"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { letterLinesAction, unletterAction } from "../../../actions";

type Line = {
  id: string;
  date: string;
  entryId: string;
  entryNumber: string;
  accountCode: string;
  label: string;
  debitCents: number;
  creditCents: number;
  runningCents: number;
  letteringCode: string | null;
};

export function Statement({ lines, canLetter, partyId }: { lines: Line[]; canLetter: boolean; partyId: string }) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sel = lines.filter((l) => selected.has(l.id));
  const net = sel.reduce((s, l) => s + l.debitCents - l.creditCents, 0);
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } } | null>, msg: string) =>
    start(async () => {
      const res = await fn();
      if (res?.ok) {
        toast.success(msg);
        setSelected(new Set());
        router.refresh();
      } else if (res && "error" in res && res.error) toast.error(res.error.message);
    });

  return (
    <div className="space-y-3">
      {canLetter && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {t("selection")}: {sel.length} · {formatMoney(net)}
          </span>
          <Button size="sm" disabled={pending || sel.length < 2 || net !== 0} onClick={() => run(() => letterLinesAction(sel.map((l) => l.id)), "Lines lettered")}>
            {t("letter")}
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              {canLetter && <th className="w-8" />}
              <th className="py-1.5 pr-3">{t("date")}</th>
              <th className="py-1.5 pr-3">{t("entry")}</th>
              <th className="py-1.5 pr-3">{t("account")}</th>
              <th className="py-1.5 pr-3">{t("label")}</th>
              <th className="py-1.5 pr-3 text-right">{t("debit")}</th>
              <th className="py-1.5 pr-3 text-right">{t("credit")}</th>
              <th className="py-1.5 pr-3 text-right">{t("runningBalance")}</th>
              <th className="py-1.5">{t("lettering")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                {canLetter && (
                  <td className="py-1.5">
                    {!l.letteringCode && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${l.entryNumber}`}
                        checked={selected.has(l.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(l.id);
                          else next.delete(l.id);
                          setSelected(next);
                        }}
                      />
                    )}
                  </td>
                )}
                <td className="py-1.5 pr-3 tabular-nums">{formatDate(l.date)}</td>
                <td className="py-1.5 pr-3">
                  <Link href={`/accounting/entries/${l.entryId}`} className="font-mono text-xs text-primary hover:underline">
                    {l.entryNumber}
                  </Link>
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs">{l.accountCode}</td>
                <td className="py-1.5 pr-3">{l.label}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{l.debitCents ? formatMoney(l.debitCents) : ""}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{l.creditCents ? formatMoney(l.creditCents) : ""}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.runningCents)}</td>
                <td className="py-1.5 font-mono text-xs">
                  {l.letteringCode && canLetter ? (
                    <button
                      type="button"
                      title={t("unletter")}
                      className="hover:text-destructive hover:line-through"
                      disabled={pending}
                      onClick={() => run(() => unletterAction({ accountCode: l.accountCode, partyId, code: l.letteringCode! }), "Lettering removed")}
                    >
                      {l.letteringCode}
                    </button>
                  ) : (
                    l.letteringCode
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
