import type { ServiceContext } from "@/lib/context";
import { addDays, toDateOnly } from "@/lib/dates";

declare module "@/lib/events" {
  interface DomainEventMap {
    BusinessDayAdvanced: { from: string; to: string };
  }
}

/** Set the business clock (seed / reset only). */
export async function setBusinessDate(ctx: ServiceContext, date: Date): Promise<void> {
  ctx.require("admin.simulation", "edit");
  const d = toDateOnly(date);
  await ctx.tx.businessClock.upsert({ where: { id: 1 }, create: { id: 1, currentDate: d }, update: { currentDate: d } });
  await ctx.audit({ action: "clock.set", entityType: "BusinessClock", entityId: "1", after: { currentDate: d } });
}

/**
 * Move the business date forward by one day and publish BusinessDayAdvanced so that
 * modules run their end-of-day jobs (reservation expiry, ageing, overdue…) in later phases.
 */
export async function advanceBusinessDay(ctx: ServiceContext): Promise<Date> {
  ctx.require("admin.simulation", "edit");
  const from = ctx.businessDate;
  const to = addDays(from, 1);
  await ctx.tx.businessClock.upsert({ where: { id: 1 }, create: { id: 1, currentDate: to }, update: { currentDate: to } });
  await ctx.emit({
    type: "BusinessDayAdvanced",
    aggregateType: "BusinessClock",
    aggregateId: "1",
    payload: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
  });
  return to;
}
