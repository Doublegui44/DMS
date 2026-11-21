"use client";

import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type Series = { key: string; label: string; color: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

/**
 * Grouped bars per month (one bar per series), one y-axis. Series keep a fixed color slot
 * whatever the role shows. `money` values are cents and are shown in euros.
 */
export function MonthlyBars({ data, series, money = false, testId }: { data: Record<string, number | string>[]; series: Series[]; money?: boolean; testId?: string }) {
  const fmt = (v: number, compact = false) =>
    money
      ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0 }).format(v / 100)
      : String(v);
  return (
    <div className="h-64 w-full text-xs" data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)" }} />
          <YAxis width={money ? 56 : 32} tickFormatter={(v: number) => fmt(v, true)} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)" }} allowDecimals={false} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            labelFormatter={(l) => monthLabel(String(l))}
            formatter={(v, name) => [fmt(Number(v)), name]}
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)", fontSize: 12 }}
            itemStyle={{ color: "var(--popover-foreground)" }}
          />
          <Legend itemSorter={null} iconType="circle" iconSize={8} wrapperStyle={{ color: "var(--muted-foreground)", paddingTop: 4 }} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
