"use server";

import { AuthError } from "next-auth";
import { DEMO_MODE, signIn } from "@/auth";

export async function loginAction(_prev: string | null, fd: FormData): Promise<string | null> {
  try {
    await signIn("credentials", {
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
      redirectTo: "/dashboard",
    });
    return null;
  } catch (err) {
    if (err instanceof AuthError) return "invalid";
    throw err; // redirect
  }
}

export async function demoLoginAction(email: string) {
  if (!DEMO_MODE) throw new Error("Demo login disabled");
  await signIn("demo", { email, redirectTo: "/dashboard" });
}
