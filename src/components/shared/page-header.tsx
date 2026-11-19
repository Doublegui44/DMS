import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  backHref,
  actions,
  badges,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  backHref?: string;
  actions?: React.ReactNode;
  badges?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {backHref && (
          <Link href={backHref} className="mb-1 inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-3.5" /> Back
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {badges}
        </div>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border bg-card ${className ?? ""}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Two-column label/value list for entity detail pages. */
export function Fields({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{i.label}</dt>
          <dd className="truncate">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
