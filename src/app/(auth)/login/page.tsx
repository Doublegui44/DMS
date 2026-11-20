import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth, DEMO_MODE } from "@/auth";
import { db } from "@/lib/db";
import { ROLE_KEYS, ROLE_LABELS, type RoleKey } from "@/modules/admin";
import { LoginForm, DemoUserButton } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await auth();
  // A session whose user is gone (database reseeded) or deactivated must not bounce back to the
  // app, which would send it here again: show the form so the user signs in afresh.
  const current = session?.user?.id ? await db.user.findFirst({ where: { id: session.user.id, active: true }, select: { id: true } }) : null;
  if (current) redirect("/dashboard");
  const t = await getTranslations("login");
  const tApp = await getTranslations("app");

  const users = DEMO_MODE
    ? await db.user.findMany({
        where: { active: true },
        select: {
          email: true,
          firstName: true,
          lastName: true,
          roles: { select: { role: { select: { key: true } }, site: { select: { code: true } } } },
        },
      })
    : [];
  const byRole = new Map<RoleKey, typeof users>();
  for (const u of users) {
    const key = (u.roles[0]?.role.key ?? "ADMIN") as RoleKey;
    byRole.set(key, [...(byRole.get(key) ?? []), u]);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/40 p-4">
      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-6">
            <div className="mb-3 grid size-8 place-items-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
              DMS
            </div>
            <h1 className="text-lg font-semibold">{tApp("name")}</h1>
            <p className="text-sm text-muted-foreground">{tApp("tagline")}</p>
          </div>
          <LoginForm />
        </div>

        {DEMO_MODE && (
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="text-sm font-semibold">{t("demoUsers")}</h2>
            <p className="mb-4 text-xs text-muted-foreground">{t("demoHint")}</p>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {ROLE_KEYS.filter((k) => byRole.has(k)).map((key) => (
                <div key={key}>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {ROLE_LABELS[key]}
                  </div>
                  <ul className="space-y-0.5">
                    {byRole.get(key)!.map((u) => (
                      <li key={u.email}>
                        <DemoUserButton
                          email={u.email}
                          label={`${u.firstName} ${u.lastName}`}
                          sub={u.roles[0]?.site?.code ?? "All sites"}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
