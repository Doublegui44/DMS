"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import type { SimulationJob } from "@/modules/simulation";
import { simulationProgressAction, stopSimulationAction } from "./actions";

const active = (j: SimulationJob | null) => !!j && (j.status === "running" || j.status === "stopping");

/** The run going on in the background: progress bar, business date reached, steps, Stop. */
export function JobPanel({ initial }: { initial: SimulationJob | null }) {
  const t = useTranslations("simulation");
  const router = useRouter();
  const [job, setJob] = useState(initial);
  const wasActive = useRef(active(initial));

  useEffect(() => {
    if (!active(job)) return;
    const timer = setInterval(async () => {
      const r = await simulationProgressAction();
      if (!r.ok || !r.data) return;
      setJob(r.data);
      if (!active(r.data) && wasActive.current) {
        wasActive.current = false;
        if (r.data.status === "done") toast.success(t("done"));
        else toast.error(r.data.error ?? t("failed"));
        router.refresh();
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [job, router, t]);

  if (!active(job)) return null;
  const pct = Math.round((100 * job!.daysDone) / Math.max(1, job!.days));
  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3" data-testid="sim-job">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span>
          {job!.status === "stopping" ? t("stopping") : t("running")} · {t("progress", { done: job!.daysDone, days: job!.days })} · {formatDate(job!.current)} · {t("stepsCount", { n: job!.steps })}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={job!.status === "stopping"}
          onClick={async () => {
            const r = await stopSimulationAction();
            if (r.ok && r.data) setJob(r.data);
            else if (!r.ok) toast.error(r.error.message);
          }}
        >
          {t("stop")}
        </Button>
      </div>
      <div className="h-2 overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
