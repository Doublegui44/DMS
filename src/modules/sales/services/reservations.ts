import type { ServiceContext } from "@/lib/context";
import type { Tx } from "@/lib/db";
import { isoDate } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { canTransition, changeVehicleStatus, type StockType, type VehicleStatus } from "@/modules/core";
import { releasedStatus, reservationExpiresOn } from "../domain/workflow";
import { salesSettings } from "./shared";

declare module "@/lib/events" {
  interface DomainEventMap {
    VehicleReserved: { reservationId: string; vehicleId: string; customerId: string; quoteId: string | null; expiresOn: string };
    ReservationClosed: { reservationId: string; vehicleId: string; status: "RELEASED" | "EXPIRED" | "CONVERTED" };
  }
}

/** The order (confirmed or invoiced) a vehicle is sold on, if any. */
export function openOrderFor(tx: Tx, vehicleId: string) {
  return tx.salesOrder.findFirst({ where: { vehicleId, status: { in: ["CONFIRMED", "INVOICED"] } } });
}

/**
 * Hold a stock vehicle for a customer (business assumption 8: N days, from settings). One active
 * reservation per vehicle (also enforced by a partial unique index) and never on a sold vehicle.
 */
export async function reserveVehicle(
  ctx: ServiceContext,
  input: { vehicleId: string; customerId: string; quoteId?: string | null },
  opts: { trusted?: boolean } = {},
) {
  const v = await ctx.tx.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!v) throw new NotFoundError("Vehicle", input.vehicleId);
  if (!v.siteId || v.stockType === "NONE") throw new ValidationError("Only stock vehicles can be reserved");
  if (!opts.trusted) ctx.require("sales.quote", "edit", v.siteId);
  const customer = await ctx.tx.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new NotFoundError("Customer", input.customerId);

  const active = await ctx.tx.reservation.findFirst({ where: { vehicleId: v.id, status: "ACTIVE" }, include: { customer: true } });
  if (active) throw new ConflictError(`This vehicle is already reserved for ${active.customer.displayName} until ${isoDate(active.expiresOn)}`);
  const order = await openOrderFor(ctx.tx, v.id);
  if (order) throw new ConflictError(`This vehicle is already sold on order ${order.number}`);
  if (!canTransition(v.status as VehicleStatus, "RESERVED", v.stockType as StockType)) {
    throw new ConflictError(`A vehicle in status ${v.status.toLowerCase().replace("_", " ")} cannot be reserved`);
  }

  const { reservationDays } = await salesSettings(ctx.tx, v.siteId);
  const reservation = await ctx.tx.reservation.create({
    data: {
      vehicleId: v.id,
      siteId: v.siteId,
      quoteId: input.quoteId ?? null,
      customerId: customer.id,
      reservedById: ctx.actor.userId,
      previousStatus: v.status,
      reservedOn: ctx.businessDate,
      expiresOn: reservationExpiresOn(ctx.businessDate, reservationDays),
    },
  });
  await changeVehicleStatus(ctx, v.id, "RESERVED", `Reserved for ${customer.displayName}`, { trusted: true });
  await ctx.audit({ action: "vehicle.reserve", entityType: "Vehicle", entityId: v.id, siteId: v.siteId, after: reservation });
  await ctx.emit({
    type: "VehicleReserved",
    aggregateType: "Vehicle",
    aggregateId: v.id,
    siteId: v.siteId,
    payload: { reservationId: reservation.id, vehicleId: v.id, customerId: customer.id, quoteId: reservation.quoteId, expiresOn: isoDate(reservation.expiresOn) },
  });
  return reservation;
}

/** Close an active reservation and put the vehicle back on sale (unless an order now holds it). */
export async function releaseReservation(
  ctx: ServiceContext,
  reservationId: string,
  status: "RELEASED" | "EXPIRED" | "CONVERTED",
  opts: { trusted?: boolean } = {},
) {
  const r = await ctx.tx.reservation.findUnique({ where: { id: reservationId }, include: { vehicle: { include: { factoryOrder: true } } } });
  if (!r) throw new NotFoundError("Reservation", reservationId);
  if (!opts.trusted) ctx.require("sales.quote", "edit", r.siteId);
  if (r.status !== "ACTIVE") throw new ConflictError("This reservation is no longer active");
  await ctx.tx.reservation.update({ where: { id: r.id }, data: { status, closedOn: ctx.businessDate } });

  const v = r.vehicle;
  if (status !== "CONVERTED" && v.status === "RESERVED" && !(await openOrderFor(ctx.tx, v.id)) && (v.stockType === "VN" || v.stockType === "VO")) {
    const to = releasedStatus({
      stockType: v.stockType,
      stockInDate: v.stockInDate,
      inTransit: v.factoryOrder ? v.factoryOrder.status === "IN_TRANSIT" : r.previousStatus === "IN_TRANSIT",
    });
    await changeVehicleStatus(ctx, v.id, to, status === "EXPIRED" ? "Reservation expired" : "Reservation released", { trusted: true });
  }
  await ctx.audit({ action: `reservation.${status.toLowerCase()}`, entityType: "Vehicle", entityId: v.id, siteId: r.siteId, after: { reservationId: r.id, status } });
  await ctx.emit({ type: "ReservationClosed", aggregateType: "Vehicle", aggregateId: v.id, siteId: r.siteId, payload: { reservationId: r.id, vehicleId: v.id, status } });
}

/** End-of-day job: reservations past their last valid day expire. */
export async function expireReservations(ctx: ServiceContext, asOf: Date = ctx.businessDate): Promise<number> {
  const due = await ctx.tx.reservation.findMany({ where: { status: "ACTIVE", expiresOn: { lt: asOf } }, select: { id: true } });
  for (const r of due) await releaseReservation(ctx, r.id, "EXPIRED", { trusted: true });
  return due.length;
}
