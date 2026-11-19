"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { FormState } from "./form";

/** Button calling a bound server action (no form fields), with optional confirmation. */
export function ActionButton({
  action,
  label,
  confirm,
  successMessage,
  variant = "default",
  size = "sm",
  icon,
}: {
  action: () => Promise<FormState>;
  label: string;
  confirm?: string;
  successMessage?: string;
  variant?: "default" | "outline" | "destructive" | "ghost" | "secondary";
  size?: "sm" | "default";
  icon?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size={size}
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const res = await action();
          if (!res) return;
          if (res.ok) {
            if (successMessage) toast.success(successMessage);
            if (res.data.redirectTo) router.push(res.data.redirectTo);
            else router.refresh();
          } else toast.error(res.error.message);
        });
      }}
    >
      {icon}
      {pending ? "…" : label}
    </Button>
  );
}
