"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, ChevronDown, LogOut, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logout, setActiveSite, switchUser } from "@/app/(app)/shell-actions";
import { LanguageSwitcher } from "./language-switcher";

export interface TopbarProps {
  userName: string;
  roleLabels: string[];
  sites: { id: string; code: string; name: string }[];
  activeSiteId: string | null;
  businessDate: string; // formatted
  demoUsers: { email: string; name: string; role: string; site: string }[] | null;
}

export function Topbar({ userName, roleLabels, sites, activeSiteId, businessDate, demoUsers }: TopbarProps) {
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const activeSite = sites.find((s) => s.id === activeSiteId);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4">
      <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {t("site")}
        <select
          aria-label={t("site")}
          className="h-7 min-w-0 max-w-56 truncate rounded-md border bg-background px-2 text-[13px] text-foreground"
          value={activeSiteId ?? ""}
          disabled={pending || sites.length < 2}
          onChange={(e) => startTransition(() => setActiveSite(e.target.value))}
        >
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
      </label>

      <div
        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        title={t("businessDate")}
        data-testid="business-date"
      >
        <CalendarClock className="size-3.5" />
        <span className="font-medium tabular-nums">{businessDate}</span>
      </div>

      <div className="flex-1" />

      <LanguageSwitcher />

      {demoUsers && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="role-switcher">
              <Repeat /> {t("switchUser")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-y-auto">
            {demoUsers.map((u) => (
              <DropdownMenuItem
                key={u.email}
                onSelect={() => startTransition(() => switchUser(u.email))}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{u.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {u.role} · {u.site}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" data-testid="user-menu">
            <span className="font-medium">{userName}</span>
            <span className="hidden text-xs text-muted-foreground lg:inline">{roleLabels.join(", ")}</span>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="text-sm">{userName}</div>
            <div className="text-xs font-normal text-muted-foreground">{roleLabels.join(", ")}</div>
            {activeSite && <div className="text-xs font-normal text-muted-foreground">{activeSite.name}</div>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => startTransition(() => logout())}>
            <LogOut /> {t("signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
