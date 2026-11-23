"use server";

import { revalidatePath } from "next/cache";
import { longCommand } from "@/lib/session";
import { DEFAULT_RATES, runSimulation } from "@/modules/simulation";
import type { FormState } from "@/components/shared/form";

/** Run the simulation for the days and rates in the form, as the signed-in user. */
export async function runSimulationAction(_: FormState, fd: FormData): Promise<FormState> {
  const rates: Record<string, string> = {};
  for (const key of Object.keys(DEFAULT_RATES)) {
    const v = fd.get(key);
    if (typeof v === "string" && v.trim() !== "") rates[key] = v.trim();
  }
  const result = await longCommand((actor) => runSimulation(actor, { days: fd.get("days"), site: (fd.get("site") as string) || null, rates }));
  if (!result.ok) return result;
  revalidatePath("/", "layout"); // the business date in the top bar moved
  return { ok: true, data: { id: result.data.to } };
}
