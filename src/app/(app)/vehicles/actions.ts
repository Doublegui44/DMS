"use server";

import { revalidatePath } from "next/cache";
import { command } from "@/lib/session";
import { formDataToObject } from "@/lib/validation";
import { createVehicle, updateVehicle, type VehicleInput } from "@/modules/core";
import type { FormState } from "@/components/shared/form";

// No manual status change: a car's status follows its sales flow (D-048).
export async function saveVehicleAction(id: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const input = formDataToObject(fd) as unknown as VehicleInput;
  const res = await command((ctx) => (id ? updateVehicle(ctx, id, input) : createVehicle(ctx, input)));
  if (!res.ok) return res;
  revalidatePath("/vehicles");
  return { ok: true, data: { id: res.data.id, redirectTo: `/vehicles/${res.data.id}` } };
}
