import type { ServiceContext } from "@/lib/context";
import { DEFAULT_RATES } from "../domain/config";
import type { SimulationReport } from "../services/runner";

export type SimulationRunRow = SimulationReport & { id: string; at: Date; skippedCount: number };

/** The simulation screen: the clock, the sites, the default rates and the latest runs (newest first). */
export async function getSimulationStatus(ctx: ServiceContext, take = 10) {
  ctx.require("admin.simulation", "view");
  const [sites, rows] = await Promise.all([
    ctx.tx.site.findMany({ select: { id: true, code: true, slug: true, name: true }, orderBy: { code: "asc" } }),
    ctx.tx.domainEvent.findMany({ where: { type: "SimulationRun" }, orderBy: { createdAt: "desc" }, take }),
  ]);
  const runs = rows.map((r) => ({ ...(r.payload as unknown as Omit<SimulationRunRow, "id" | "at">), id: r.id, at: r.createdAt }));
  return { businessDate: ctx.businessDate, sites, defaults: DEFAULT_RATES, runs };
}
