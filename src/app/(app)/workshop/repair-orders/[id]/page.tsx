import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Check, CircleCheck, RotateCcw, X } from "lucide-react";
import { query } from "@/lib/session";
import { formatBp, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { CASH_METHODS } from "@/modules/accounting";
import { getRepairOrder, JOB_PAYERS } from "@/modules/workshop";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { SpecForm } from "@/components/shared/spec-form";
import { ActionButton } from "@/components/shared/action-button";
import { EntryLink } from "../../../parts/entry-link";
import {
  addJobAction,
  addLabourLineAction,
  addPartLineAction,
  addSubletLineAction,
  cancelRepairOrderAction,
  closeRepairOrderAction,
  completeJobAction,
  decideJobAction,
  invoiceRepairOrderAction,
  qualityCheckAction,
  recordRoPaymentAction,
  removeLabourLineAction,
  removePartLineAction,
  removeSubletLineAction,
  reopenJobAction,
} from "../../actions";
import { clock, hours, vehicleName } from "../../format";

export const metadata = { title: "Repair order" };

const qtyText = (q: { toString(): string }) => String(Number(q.toString()));

export default async function RepairOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("workshop");
  const d = await query((ctx) => getRepairOrder(ctx, id));
  const { ro } = d;
  const workable = ro.status === "CHECKED_IN" || ro.status === "IN_PROGRESS";
  const open = workable || ro.status === "QUALITY_CHECK" || ro.status === "READY";
  const payers = JOB_PAYERS.filter((p) => (ro.kind === "INTERNAL" ? p === "INTERNAL" : p !== "INTERNAL")).filter((p) => p !== "WARRANTY" || ro.vehicle.brandId);
  const individual = ro.customer?.kind === "INDIVIDUAL" || (ro.customer?.paymentTermsDays ?? 0) === 0;
  const payOptions = [{ value: "ACCOUNT", label: t("onAccount") }, ...CASH_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) }))];
  const damages = (ro.damages as { zone: string; note: string }[]) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("repairOrder")} ${ro.number}`}
        subtitle={`${vehicleName(ro.vehicle)} · ${ro.customer?.displayName ?? t("internalCustomer")} · ${ro.site.name}`}
        backHref="/workshop/repair-orders"
        badges={
          <>
            <StatusBadge status={ro.status} label={t(`roStatuses.${ro.status}`)} />
            <StatusBadge status={ro.kind === "INTERNAL" ? "INTERNAL" : "CUSTOMER"} label={t(`kinds.${ro.kind}`)} />
          </>
        }
        actions={
          <>
            {d.canEdit && ro.status === "INVOICED" && (
              <ActionButton action={closeRepairOrderAction.bind(null, ro.id)} label={t("handOver")} icon={<CircleCheck />} successMessage={t("handedOver")} />
            )}
            {d.canValidate && open && ro.clockings.length === 0 && (
              <ActionButton action={cancelRepairOrderAction.bind(null, ro.id)} label={t("cancelRo")} variant="outline" icon={<X />} confirm={t("cancelRoConfirm")} />
            )}
          </>
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {d.jobs.length === 0 && (
            <Section>
              <p className="text-[13px] text-muted-foreground">{t("noJobs")}</p>
            </Section>
          )}
          {d.jobs.map((job) => {
            const editable = d.canEdit && workable && job.status === "OPEN" && job.approval !== "DECLINED";
            return (
              <Section
                key={job.id}
                title={
                  <span className="flex flex-wrap items-center gap-2" data-testid={`job-${job.lineNo}`}>
                    {job.lineNo}. {job.description}
                    <StatusBadge status={job.payer} label={t(`payers.${job.payer}`)} />
                    {job.approval !== "NOT_REQUIRED" && <StatusBadge status={job.approval} label={t(`approvals.${job.approval}`)} />}
                    <StatusBadge status={job.status} label={t(`jobStatuses.${job.status}`)} />
                  </span>
                }
                actions={
                  d.canEdit && (
                    <div className="flex gap-2">
                      {job.approval === "PENDING" && open && (
                        <>
                          <ActionButton action={decideJobAction.bind(null, ro.id, job.id, true)} label={t("approve")} icon={<Check />} successMessage={t("approved")} />
                          <ActionButton action={decideJobAction.bind(null, ro.id, job.id, false)} label={t("decline")} variant="outline" icon={<X />} />
                        </>
                      )}
                      {workable && job.status === "OPEN" && job.mayProceed && (
                        <ActionButton action={completeJobAction.bind(null, ro.id, job.id)} label={t("jobDone")} variant="outline" icon={<Check />} />
                      )}
                      {(ro.status === "IN_PROGRESS" || ro.status === "QUALITY_CHECK") && job.status === "DONE" && (
                        <ActionButton action={reopenJobAction.bind(null, ro.id, job.id)} label={t("reopen")} variant="ghost" icon={<RotateCcw />} />
                      )}
                    </div>
                  )
                }
              >
                <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  {job.payerCustomer && <span>{t("insurer")}: {job.payerCustomer.displayName}</span>}
                  {job.technician && (
                    <span>
                      {t("technician")}: {job.technician.firstName} {job.technician.lastName}
                    </span>
                  )}
                  <span>
                    {t("billed")}: {hours(job.billedCentiHours)} · {t("clocked")}: {hours(job.clockedCentiHours)}
                  </span>
                  {job.estimateCents !== null && (
                    <span>
                      {t("estimate")}: {formatMoney(job.estimateCents)}
                    </span>
                  )}
                  {job.warrantyClaim && (
                    <span>
                      {t("claim")}: {job.warrantyClaim.number} · {t(`claimStatuses.${job.warrantyClaim.status}`)}
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]" data-testid={`job-${job.lineNo}-lines`}>
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-1.5 pr-3 font-medium">{t("lineType")}</th>
                        <th className="py-1.5 pr-3 font-medium">{t("description")}</th>
                        <th className="py-1.5 pr-3 text-right font-medium">{t("qtyOrTime")}</th>
                        <th className="py-1.5 pr-3 text-right font-medium">{t("unitPrice")}</th>
                        <th className="py-1.5 pr-3 text-right font-medium">{t("discount")}</th>
                        <th className="py-1.5 pr-3 text-right font-medium">{t("amount")}</th>
                        <th className="py-1.5 pr-3 text-right font-medium">{t("cost")}</th>
                        {editable && <th className="w-8" />}
                      </tr>
                    </thead>
                    <tbody>
                      {job.labourLines.map((l) => (
                        <tr key={l.id} className="border-b last:border-0" data-line="labour">
                          <td className="py-1.5 pr-3 text-muted-foreground">{t("labour")}</td>
                          <td className="py-1.5 pr-3">
                            {l.operation && <span className="mr-1.5 font-mono text-xs">{l.operation.code}</span>}
                            {l.label}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{hours(l.billedCentiHours)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.rateCents)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{l.discountBp ? formatBp(l.discountBp, 1) : "—"}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.amountCents)}</td>
                          <td className="py-1.5 pr-3 text-right text-muted-foreground">—</td>
                          {editable && (
                            <td className="py-1 text-right">
                              <ActionButton action={removeLabourLineAction.bind(null, ro.id, l.id)} label="" icon={<X />} variant="ghost" />
                            </td>
                          )}
                        </tr>
                      ))}
                      {job.partLines.map((l) => (
                        <tr key={l.id} className="border-b last:border-0" data-line="part" data-part={l.part.partNumber}>
                          <td className="py-1.5 pr-3 text-muted-foreground">{t("part")}</td>
                          <td className="py-1.5 pr-3">
                            <Link className="mr-1.5 font-mono text-xs text-primary hover:underline" href={`/parts/catalogue/${l.part.id}`}>
                              {l.part.partNumber}
                            </Link>
                            {l.part.description}
                            {l.requestedNumber && <div className="text-xs text-muted-foreground">{t("replaces", { number: l.requestedNumber })}</div>}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{qtyText(l.qty)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.unitPriceCents)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{l.discountBp ? formatBp(l.discountBp, 1) : "—"}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.amountCents)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{l.issued ? formatMoney(l.costCents) : <span className="text-xs text-muted-foreground">{t("notIssued")}</span>}</td>
                          {editable && (
                            <td className="py-1 text-right">
                              <ActionButton action={removePartLineAction.bind(null, ro.id, l.id)} label="" icon={<X />} variant="ghost" />
                            </td>
                          )}
                        </tr>
                      ))}
                      {job.subletLines.map((l) => (
                        <tr key={l.id} className="border-b last:border-0" data-line="sublet">
                          <td className="py-1.5 pr-3 text-muted-foreground">{t("sublet")}</td>
                          <td className="py-1.5 pr-3">
                            {l.label} <span className="text-xs text-muted-foreground">— {l.supplier.name}</span>
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">1</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.priceCents)}</td>
                          <td className="py-1.5 pr-3 text-right">—</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.priceCents)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.costCents)}</td>
                          {editable && (
                            <td className="py-1 text-right">
                              <ActionButton action={removeSubletLineAction.bind(null, ro.id, l.id)} label="" icon={<X />} variant="ghost" />
                            </td>
                          )}
                        </tr>
                      ))}
                      <tr className="font-medium">
                        <td colSpan={5} className="py-1.5 pr-3 text-right text-xs text-muted-foreground">
                          {t("jobTotal")}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums" data-testid={`job-${job.lineNo}-total`}>
                          {formatMoney(job.totalCents)}
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
                {editable && (
                  <div className="mt-4 space-y-3 border-t pt-4">
                    <div data-testid={`job-${job.lineNo}-add-labour`}>
                      <SpecForm
                        action={addLabourLineAction.bind(null, ro.id, job.id)}
                        submitLabel={t("addLabour")}
                        inline
                        fields={[
                          {
                            name: "operationCode",
                            label: t("operation", { rate: formatMoney(job.rateCents) }),
                            type: "select",
                            empty: t("freeText"),
                            options: d.operations.map((o) => ({ value: o.code, label: `${o.code} — ${o.label} (${hours(o.standardCentiHours)})` })),
                          },
                          { name: "label", label: t("labourLabel"), placeholder: t("optional") },
                          { name: "centiHours", label: t("hours"), placeholder: t("standard") },
                          { name: "discountBp", label: t("discountPct"), placeholder: "0" },
                        ]}
                      />
                    </div>
                    <div data-testid={`job-${job.lineNo}-add-part`}>
                      <SpecForm
                        action={addPartLineAction.bind(null, ro.id, job.id)}
                        submitLabel={t("addPart")}
                        inline
                        fields={[
                          { name: "partNumber", label: t("partNumber"), placeholder: "1609438180" },
                          { name: "qty", label: t("qty"), defaultValue: "1" },
                        ]}
                      />
                    </div>
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">{t("addSublet")}</summary>
                      <div className="mt-2">
                        <SpecForm
                          action={addSubletLineAction.bind(null, ro.id, job.id)}
                          submitLabel={t("addSublet")}
                          inline
                          fields={[
                            { name: "supplierId", label: t("supplier"), type: "select", options: d.suppliers, empty: "—" },
                            { name: "label", label: t("labourLabel") },
                            { name: "costCents", label: t("subletCost"), type: "money" },
                            { name: "priceCents", label: t("subletPrice"), type: "money" },
                            { name: "supplierReference", label: t("reference"), placeholder: t("optional") },
                          ]}
                        />
                      </div>
                    </details>
                  </div>
                )}
              </Section>
            );
          })}

          {d.canEdit && (workable || ro.status === "QUALITY_CHECK") && (
            <Section title={t("addJob")}>
              <div data-testid="add-job">
                <SpecForm
                  action={addJobAction.bind(null, ro.id)}
                  submitLabel={t("addJob")}
                  columns={3}
                  fields={[
                    { name: "description", label: t("description"), wide: true },
                    { name: "payer", label: t("payer"), type: "select", options: payers.map((p) => ({ value: p, label: t(`payers.${p}`) })), defaultValue: payers[0] },
                    { name: "payerCustomerId", label: t("insurer"), type: "select", options: d.insurers, empty: "—", hint: t("insurerHint") },
                    { name: "technicianId", label: t("technician"), type: "select", options: d.technicians, empty: "—" },
                    ...(ro.kind === "CUSTOMER"
                      ? [{ name: "isAdditional", label: t("approval"), type: "checkboxes" as const, options: [{ value: "on", label: t("isAdditional") }], defaultValues: ro.status === "CHECKED_IN" ? [] : ["on"] }]
                      : []),
                  ]}
                />
              </div>
            </Section>
          )}

          {ro.status === "QUALITY_CHECK" && d.canValidate && (
            <Section title={t("qualityCheck")}>
              <div data-testid="qc-form">
                <SpecForm
                  action={qualityCheckAction.bind(null, ro.id)}
                  submitLabel={t("recordQc")}
                  inline
                  fields={[
                    { name: "result", label: t("qcResult"), type: "select", options: [{ value: "pass", label: t("qcPass") }, { value: "fail", label: t("qcFail") }], defaultValue: "pass" },
                    { name: "notes", label: t("notes"), placeholder: t("optional") },
                  ]}
                />
              </div>
            </Section>
          )}

          {ro.status === "READY" && d.canValidate && (
            <Section title={t("invoiceRo")}>
              <p className="mb-3 text-xs text-muted-foreground">{t("invoiceRoHint")}</p>
              <div data-testid="invoice-form">
                <SpecForm
                  action={invoiceRepairOrderAction.bind(null, ro.id)}
                  submitLabel={t("issueInvoices")}
                  inline
                  fields={
                    ro.kind === "CUSTOMER"
                      ? [{ name: "paymentMethod", label: t("payment"), type: "select", options: payOptions, defaultValue: individual ? "CARD" : "ACCOUNT", testId: "ro-pay" }]
                      : []
                  }
                />
              </div>
            </Section>
          )}

          {(ro.status === "INVOICED" || ro.status === "CLOSED") && d.customerDueCents > 0 && d.canValidate && (
            <Section title={t("takePayment")}>
              <p className="mb-3 text-xs text-muted-foreground">{t("dueNow", { amount: formatMoney(d.customerDueCents) })}</p>
              <div data-testid="payment-form">
                <SpecForm
                  action={recordRoPaymentAction.bind(null, ro.id)}
                  submitLabel={t("recordPayment")}
                  inline
                  fields={[{ name: "method", label: t("payment"), type: "select", options: CASH_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) })), defaultValue: "CARD" }]}
                />
              </div>
            </Section>
          )}

          <Section title={t("clockings")}>
            {ro.clockings.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{t("noClockings")}</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">{t("date")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("technician")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("job")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("from")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("to")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ro.clockings.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 tabular-nums">{formatDate(c.businessDate)}</td>
                      <td className="py-1.5 pr-3">
                        {c.technician.firstName} {c.technician.lastName}
                      </td>
                      <td className="py-1.5 pr-3">{d.jobs.find((j) => j.id === c.jobId)?.lineNo}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{clock(c.startMinute)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{c.endMinute === null ? <StatusBadge status="IN_PROGRESS" label={t("onJob")} /> : clock(c.endMinute)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{hours(c.centiHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {d.canClock && workable && (
              <p className="mt-3 text-xs text-muted-foreground">
                <Link className="text-primary hover:underline" href={`/workshop/clocking?site=${ro.siteId}`}>
                  {t("goClocking")}
                </Link>
              </p>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title={t("repairOrder")}>
            <Fields
              items={[
                { label: t("customer"), value: ro.customer ? <Link className="text-primary hover:underline" href={`/customers/${ro.customer.id}`}>{ro.customer.displayName}</Link> : t("internalCustomer") },
                { label: t("vehicle"), value: <Link className="text-primary hover:underline" href={`/vehicles/${ro.vehicle.id}`}>{vehicleName(ro.vehicle)}</Link> },
                { label: t("openedOn"), value: formatDate(ro.openedOn) },
                { label: t("promisedOn"), value: ro.promisedOn ? formatDate(ro.promisedOn) : null },
                { label: t("appointment"), value: ro.appointment ? `${ro.appointment.number} · ${formatDate(ro.appointment.date)}` : null },
                { label: t("advisor"), value: ro.advisor ? `${ro.advisor.firstName} ${ro.advisor.lastName}` : null },
                { label: t("rates"), value: `${formatMoney(d.rates.customerCents)} / ${formatMoney(d.rates.warrantyCents)} / ${formatMoney(d.rates.internalCents)}` },
                { label: t("totalExcl"), value: <span className="font-semibold" data-testid="ro-total">{formatMoney(ro.totalExclVatCents)}</span> },
                { label: t("cost"), value: ro.invoicedOn ? formatMoney(ro.costCents) : null },
                { label: t("qc"), value: ro.qcOn ? `${formatDate(ro.qcOn)}${ro.qcNotes ? ` — ${ro.qcNotes}` : ""}` : null },
                { label: t("invoicedOn"), value: ro.invoicedOn ? formatDate(ro.invoicedOn) : null },
                { label: t("closedOn"), value: ro.closedOn ? formatDate(ro.closedOn) : null },
              ]}
            />
          </Section>
          <Section title={t("checkInRecord")}>
            <Fields
              items={[
                { label: t("mileageIn"), value: `${ro.mileageIn.toLocaleString("en-GB")} km` },
                { label: t("fuelLevel"), value: `${ro.fuelLevelPct} %` },
                { label: t("damages"), value: damages.length ? damages.map((x) => `${x.zone}${x.note ? `: ${x.note}` : ""}`).join(" · ") : t("noDamage") },
                { label: t("signedBy"), value: ro.signedBy },
              ]}
            />
            {ro.signatureDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ro.signatureDataUrl} alt={t("signature")} className="mt-2 h-16 rounded border bg-white" />
            )}
          </Section>
          {(d.invoices.length > 0 || d.entries.length > 0 || ro.warrantyClaims.length > 0) && (
            <Section title={t("accounting")}>
              <ul className="space-y-1.5 text-[13px]" data-testid="ro-documents">
                {d.invoices.map((i) => (
                  <li key={i.id}>
                    <Link className="text-primary hover:underline" href={`/accounting/invoices/${i.id}`} data-testid="ro-invoice">
                      {i.number}
                    </Link>{" "}
                    · {i.customer.displayName} · {formatMoney(i.totalInclVatCents)}{" "}
                    <StatusBadge status={i.status} label={t(`invoiceStatuses.${i.status}`)} />
                  </li>
                ))}
                {ro.warrantyClaims.map((c) => (
                  <li key={c.id}>
                    <Link className="text-primary hover:underline" href={`/workshop/warranty?q=${c.number}`}>
                      {c.number}
                    </Link>{" "}
                    · {formatMoney(c.claimedCents)} <StatusBadge status={c.status} label={t(`claimStatuses.${c.status}`)} />
                  </li>
                ))}
                {d.entries.map((e) => (
                  <li key={e.id} className="text-xs text-muted-foreground">
                    <EntryLink id={e.id} number={e.number} /> — {e.label}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
