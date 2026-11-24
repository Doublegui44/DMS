"use server";

import { revalidatePath } from "next/cache";
import { runQuery } from "@/lib/context";
import { command, longCommand } from "@/lib/session";
import { DEFAULT_RATES, getSimulationJob, startSimulationJob, stopSimulationJob } from "@/modules/simulation";
import type { FormState } from "@/components/shared/form";

/** Start a simulation run in the background with the days and rates in the form (D-079). */
export async function runSimulationAction(_: FormState, fd: FormData): Promise<FormState> {
  const rates: Record<string, string> = {};
  for (const key of Object.keys(DEFAULT_RATES)) {
    const v = fd.get(key);
    if (typeof v === "string" && v.trim() !== "") rates[key] = v.trim();
  }
  const result = await longCommand((actor) => startSimulationJob(actor, { days: fd.get("days"), site: (fd.get("site") as string) || null, rates }));
  if (!result.ok) return result;
  return { ok: true, data: { id: result.data.id } };
}

/** Progress of the run, polled by the screen; refreshes the layout (business date) once it ends. */
export async function simulationProgressAction() {
  const result = await longCommand((actor) => runQuery({ actor, siteId: null }, (ctx) => getSimulationJob(ctx)));
  if (result.ok && result.data && result.data.status !== "running" && result.data.status !== "stopping") revalidatePath("/", "layout");
  return result;
}

export async function stopSimulationAction() {
  return command((ctx) => stopSimulationJob(ctx));
}
