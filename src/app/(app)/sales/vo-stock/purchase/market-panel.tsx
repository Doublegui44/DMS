"use client";

import { useTranslations } from "next-intl";
import { MarketValuation } from "../../market-valuation";

const field = (name: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);

/** The market feed beside the purchase form: reads the car's fields, fills the purchase price. */
export function VoMarketPanel() {
  const t = useTranslations("sales.market");
  return (
    <MarketValuation
      testId="vo-market"
      useLabel={t("useAsPrice")}
      query={() => ({
        make: field("vehicle.make")?.value ?? "",
        model: field("vehicle.model")?.value ?? "",
        firstRegistration: field("vehicle.firstRegistration")?.value ?? "",
        mileage: field("vehicle.mileage")?.value ?? "",
        fuel: field("vehicle.fuel")?.value ?? "",
      })}
      onUse={(cents) => {
        const input = field("priceCents") as HTMLInputElement | null;
        if (!input) return;
        // Through the native setter so a controlled input sees the change too.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, (cents / 100).toFixed(2));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }}
    />
  );
}
