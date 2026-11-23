import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
// Registers every module's domain-event handlers before any command runs (D-031).
import "@/modules/register";
import { db } from "./db";
import { loadActor } from "./actor";
import { runCommand, runQuery, type Actor, type CommandOptions, type ServiceContext } from "./context";
import { ForbiddenError, toActionError, type ActionResult } from "./errors";

export const SITE_COOKIE = "dms_site";

export interface RequestContext {
  actor: Actor;
  siteId: string | null;
  sites: { id: string; code: string; name: string }[];
}

/** Current user + active site, or redirect to /login. Cached per request. */
export const getRequestContext = cache(async (): Promise<RequestContext> => {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const actor = await loadActor(session.user.id);
  if (!actor) redirect("/login");
  const sites = await db.site.findMany({
    where: actor.siteIds === "ALL" ? {} : { id: { in: actor.siteIds } },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });
  const cookieSite = (await cookies()).get(SITE_COOKIE)?.value;
  const siteId = sites.find((s) => s.id === cookieSite)?.id ?? sites[0]?.id ?? null;
  return { actor, siteId, sites };
});

/** Run a read query as the current user. */
export async function query<T>(fn: (ctx: ServiceContext) => Promise<T>, permission?: CommandOptions["permission"]) {
  const { actor, siteId } = await getRequestContext();
  try {
    return await runQuery({ actor, siteId, permission }, fn);
  } catch (err) {
    if (err instanceof ForbiddenError) redirect("/forbidden");
    throw err;
  }
}

/** Run a command as the current user and convert errors into an ActionResult. */
export async function command<T>(
  fn: (ctx: ServiceContext) => Promise<T>,
  permission?: CommandOptions["permission"],
): Promise<ActionResult<T>> {
  try {
    const { actor, siteId } = await getRequestContext();
    const data = await runCommand({ actor, siteId, permission }, fn);
    return { ok: true, data };
  } catch (err) {
    // Let Next.js redirects/notFound propagate.
    if (err && typeof err === "object" && "digest" in err) throw err;
    return toActionError(err);
  }
}

/**
 * Run, as the current user, a service that opens its own transactions (the simulation runner,
 * one transaction per business step) and convert errors into an ActionResult.
 */
export async function longCommand<T>(fn: (actor: Actor) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const { actor } = await getRequestContext();
    return { ok: true, data: await fn(actor) };
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    return toActionError(err);
  }
}
