"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/errors";

export type FormState = ActionResult<{ id?: string; redirectTo?: string }> | null;

/** Form wired to a server action returning ActionResult; shows field errors and redirects on success. */
export function ActionForm({
  action,
  children,
  submitLabel,
  className,
  successMessage,
  cancelHref,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  children: (errors: Record<string, string[] | undefined>) => React.ReactNode;
  submitLabel: string;
  className?: string;
  successMessage?: string;
  cancelHref?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (successMessage) toast.success(successMessage);
      if (state.data.redirectTo) router.push(state.data.redirectTo);
      else router.refresh();
    } else {
      toast.error(state.error.message);
    }
  }, [state, router, successMessage]);

  const errors = state && !state.ok ? state.error.fieldErrors ?? {} : {};

  return (
    <form action={formAction} className={cn("space-y-4", className)} noValidate>
      {children(errors)}
      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={pending} data-testid="form-submit">
          {pending ? "…" : submitLabel}
        </Button>
        {cancelHref && (
          <Button type="button" variant="ghost" onClick={() => router.push(cancelHref)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function Field({
  label,
  name,
  error,
  children,
  className,
}: {
  label: string;
  name: string;
  error?: string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={name} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {error?.length ? <p className="text-xs text-destructive">{error[0]}</p> : null}
    </div>
  );
}

export const inputClass =
  "h-8 w-full rounded-md border bg-background px-2.5 text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function NativeSelect({
  name,
  defaultValue,
  options,
  placeholder,
  invalid,
  className,
  ...rest
}: {
  name: string;
  defaultValue?: string | null;
  options: { value: string; label: string }[];
  placeholder?: string;
  invalid?: boolean;
} & Omit<React.ComponentProps<"select">, "defaultValue">) {
  return (
    <select
      id={name}
      name={name}
      // Controlled when the caller passes `value`; React rejects both props at once.
      {...(rest.value === undefined ? { defaultValue: defaultValue ?? "" } : {})}
      aria-invalid={invalid || undefined}
      className={cn(inputClass, className)}
      {...rest}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextInput({ name, invalid, className, ...rest }: { name: string; invalid?: boolean } & React.ComponentProps<"input">) {
  return <input id={name} name={name} aria-invalid={invalid || undefined} className={cn(inputClass, className)} {...rest} />;
}
