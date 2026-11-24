import { describe, expect, it } from "vitest";
import { oemOrderState } from "@/modules/sales/domain/oem-portal";

const d = (s: string) => new Date(s);
const order = { status: "ORDERED" as const, orderedOn: d("2026-03-01"), expectedOn: d("2026-04-10") }; // 40 days

describe("OEM portal stages (D-084)", () => {
  it("moves through the plant with the days: received, scheduled, in production, built", () => {
    expect(oemOrderState(order, d("2026-03-02")).stage).toBe("RECEIVED");
    expect(oemOrderState(order, d("2026-03-10")).stage).toBe("SCHEDULED");
    expect(oemOrderState(order, d("2026-03-25")).stage).toBe("IN_PRODUCTION");
    const built = oemOrderState(order, d("2026-04-06")); // 36 = 40 − 4 days of transit
    expect(built).toMatchObject({ stage: "BUILT", readyToShip: true, progressPct: 100, late: false });
    expect(oemOrderState(order, d("2026-03-21")).buildOn).toEqual(d("2026-03-21"));
  });

  it("follows the dealer's status once shipped, arrived or cancelled", () => {
    expect(oemOrderState({ ...order, status: "IN_TRANSIT" }, d("2026-04-08"))).toMatchObject({ stage: "SHIPPED", readyToShip: false, late: false });
    expect(oemOrderState({ ...order, status: "IN_TRANSIT" }, d("2026-04-12")).late).toBe(true);
    expect(oemOrderState({ ...order, status: "ARRIVED" }, d("2026-05-01"))).toMatchObject({ stage: "DELIVERED", late: false });
    expect(oemOrderState({ ...order, status: "CANCELLED" }, d("2026-03-05")).stage).toBe("CANCELLED");
  });

  it("is late once the promised date has passed", () => {
    expect(oemOrderState(order, d("2026-04-10")).late).toBe(false);
    expect(oemOrderState(order, d("2026-04-11")).late).toBe(true);
  });
});
