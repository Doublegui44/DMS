"use server";

import { revalidatePath } from "next/cache";
import { command } from "@/lib/session";
import { formDataToObject, parseInput } from "@/lib/validation";
import { changeVehicleStatus, createVehicle, updateVehicle, vehicleStatusChangeSchema, type VehicleInput, type VehicleStatus } from "@/modules/core";
import type { FormState } from "@/components/shared/form";

export async function saveVehicleAction(id: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const input = formDataToObject(fd) as unknown as VehicleInput;
  const res = await command((ctx) => (id ? updateVehicle(ctx, id, input) : createVehicle(ctx, input)));
  if (!res.ok) return res;
  revalidatePath("/vehicles");
  return { ok: true, data: { id: res.data.id, redirectTo: `/vehicles/${res.data.id}` } };
}

export async function changeVehicleStatusAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command(async (ctx) => {
    const { status, reason } = parseInput(vehicleStatusChangeSchema, formDataToObject(fd));
    return changeVehicleStatus(ctx, id, status as VehicleStatus, reason ?? null);
  });
  if (!res.ok) return res;
  revalidatePath(`/vehicles/${id}`);
  return { ok: true, data: { id } };
}
