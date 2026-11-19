"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ACTIONS } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { togglePermissionAction } from "./actions";

export function PermissionMatrix({
  roles,
  selectedRoleId,
  granted,
  modules,
  canEdit,
}: {
  roles: { id: string; key: string; name: string; userCount: number }[];
  selectedRoleId: string;
  granted: string[];
  modules: { module: string; resources: string[] }[];
  canEdit: boolean;
}) {
  const [, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(new Set(granted), (state, change: { key: string; on: boolean }) => {
    const next = new Set(state);
    if (change.on) next.add(change.key);
    else next.delete(change.key);
    return next;
  });

  const toggle = (resource: string, action: string) => {
    const key = `${resource}:${action}`;
    const on = !optimistic.has(key);
    start(async () => {
      setOptimistic({ key, on });
      const res = await togglePermissionAction(selectedRoleId, resource, action, on);
      if (!res.ok) toast.error(res.error.message);
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <nav className="rounded-lg border bg-card p-1.5" aria-label="Roles">
        {roles.map((r) => (
          <Link
            key={r.id}
            href={`/admin/roles?role=${r.key}`}
            className={cn(
              "flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px]",
              r.id === selectedRoleId ? "bg-muted font-medium" : "hover:bg-muted/60",
            )}
          >
            {r.name}
            <span className="text-xs text-muted-foreground">{r.userCount}</span>
          </Link>
        ))}
      </nav>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-[13px]" data-testid="permission-matrix">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Resource</th>
              {ACTIONS.map((a) => (
                <th key={a} className="px-3 py-2 text-center font-medium capitalize">
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <MatrixModule key={m.module} module={m.module} resources={m.resources} granted={optimistic} onToggle={toggle} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatrixModule({
  module,
  resources,
  granted,
  onToggle,
  canEdit,
}: {
  module: string;
  resources: string[];
  granted: Set<string>;
  onToggle: (resource: string, action: string) => void;
  canEdit: boolean;
}) {
  return (
    <>
      <tr className="border-t bg-muted/20">
        <td colSpan={ACTIONS.length + 1} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {module}
        </td>
      </tr>
      {resources.map((r) => (
        <tr key={r} className="border-t">
          <td className="px-3 py-1.5 font-mono text-xs">{r}</td>
          {ACTIONS.map((a) => {
            const key = `${r}:${a}`;
            return (
              <td key={a} className="px-3 py-1.5 text-center">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={granted.has(key)}
                  disabled={!canEdit}
                  onChange={() => onToggle(r, a)}
                  aria-label={key}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
