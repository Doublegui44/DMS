"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Car, Factory, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, inputClass, NativeSelect } from "@/components/shared/form";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatKm } from "@/lib/format-locale";
import { formatBp, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { QuoteInput, QuotePreview } from "@/modules/sales";
import { previewQuoteAction, saveQuoteAction } from "../actions";
import { MarketValuation } from "../market-valuation";
import { centsToInput, FUELS, type BuilderData, type Fuel, type FinancingDraft, type QuoteDraft, type TradeInDraft } from "./draft";

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s.replace(/[\s  ]/g, "").replace(",", ".")));

function toInput(leadId: string, d: QuoteDraft): QuoteInput {
  const factory = d.source === "FACTORY";
  return {
    leadId,
    vehicleId: factory ? null : d.vehicleId || null,
    catalogueVersionId: factory ? d.catalogueVersionId || null : null,
    optionIds: factory ? d.optionIds : [],
    colour: factory ? d.colour : "",
    accessories: d.accessories.filter((a) => a.label.trim() || a.price.trim()).map((a) => ({ label: a.label, priceExclVatCents: a.price, costCents: a.cost })),
    addOnIds: d.addOnIds,
    discountInclVatCents: d.discount,
    applyOemIncentive: d.applyOemIncentive,
    includeRegistration: d.includeRegistration,
    tradeIn: d.tradeIn
      ? {
          vehicleId: d.tradeIn.vehicleId || null,
          vin: d.tradeIn.vin,
          registration: d.tradeIn.registration,
          make: d.tradeIn.make,
          model: d.tradeIn.model,
          version: d.tradeIn.version,
          firstRegistration: d.tradeIn.firstRegistration,
          mileage: num(d.tradeIn.mileage),
          fuel: d.tradeIn.fuel,
          marketValueCents: d.tradeIn.marketValue,
          estimatedRepairCents: d.tradeIn.estimatedRepair,
          offerCents: d.tradeIn.offer,
          notes: d.tradeIn.notes,
        }
      : null,
    financing: d.financing
      ? {
          kind: d.financing.kind,
          lender: d.financing.lender,
          principalCents: d.financing.principal,
          months: num(d.financing.months),
          aprBp: d.financing.apr.trim() === "" ? undefined : Math.round(num(d.financing.apr) * 100),
          residualCents: d.financing.kind === "LEASE" ? d.financing.residual : "",
        }
      : null,
    notes: d.notes,
  };
}

