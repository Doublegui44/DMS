"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEMO_MODE, signIn, signOut } from "@/auth";
import { getRequestContext, SITE_COOKIE } from "@/lib/session";

export async function setActiveSite(siteId: string) {
  const { sites } = await getRequestContext();
  if (!sites.some((s) => s.id === siteId)) return;
  (await cookies()).set(SITE_COOKIE, siteId, { path: "/", sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}

/** Demo role switcher: sign in as another user without a password (DEMO_MODE only). */
export async function switchUser(email: string) {
  if (!DEMO_MODE) throw new Error("Role switcher is only available in demo mode");
  (await cookies()).delete(SITE_COOKIE);
  await signIn("demo", { email, redirectTo: "/dashboard" });
}

export async function logout() {
  (await cookies()).delete(SITE_COOKIE);
  await signOut({ redirectTo: "/login" });
  redirect("/login");
}
