import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { KanbanSquare, List, Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatMoney } from "@/lib/money";
import { formatDate, isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { getPipeline, listLeads, type PipelineCard } from "@/modules/sales";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { inputClass } from "@/components/shared/form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = { title: "Sales pipeline" };

function Card({ c, t }: { c: PipelineCard; t: Awaited<ReturnType<typeof getTranslations>> }) {
  const doc = c.order ?? c.quote;
  return (
    <Link
      href={c.order ? `/sales/orders/${c.order.id}` : `/sales/leads/${c.leadId}`}
      className="block rounded-md border bg-background p-2.5 text-[13px] shadow-xs transition-colors hover:border-primary/40"
      data-testid="pipeline-card"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium leading-snug">{c.customer.name}</span>
        <StatusBadge status={c.interest} />
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.vehicle ?? t(`sources.${c.source}`)}</div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{c.salesperson ?? "—"}</span>
        {doc && <span className="font-medium tabular-nums">{formatMoney(doc.totalInclVatCents, { decimals: false })}</span>}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono">{c.order?.number ?? c.quote?.number ?? c.leadNumber}</span>
        {c.quote && !c.order && c.quote.status !== "ACCEPTED" ? <StatusBadge status={c.quote.status} label={t(`quoteStatuses.${c.quote.status}`)} /> : <span>{formatDate(c.openedOn)}</span>}
      </div>
    </Link>
  );
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("sales");
  const { actor, sites, siteId } = await getRequestContext();
  const view = sp.view === "list" ? "list" : "board";
  const site = typeof sp.site === "string" ? sp.site : (siteId ?? "");
  const mine = sp.mine === "1";
  const q = typeof sp.q === "string" ? sp.q : "";
  const canCreate = can(actor.permissions, "sales.lead", "create");
  const toggle = (v: "board" | "list") => {
    const params = new URLSearchParams();
    if (v === "list") params.set("view", "list");
    if (site) params.set("site", site);
    if (mine) params.set("mine", "1");
    return `/sales/pipeline${params.size ? `?${params}` : ""}`;
  };

  const header = (
    <PageHeader
      title={t("pipeline")}
      subtitle={t("pipelineHint")}
      actions={
        <>
          <div className="flex rounded-md border p-0.5">
            <Link href={toggle("board")} className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs", view === "board" && "bg-muted font-medium")}>
              <KanbanSquare className="size-3.5" /> {t("board")}
            </Link>
            <Link href={toggle("list")} className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs", view === "list" && "bg-muted font-medium")}>
              <List className="size-3.5" /> {t("list")}
            </Link>
          </div>
          {canCreate && (
            <Button asChild size="sm">
              <Link href="/sales/leads/new">
                <Plus /> {t("newLead")}
              </Link>
            </Button>
          )}
        </>
      }
    />
  );

  if (view === "list") {
    const p = parseListParams(sp, { sort: "updatedAt", dir: "desc" });
    const data = await query((ctx) => listLeads(ctx, p), { resource: "sales.lead", action: "view" });
    const rows: Row[] = data.rows.map((l) => ({
      id: l.leadId,
      number: { kind: "link", href: `/sales/leads/${l.leadId}`, label: l.leadNumber },
      customer: { kind: "link", href: `/customers/${l.customer.id}`, label: l.customer.name },
      interest: { kind: "badge", status: l.interest, label: l.interest },
      source: t(`sources.${l.source}`),
      vehicle: l.vehicle,
      stage: { kind: "badge", status: l.stage, label: t(`stages.${l.stage}`) },
      amount: { kind: "money", cents: l.order?.totalInclVatCents ?? l.quote?.totalInclVatCents ?? null },
      salesperson: l.salesperson,
      openedOn: { kind: "date", iso: isoDate(l.openedOn) },
      site: l.site,
    }));
    return (
      <div>
        {header}
        <DataTable
          rows={rows}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          exportHref="/api/export/leads"
          columns={[
            { key: "number", header: t("lead"), sortable: true },
            { key: "customer", header: t("customer") },
            { key: "interest", header: t("interest") },
            { key: "source", header: t("source") },
            { key: "vehicle", header: t("vehicle") },
            { key: "stage", header: t("stage"), sortable: true },
            { key: "amount", header: t("amount"), align: "right" },
            { key: "salesperson", header: t("salesperson") },
            { key: "openedOn", header: t("openedOn"), sortable: true },
            { key: "site", header: t("site") },
          ]}
          filters={[
            { key: "stage", label: t("stage"), options: ["NEW", "CONTACTED", "QUOTED", "WON", "LOST"].map((s) => ({ value: s, label: t(`leadStages.${s}`) })) },
            { key: "interest", label: t("interest"), options: ["VN", "VO"].map((s) => ({ value: s, label: s })) },
            { key: "source", label: t("source"), options: ["WALK_IN", "PHONE", "WEB", "REFERRAL", "RETURNING", "EVENT"].map((s) => ({ value: s, label: t(`sources.${s}`) })) },
            { key: "mine", label: t("mine"), options: [{ value: "1", label: t("myLeads") }] },
            { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
          ]}
        />
      </div>
    );
  }

  const columns = await query((ctx) => getPipeline(ctx, { siteId: site || null, mine, q }), { resource: "sales.lead", action: "view" });
  return (
    <div>
      {header}
      <form method="get" className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <select name="site" defaultValue={site} className={cn(inputClass, "w-48")} aria-label={t("site")}>
          <option value="">{t("allSites")}</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={q} placeholder={t("searchPipeline")} className={cn(inputClass, "w-56")} />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} className="size-3.5" /> {t("myLeads")}
        </label>
        <Button type="submit" size="sm" variant="outline">
          {t("filter")}
        </Button>
      </form>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => (
          <section key={col.stage} className="flex w-64 shrink-0 flex-col rounded-lg border bg-muted/40" data-stage={col.stage}>
            <header className="flex items-baseline justify-between gap-2 border-b px-3 py-2">
              <h2 className="text-[13px] font-semibold">
                {t(`stages.${col.stage}`)} <span className="font-normal text-muted-foreground">{col.count}</span>
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">{col.amountCents ? formatMoney(col.amountCents, { decimals: false }) : ""}</span>
            </header>
            <div className="flex max-h-[calc(100vh-15rem)] flex-col gap-2 overflow-y-auto p-2">
              {col.cards.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">{t("emptyStage")}</p>}
              {col.cards.map((c) => (
                <Card key={c.leadId} c={c} t={t} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
