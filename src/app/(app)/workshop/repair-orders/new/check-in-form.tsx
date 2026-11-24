"use client";

import { useRef, useState } from "react";
import { ActionForm, Field, NativeSelect, TextInput, inputClass, type FormState } from "@/components/shared/form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CheckInLabels {
  mileage: string;
  fuel: string;
  damages: string;
  damagesHint: string;
  concern: string;
  promisedOn: string;
  notes: string;
  signedBy: string;
  signature: string;
  signatureHint: string;
  clear: string;
  submit: string;
  customer: string;
  damagesPlaceholder: string;
}

/** Signature drawn with the mouse or a finger; sent as a PNG data URL in a hidden input. */
function SignaturePad({ name, clearLabel }: { name: string; clearLabel: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [value, setValue] = useState("");
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * e.currentTarget.width) / r.width, y: ((e.clientY - r.top) * e.currentTarget.height) / r.height };
  };
  return (
    <div className="space-y-1">
      <canvas
        ref={canvas}
        width={480}
        height={120}
        data-testid="signature-pad"
        className="h-[120px] w-full max-w-[480px] touch-none rounded-md border bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = point(e);
          ctx.lineWidth = 2;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#111";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = point(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          setValue(e.currentTarget.toDataURL("image/png"));
        }}
        onPointerLeave={(e) => {
          if (!drawing.current) return;
          drawing.current = false;
          setValue(e.currentTarget.toDataURL("image/png"));
        }}
      />
      <input type="hidden" name={name} value={value} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          const c = canvas.current;
          c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
          setValue("");
        }}
      >
        {clearLabel}
      </Button>
    </div>
  );
}

export function CheckInForm({
  action,
  labels,
  hidden,
  defaults,
  customers,
  internal,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  labels: CheckInLabels;
  hidden: Record<string, string>;
  defaults: { mileageIn: number; concern: string; signedBy: string };
  /** Shown when the car has no known owner. */
  customers: { value: string; label: string }[] | null;
  internal: boolean;
}) {
  return (
    <ActionForm action={action} submitLabel={labels.submit}>
      {(errors) => (
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {customers && (
            <Field label={labels.customer} name="customerId" error={errors.customerId} className="sm:col-span-full">
              <NativeSelect name="customerId" options={customers} placeholder="—" invalid={!!errors.customerId} data-testid="checkin-customer" />
            </Field>
          )}
          <Field label={labels.mileage} name="mileageIn" error={errors.mileageIn}>
            <TextInput name="mileageIn" inputMode="numeric" defaultValue={String(defaults.mileageIn)} invalid={!!errors.mileageIn} data-testid="checkin-mileage" />
          </Field>
          <Field label={labels.fuel} name="fuelLevelPct" error={errors.fuelLevelPct}>
            <NativeSelect name="fuelLevelPct" defaultValue="50" options={["0", "25", "50", "75", "100"].map((v) => ({ value: v, label: `${v} %` }))} />
          </Field>
          <Field label={labels.concern} name="concern" error={errors.concern} className="sm:col-span-full">
            <TextInput name="concern" defaultValue={defaults.concern} data-testid="checkin-concern" />
          </Field>
          <Field label={labels.damages} name="damages" error={errors.damages} className="sm:col-span-full">
            <textarea id="damages" name="damages" rows={2} className={cn(inputClass, "h-auto py-1.5")} placeholder={labels.damagesPlaceholder} data-testid="checkin-damages" />
            <p className="text-[11px] text-muted-foreground">{labels.damagesHint}</p>
          </Field>
          <Field label={labels.promisedOn} name="promisedOn" error={errors.promisedOn}>
            <TextInput name="promisedOn" type="date" />
          </Field>
          <Field label={labels.notes} name="notes" error={errors.notes}>
            <TextInput name="notes" />
          </Field>
          {!internal && (
            <>
              <Field label={labels.signedBy} name="signedBy" error={errors.signedBy}>
                <TextInput name="signedBy" defaultValue={defaults.signedBy} invalid={!!errors.signedBy} data-testid="checkin-signed-by" />
              </Field>
              <Field label={labels.signature} name="signatureDataUrl" error={errors.signatureDataUrl} className="sm:col-span-full">
                <SignaturePad name="signatureDataUrl" clearLabel={labels.clear} />
                <p className="text-[11px] text-muted-foreground">{labels.signatureHint}</p>
              </Field>
            </>
          )}
        </div>
      )}
    </ActionForm>
  );
}