function Card({ title, icon, children, aside }: { title: string; icon?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {icon}
          {title}
        </h2>
        {aside}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function Check({ checked, onChange, children, testId }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; testId?: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" className="size-3.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      {children}
    </label>
  );
}

export function QuoteBuilder({ data, quoteId, initial, canSend }: { data: BuilderData; quoteId: string | null; initial: QuoteDraft; canSend: boolean }) {
  const t = useTranslations("sales");
  const router = useRouter();
  const [draft, setDraft] = useState<QuoteDraft>(initial);
  const [preview, setPreview] = useState<QuotePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [attempted, setAttempted] = useState(false);
  const [saving, startSave] = useTransition();
  const seq = useRef(0);

  const set = (patch: Partial<QuoteDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setTradeIn = (patch: Partial<TradeInDraft>) => setDraft((d) => (d.tradeIn ? { ...d, tradeIn: { ...d.tradeIn, ...patch } } : d));
  const setFinancing = (patch: Partial<FinancingDraft>) => setDraft((d) => (d.financing ? { ...d, financing: { ...d.financing, ...patch } } : d));

  const input = useMemo(() => toInput(data.leadId, draft), [data.leadId, draft]);
  const hasVehicle = !!(input.vehicleId || input.catalogueVersionId);

  // Live pricing: the server prices the deal exactly as it will be saved (debounced, latest wins).
  useEffect(() => {
    if (!hasVehicle) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      const res = await previewQuoteAction(input);
      if (id !== seq.current) return;
      setPreviewing(false);
      if (res.ok) {
        setPreview(res.data);
        setPreviewError(null);
        if (attempted) setErrors({});
      } else {
        setPreviewError(res.error.message);
        if (attempted) setErrors(res.error.fieldErrors ?? {});
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [input, hasVehicle, attempted]);

  const err = (...names: string[]) => names.map((n) => errors[n]).find((e) => e?.length);

  const save = (send: boolean) =>
    startSave(async () => {
      setAttempted(true);
      const res = await saveQuoteAction(quoteId, input, send);
      if (!res) return;
      if (res.ok) {
        toast.success(send ? t("quoteSent") : t("quoteSaved"));
        router.push(res.data.redirectTo ?? `/sales/quotes/${res.data.id}`);
      } else {
        setErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
      }
    });

  // ── Vehicle ──
  const stockVehicle = data.stock.find((v) => v.id === draft.vehicleId) ?? null;
  const model = data.catalogue.find((m) => m.versions.some((v) => v.id === draft.catalogueVersionId)) ?? null;
  const [modelId, setModelId] = useState(model?.id ?? "");
  const versions = data.catalogue.find((m) => m.id === modelId)?.versions ?? [];
  const version = versions.find((v) => v.id === draft.catalogueVersionId) ?? null;
  const isVn = draft.source === "FACTORY" || stockVehicle?.stockType === "VN";
  const incentive = draft.source === "FACTORY" ? (version?.oemIncentiveCents ?? 0) : (stockVehicle?.oemIncentiveCents ?? 0);
  const stockGroups = (data.interest === "VO" ? (["VO", "VN"] as const) : (["VN", "VO"] as const))
    .map((type) => ({ type, vehicles: data.stock.filter((v) => v.stockType === type) }))
    .filter((g) => g.vehicles.length);

  const toggleOption = (o: { id: string; kind: string }, on: boolean) =>
    setDraft((d) => {
      let ids = d.optionIds.filter((x) => x !== o.id);
      if (on) {
        // One paint only: picking a paint replaces the previous one.
        if (o.kind === "PAINT") ids = ids.filter((x) => version?.options.find((p) => p.id === x)?.kind !== "PAINT");
        ids = [...ids, o.id];
      }
      return { ...d, optionIds: ids };
    });

  const pickOwnCar = (id: string) => {
    const car = data.ownCars.find((c) => c.id === id);
    if (!car) return setTradeIn({ vehicleId: "" });
    setTradeIn({
      vehicleId: car.id,
      vin: car.vin,
      registration: car.registration ?? "",
      make: car.make,
      model: car.model,
      version: car.version,
      firstRegistration: car.firstRegistration ?? "",
      mileage: car.mileage === null ? "" : String(car.mileage),
      fuel: (FUELS as readonly string[]).includes(car.fuel) ? (car.fuel as Fuel) : "PETROL",
    });
  };

  const thresholds = data.approvalThresholds.map((a) => t("approvalAbove", { pct: formatBp(a.thresholdBp, 0), role: a.role })).join(" · ");
  const owed = preview ? preview.totalInclVatCents - preview.tradeInCents : null;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        {/* Vehicle */}
        <Card
          title={t("vehicle")}
          icon={<Car className="size-4 text-muted-foreground" />}
          aside={
            <div className="flex rounded-md border p-0.5 text-xs" role="tablist">
              {(["STOCK", "FACTORY"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={draft.source === s}
                  onClick={() => set({ source: s })}
                  className={cn("flex items-center gap-1 rounded px-2 py-1", draft.source === s && "bg-muted font-medium")}
                  data-testid={`source-${s.toLowerCase()}`}
                >
                  {s === "STOCK" ? <Car className="size-3.5" /> : <Factory className="size-3.5" />}
                  {s === "STOCK" ? t("fromStock") : t("factoryOrder")}
                </button>
              ))}
            </div>
          }
        >
          {draft.source === "STOCK" ? (
            <>
              <Field label={t("stockVehicle")} name="vehicleId" error={err("vehicleId")}>
                <select
                  id="vehicleId"
                  className={inputClass}
                  value={draft.vehicleId}
                  onChange={(e) => set({ vehicleId: e.target.value })}
                  aria-invalid={!!err("vehicleId") || undefined}
                  data-testid="quote-vehicle"
                >
                  <option value="">{t("chooseVehicle")}</option>
                  {stockGroups.map((g) => (
                    <optgroup key={g.type} label={t(`stockGroups.${g.type}`)}>
                      {g.vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {`${v.label} — ${v.registration ?? v.vin.slice(-8)} — ${formatMoney(v.listPriceCents, { decimals: false })}${v.reservedFor ? ` — ${t("reservedFor", { name: v.reservedFor })}` : ""}`}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
              {stockVehicle && (
                <div className="grid gap-x-6 gap-y-1.5 rounded-md bg-muted/50 p-3 text-[13px] sm:grid-cols-3">
                  <div>
                    <div className="text-xs text-muted-foreground">{t("status")}</div>
                    <StatusBadge status={stockVehicle.status} label={t(`vehicleStatuses.${stockVehicle.status}`)} />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">VIN</div>
                    <div className="font-mono text-xs">{stockVehicle.vin}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("sellingPrice")}</div>
                    <div className="tabular-nums">
                      {formatMoney(stockVehicle.listPriceCents)} <span className="text-xs text-muted-foreground">{t("inclVat")}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("colour")}</div>
                    <div>{stockVehicle.colour ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("mileage")}</div>
                    <div className="tabular-nums">{stockVehicle.mileage === null ? "—" : formatKm(stockVehicle.mileage)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("vatRegime")}</div>
                    <div>{t(`vatRegimes.${stockVehicle.vatRegime}`)}</div>
                  </div>
                  {stockVehicle.reservedFor && (
                    <p className="flex items-center gap-1.5 text-xs text-amber-700 sm:col-span-3 dark:text-amber-400">
                      <AlertTriangle className="size-3.5" /> {t("reservedWarning", { name: stockVehicle.reservedFor })}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("model")} name="modelId">
                  <NativeSelect
                    name="modelId"
                    value={modelId}
                    onChange={(e) => {
                      setModelId(e.target.value);
                      set({ catalogueVersionId: "", optionIds: [] });
                    }}
                    options={data.catalogue.map((m) => ({ value: m.id, label: m.label }))}
                    placeholder={t("chooseModel")}
                    data-testid="quote-model"
                  />
                </Field>
                <Field label={t("version")} name="catalogueVersionId" error={err("catalogueVersionId")}>
                  <NativeSelect
                    name="catalogueVersionId"
                    value={draft.catalogueVersionId}
                    onChange={(e) => set({ catalogueVersionId: e.target.value, optionIds: [] })}
                    options={versions.map((v) => ({ value: v.id, label: `${v.name} — ${formatMoney(v.listPriceExclVatCents, { decimals: false })} ${t("exclVatShort")}` }))}
                    placeholder={modelId ? t("chooseVersion") : t("chooseModelFirst")}
                    invalid={!!err("catalogueVersionId")}
                    data-testid="quote-version"
                  />
                </Field>
              </div>
              {version && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t("versionFacts", { fuel: t(`fuels.${version.fuel}`), co2: version.co2 ?? "—", hp: version.powerHp ?? "—", days: version.leadTimeDays })}
                  </p>
                  <Field label={t("options")} name="optionIds" error={err("optionIds")}>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {version.options.map((o) => (
                        <label key={o.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[13px]">
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="size-3.5"
                              checked={draft.optionIds.includes(o.id)}
                              onChange={(e) => toggleOption(o, e.target.checked)}
                              data-testid={`option-${o.code}`}
                            />
                            {o.label}
                            {o.kind === "PAINT" && <span className="text-[11px] text-muted-foreground">{t("paint")}</span>}
                          </span>
                          <span className="tabular-nums text-xs text-muted-foreground">{formatMoney(o.listPriceExclVatCents, { decimals: false })}</span>
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label={t("colour")} name="colour">
                    <input id="colour" className={inputClass} value={draft.colour} onChange={(e) => set({ colour: e.target.value })} placeholder={t("colourPlaceholder")} />
                  </Field>
                </>
              )}
            </>
          )}
        </Card>

        {/* Accessories & add-ons */}
        <Card
          title={t("accessoriesAndAddOns")}
          aside={
            <Button type="button" size="sm" variant="ghost" onClick={() => set({ accessories: [...draft.accessories, { label: "", price: "", cost: "" }] })} data-testid="add-accessory">
              <Plus /> {t("addAccessory")}
            </Button>
          }
        >
          {draft.accessories.length > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_32px] gap-2 text-xs text-muted-foreground">
                <span>{t("accessory")}</span>
                <span>{t("priceExclVat")}</span>
                <span>{t("cost")}</span>
                <span />
              </div>
              {draft.accessories.map((a, i) => {
                const update = (patch: Partial<typeof a>) => set({ accessories: draft.accessories.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_110px_32px] gap-2">
                    <input className={inputClass} value={a.label} onChange={(e) => update({ label: e.target.value })} placeholder={t("accessoryPlaceholder")} aria-label={t("accessory")} />
                    <input className={cn(inputClass, "text-right")} inputMode="decimal" value={a.price} onChange={(e) => update({ price: e.target.value })} placeholder="0.00" aria-label={t("priceExclVat")} />
                    <input className={cn(inputClass, "text-right")} inputMode="decimal" value={a.cost} onChange={(e) => update({ cost: e.target.value })} placeholder="0.00" aria-label={t("cost")} />
                    <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => set({ accessories: draft.accessories.filter((_, j) => j !== i) })} aria-label={t("remove")}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
              {err("accessories") && <p className="text-xs text-destructive">{err("accessories")![0]}</p>}
            </div>
          )}
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">{t("addOns")}</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {data.addOns.map((a) => (
                <label key={a.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[13px]">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-3.5"
                      checked={draft.addOnIds.includes(a.id)}
                      onChange={(e) => set({ addOnIds: e.target.checked ? [...draft.addOnIds, a.id] : draft.addOnIds.filter((x) => x !== a.id) })}
                    />
                    {a.name}
                  </span>
                  <span className="tabular-nums text-xs text-muted-foreground">{formatMoney(a.priceExclVatCents, { decimals: false })}</span>
                </label>
              ))}
            </div>
          </div>
        </Card>

        {/* Discount & fees */}
        <Card title={t("discountAndFees")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("discountInclVat")} name="discount" error={err("discountInclVatCents")}>
              <input
                id="discount"
                className={cn(inputClass, "text-right")}
                inputMode="decimal"
                value={draft.discount}
                onChange={(e) => set({ discount: e.target.value })}
                placeholder="0.00"
                aria-invalid={!!err("discountInclVatCents") || undefined}
                data-testid="quote-discount"
              />
              {thresholds && <p className="text-[11px] text-muted-foreground">{thresholds}</p>}
            </Field>
            <div className="space-y-2 pt-5">
              {isVn && incentive > 0 && (
                <Check checked={draft.applyOemIncentive} onChange={(v) => set({ applyOemIncentive: v })}>
                  {t("applyIncentive", { amount: formatMoney(incentive, { decimals: false }) })}
                </Check>
              )}
              <Check checked={draft.includeRegistration} onChange={(v) => set({ includeRegistration: v })}>
                {t("includeRegistration")}
              </Check>
            </div>
          </div>
        </Card>

        {/* Trade-in */}
        <Card
          title={t("tradeIn")}
          aside={
            <Check
              checked={!!draft.tradeIn}
              testId="tradein-toggle"
              onChange={(on) =>
                set({
                  tradeIn: on
                    ? { vehicleId: "", vin: "", registration: "", make: "", model: "", version: "", firstRegistration: "", mileage: "", fuel: "DIESEL", marketValue: "", estimatedRepair: "", offer: "", notes: "" }
                    : null,
                })
              }
            >
              {t("customerTradesIn")}
            </Check>
          }
        >
          {!draft.tradeIn ? (
            <p className="text-sm text-muted-foreground">{t("noTradeIn")}</p>
          ) : (
            <>
              {data.ownCars.length > 0 && (
                <Field label={t("customerCar")} name="tradeIn.vehicleId" error={err("tradeIn.vehicleId")}>
                  <NativeSelect
                    name="tradeIn.vehicleId"
                    value={draft.tradeIn.vehicleId}
                    onChange={(e) => pickOwnCar(e.target.value)}
                    options={data.ownCars.map((c) => ({ value: c.id, label: `${c.make} ${c.model} ${c.version} — ${c.registration ?? c.vin}` }))}
                    placeholder={t("anotherCar")}
                    data-testid="tradein-own-car"
                  />
                </Field>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["vin", "VIN", "tradein-vin"],
                    ["registration", t("registration"), "tradein-registration"],
                    ["make", t("make"), "tradein-make"],
                    ["model", t("model"), "tradein-model"],
                    ["version", t("version"), undefined],
                  ] as const
                ).map(([k, label, testId]) => (
                  <Field key={k} label={label} name={`tradeIn.${k}`} error={err(`tradeIn.${k}`)}>
                    <input
                      id={`tradeIn.${k}`}
                      className={cn(inputClass, k === "vin" && "font-mono uppercase")}
                      value={draft.tradeIn![k]}
                      onChange={(e) => setTradeIn({ [k]: e.target.value })}
                      aria-invalid={!!err(`tradeIn.${k}`) || undefined}
                      data-testid={testId}
                    />
                  </Field>
                ))}
                <Field label={t("firstRegistration")} name="tradeIn.firstRegistration" error={err("tradeIn.firstRegistration")}>
                  <input id="tradeIn.firstRegistration" type="date" className={inputClass} value={draft.tradeIn.firstRegistration} onChange={(e) => setTradeIn({ firstRegistration: e.target.value })} />
                </Field>
                <Field label={t("mileage")} name="tradeIn.mileage" error={err("tradeIn.mileage")}>
                  <input
                    id="tradeIn.mileage"
                    className={cn(inputClass, "text-right")}
                    inputMode="numeric"
                    value={draft.tradeIn.mileage}
                    onChange={(e) => setTradeIn({ mileage: e.target.value })}
                    aria-invalid={!!err("tradeIn.mileage") || undefined}
                    data-testid="tradein-mileage"
                  />
                </Field>
                <Field label={t("fuel")} name="tradeIn.fuel">
                  <NativeSelect name="tradeIn.fuel" value={draft.tradeIn.fuel} onChange={(e) => setTradeIn({ fuel: e.target.value as Fuel })} options={FUELS.map((f) => ({ value: f, label: t(`fuels.${f}`) }))} />
                </Field>
              </div>
              <MarketValuation
                testId="tradein-market-feed"
                query={() => ({ make: draft.tradeIn!.make, model: draft.tradeIn!.model, firstRegistration: draft.tradeIn!.firstRegistration, mileage: draft.tradeIn!.mileage, fuel: draft.tradeIn!.fuel })}
                onUse={(cents) => setTradeIn({ marketValue: centsToInput(cents) })}
              />
              <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
                {(
                  [
                    ["marketValue", t("marketValue"), "tradeIn.marketValueCents", "tradein-market"],
                    ["estimatedRepair", t("estimatedRepair"), "tradeIn.estimatedRepairCents", "tradein-repair"],
                    ["offer", t("tradeInOffer"), "tradeIn.offerCents", "tradein-offer"],
                  ] as const
                ).map(([k, label, errKey, testId]) => (
                  <Field key={k} label={label} name={errKey} error={err(errKey, k === "offer" ? "tradeInOfferCents" : errKey)}>
                    <input
                      id={errKey}
                      className={cn(inputClass, "text-right")}
                      inputMode="decimal"
                      value={draft.tradeIn![k]}
                      onChange={(e) => setTradeIn({ [k]: e.target.value })}
                      placeholder="0.00"
                      aria-invalid={!!err(errKey) || undefined}
                      data-testid={testId}
                    />
                  </Field>
                ))}
              </div>
              {preview && preview.overAllowanceCents > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{t("overAllowanceHint", { amount: formatMoney(preview.overAllowanceCents) })}</p>
              )}
            </>
          )}
        </Card>

        {/* Financing */}
        <Card
          title={t("financing")}
          aside={
            <Check
              checked={!!draft.financing}
              testId="financing-toggle"
              onChange={(on) =>
                set({
                  financing: on
                    ? { kind: "LOAN", lender: data.financing.lenders[0] ?? "", principal: owed && owed > 0 ? centsToInput(owed) : "", months: "48", apr: "", residual: "" }
                    : null,
                })
              }
            >
              {t("financeWithPartner")}
            </Check>
          }
        >
          {!draft.financing ? (
            <p className="text-sm text-muted-foreground">{t("noFinancing")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("financingKind")} name="financing.kind">
                <NativeSelect
                  name="financing.kind"
                  value={draft.financing.kind}
                  onChange={(e) => setFinancing({ kind: e.target.value as "LOAN" | "LEASE" })}
                  options={[
                    { value: "LOAN", label: t("financingKinds.LOAN") },
                    { value: "LEASE", label: t("financingKinds.LEASE") },
                  ]}
                />
              </Field>
              <Field label={t("lender")} name="financing.lender" error={err("financing.lender")}>
                <NativeSelect name="financing.lender" value={draft.financing.lender} onChange={(e) => setFinancing({ lender: e.target.value })} options={data.financing.lenders.map((l) => ({ value: l, label: l }))} />
              </Field>
              <Field label={t("amountFinanced")} name="financing.principalCents" error={err("financing.principalCents", "principalCents", "financing")}>
                <div className="flex gap-1">
                  <input
                    id="financing.principalCents"
                    className={cn(inputClass, "text-right")}
                    inputMode="decimal"
                    value={draft.financing.principal}
                    onChange={(e) => setFinancing({ principal: e.target.value })}
                    placeholder="0.00"
                    data-testid="financing-principal"
                  />
                  {owed !== null && owed > 0 && (
                    <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setFinancing({ principal: centsToInput(owed) })} title={t("financeBalanceHint")}>
                      {t("all")}
                    </Button>
                  )}
                </div>
              </Field>
              <Field label={t("months")} name="financing.months" error={err("financing.months", "months")}>
                <input id="financing.months" className={cn(inputClass, "text-right")} inputMode="numeric" value={draft.financing.months} onChange={(e) => setFinancing({ months: e.target.value })} />
              </Field>
              <Field label={t("aprPct")} name="financing.aprBp" error={err("financing.aprBp", "aprBp")}>
                <input
                  id="financing.aprBp"
                  className={cn(inputClass, "text-right")}
                  inputMode="decimal"
                  value={draft.financing.apr}
                  onChange={(e) => setFinancing({ apr: e.target.value })}
                  placeholder={(data.financing.defaultAprBp / 100).toFixed(2)}
                />
              </Field>
              {draft.financing.kind === "LEASE" && (
                <Field label={t("residualValue")} name="financing.residualCents" error={err("financing.residualCents", "residualCents")}>
                  <input
                    id="financing.residualCents"
                    className={cn(inputClass, "text-right")}
                    inputMode="decimal"
                    value={draft.financing.residual}
                    onChange={(e) => setFinancing({ residual: e.target.value })}
                    placeholder="0.00"
                  />
                </Field>
              )}
              <p className="text-[11px] text-muted-foreground sm:col-span-3">
                {t("financingHint", { pct: formatBp(data.financing.commissionBp), min: data.financing.minMonths, max: data.financing.maxMonths })}
              </p>
            </div>
          )}
        </Card>

        <Card title={t("notes")}>
          <textarea className={cn(inputClass, "h-auto py-1.5")} rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={t("notesPlaceholder")} aria-label={t("notes")} />
        </Card>
      </div>

      {/* Live summary */}
      <aside className="space-y-3 xl:sticky xl:top-16">
        <section className="rounded-lg border bg-card" data-testid="quote-summary">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold">{t("dealSummary")}</h2>
            {previewing && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="p-4 text-[13px]">
            {!hasVehicle ? (
              <p className="text-muted-foreground">{t("chooseVehicleToPrice")}</p>
            ) : !preview ? (
              <p className="text-muted-foreground">{previewError ?? "…"}</p>
            ) : (
              <div className={cn("space-y-3", previewing && "opacity-60")}>
                {previewError && (
                  <p className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" data-testid="preview-error">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {previewError}
                  </p>
                )}
                <table className="w-full">
                  <tbody>
                    {preview.lines.map((l, i) => (
                      <tr key={i} className="align-top">
                        <td className="py-0.5 pr-2">
                          {l.label}
                          {l.quantity > 1 && <span className="text-muted-foreground"> × {l.quantity}</span>}
                        </td>
                        <td className={cn("whitespace-nowrap py-0.5 text-right tabular-nums", l.lineInclVatCents < 0 && "text-emerald-700 dark:text-emerald-400")}>{formatMoney(l.lineInclVatCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <dl className="space-y-1 border-t pt-2">
                  <Row label={t("totalExcl")} value={formatMoney(preview.totalExclVatCents)} />
                  <Row label={t("vat")} value={formatMoney(preview.vatCents)} />
                  <Row label={t("totalIncl")} value={formatMoney(preview.totalInclVatCents)} strong testId="summary-total" />
                  {preview.tradeInCents > 0 && <Row label={t("tradeInDeducted")} value={`− ${formatMoney(preview.tradeInCents)}`} />}
                  {preview.financedCents > 0 && <Row label={t("financedBy", { lender: preview.financing?.lender ?? "" })} value={`− ${formatMoney(preview.financedCents)}`} />}
                  {(preview.tradeInCents > 0 || preview.financedCents > 0) && <Row label={t("balanceDue")} value={formatMoney(preview.balanceDueCents)} strong />}
                </dl>
                {preview.financing && (
                  <div className="rounded-md bg-muted/60 p-2.5 text-xs">
                    <div className="font-medium">
                      {t("monthlyPayment", { amount: formatMoney(preview.financing.monthlyPaymentCents), months: preview.financing.months })}
                    </div>
                    <div className="text-muted-foreground">
                      {t("financingFacts", {
                        apr: formatBp(preview.financing.aprBp),
                        cost: formatMoney(preview.financing.totalCostCents),
                        residual: formatMoney(preview.financing.residualCents),
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
        {preview && (
          <section className="rounded-lg border bg-card">
            <div className="border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold">{t("dealerView")}</h2>
            </div>
            <dl className="space-y-1 p-4 text-[13px]">
              <Row label={t("listPrice")} value={formatMoney(preview.listPriceInclVatCents)} />
              <Row label={t("effectiveDiscount")} value={formatBp(preview.discountBp)} testId="summary-discount" />
              {preview.overAllowanceCents > 0 && <Row label={t("overAllowance")} value={formatMoney(preview.overAllowanceCents)} />}
              <Row label={t("frontEndMargin")} value={formatMoney(preview.frontEndMarginCents)} tone={preview.frontEndMarginCents < 0 ? "bad" : undefined} />
              <Row label={t("backEndMargin")} value={formatMoney(preview.backEndMarginCents)} />
              <Row label={t("commission")} value={formatMoney(preview.commissionCents)} />
              {preview.approvalRole && (
                <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" data-testid="approval-needed">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {t("approvalNeeded", { role: preview.approvalRole })}
                </p>
              )}
            </dl>
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={() => save(false)} data-testid="quote-save">
            {saving ? "…" : t("saveDraft")}
          </Button>
          {canSend && (
            <Button type="button" disabled={saving} onClick={() => save(true)} data-testid="quote-send">
              {saving ? "…" : preview?.approvalRole ? t("saveAndSubmit") : t("saveAndSend")}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            {t("cancel")}
          </Button>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value, strong, tone, testId }: { label: string; value: string; strong?: boolean; tone?: "bad"; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("text-muted-foreground", strong && "font-medium text-foreground")}>{label}</dt>
      <dd className={cn("tabular-nums", strong && "font-semibold", tone === "bad" && "text-red-700 dark:text-red-400")} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
