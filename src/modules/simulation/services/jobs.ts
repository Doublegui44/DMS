import { runQuery, type Actor, type ServiceContext } from "@/lib/context";
import { isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { simulationInputSchema, type SimulationInput } from "../domain/config";
import { runSimulation, type SimulationReport } from "./runner";

/**
 * A simulation run started from the screen, running in the background of the server process
 * (D-079). Kept in memory: one run at a time per process, and a restart forgets it (the days
 * already run stay in the database, and every finished run leaves its SimulationRun event).
 */
export interface SimulationJob {
  id: string;
  startedBy: string | null;
  from: string;
  days: number;
  site: string | null;
  /** Business date reached and days done so far. */
  current: string;
  daysDone: number;
  steps: number;
  status: "running" | "stopping" | "done" | "failed";
  report: SimulationReport | null;
  error: string | null;
}

// On globalThis so the dev server's module reloads do not lose a running job.
const store = globalThis as unknown as { __dmsSimulationJob?: SimulationJob & { stop: boolean } };

const view = (j: (SimulationJob & { stop: boolean }) | undefined): SimulationJob | null =>
  j ? { id: j.id, startedBy: j.startedBy, from: j.from, days: j.days, site: j.site, current: j.current, daysDone: j.daysDone, steps: j.steps, status: j.status, report: j.report, error: j.error } : null;

/**
 * Check the request (rights, days, site) at once so the form can show errors, then run the
 * simulation without waiting for it. Refused while another run is going.
 */
export async function startSimulationJob(starter: Actor, input: SimulationInput | Record<string, unknown>): Promise<SimulationJob> {
  const data = parseInput(simulationInputSchema, input);
  const from = await runQuery({ actor: starter, siteId: null, permission: { resource: "admin.simulation", action: "edit" } }, async (ctx) => ctx.businessDate);
  if (data.site && !(await db.site.findFirst({ where: { OR: [{ id: data.site }, { slug: data.site }, { code: data.site.toUpperCase() }] }, select: { id: true } }))) {
    throw new ValidationError("Unknown site", { site: ["Unknown site"] });
  }
  const running = store.__dmsSimulationJob;
  if (running && (running.status === "running" || running.status === "stopping")) throw new ConflictError(`A simulation is already running (${running.daysDone}/${running.days} days)`);

  const job: SimulationJob & { stop: boolean } = {
    id: `${Date.now()}`,
    startedBy: starter.userId,
    from: isoDate(from),
    days: data.days,
    site: data.site || null,
    current: isoDate(from),
    daysDone: 0,
    steps: 0,
    status: "running",
    report: null,
    error: null,
    stop: false,
  };
  store.__dmsSimulationJob = job;
  void runSimulation(starter, data, {
    shouldStop: () => job.stop,
    onDay: (day, counts) => {
      job.current = isoDate(day);
      job.daysDone = counts.day ?? 0;
      job.steps = Object.entries(counts).reduce((t, [k, n]) => (k === "day" ? t : t + n), 0);
    },
  }).then(
    (report) => {
      job.report = report;
      job.error = report.error;
      job.status = report.error ? "failed" : "done";
    },
    (e: unknown) => {
      job.error = e instanceof Error ? e.message : String(e);
      job.status = "failed";
    },
  );
  return view(job)!;
}

/** Ask the running simulation to stop after the day it is on. */
export async function stopSimulationJob(ctx: ServiceContext): Promise<SimulationJob | null> {
  ctx.require("admin.simulation", "edit");
  const job = store.__dmsSimulationJob;
  if (!job || job.status !== "running") throw new ConflictError("No simulation is running");
  job.stop = true;
  job.status = "stopping";
  return view(job);
}

/** The current or last run started from the screen in this server process, if any. */
export async function getSimulationJob(ctx: ServiceContext): Promise<SimulationJob | null> {
  ctx.require("admin.simulation", "view");
  return view(store.__dmsSimulationJob);
}
