"use client";

import { useActionState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { demoLoginAction, loginAction } from "./actions";

export function LoginForm() {
  const t = useTranslations("login");
  const [error, formAction, pending] = useActionState(loginAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">{t("password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {t("invalid")}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}

export function DemoUserButton({ email, label, sub }: { email: string; label: string; sub: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => demoLoginAction(email))}
      className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[13px] hover:bg-muted disabled:opacity-50"
      data-email={email}
    >
      <span>{label}</span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </button>
  );
}
