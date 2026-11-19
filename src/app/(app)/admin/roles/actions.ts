"use server";

import { revalidatePath } from "next/cache";
import { command } from "@/lib/session";
import { ACTIONS, type Action } from "@/lib/rbac";
import { setRolePermission } from "@/modules/admin";

export async function togglePermissionAction(roleId: string, resource: string, action: string, granted: boolean) {
  if (!(ACTIONS as readonly string[]).includes(action)) return { ok: false as const, error: { code: "validation", message: "Unknown action" } };
  const res = await command((ctx) => setRolePermission(ctx, { roleId, resource, action: action as Action, granted }));
  revalidatePath("/admin/roles");
  return res;
}
