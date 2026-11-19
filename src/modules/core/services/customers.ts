import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { customerAccountCode, customerDisplayName } from "../domain/customer";
import { contactInputSchema, customerInputSchema, type ContactInput, type CustomerInput } from "../schemas/customer";
import { nextDocumentNumber } from "./numbering";

declare module "@/lib/events" {
  interface DomainEventMap {
    CustomerCreated: { customerId: string; number: string };
    CustomerUpdated: { customerId: string; changed: string[] };
  }
}

function normalise(data: ReturnType<typeof customerInputSchema.parse>) {
  const isIndividual = data.kind === "INDIVIDUAL";
  return {
    ...data,
    title: isIndividual ? data.title ?? null : null,
    firstName: isIndividual ? data.firstName ?? null : null,
    lastName: isIndividual ? data.lastName ?? null : null,
    companyName: isIndividual ? null : data.companyName ?? null,
    siren: isIndividual ? null : data.siren?.replace(/\s/g, "") ?? null,
    vatNumber: data.vatNumber?.replace(/\s/g, "").toUpperCase() ?? null,
    displayName: customerDisplayName(data),
  };
}

export async function createCustomer(ctx: ServiceContext, input: CustomerInput) {
  ctx.require("customer", "create", input.homeSiteId ?? ctx.siteId);
  const data = normalise(parseInput(customerInputSchema, input));
  const number = await nextDocumentNumber(ctx, { docType: "CUSTOMER", scope: "GROUP" });
  const customer = await ctx.tx.customer.create({
    data: {
      ...data,
      number,
      accountCode: customerAccountCode(number),
      homeSiteId: data.homeSiteId ?? ctx.siteId,
    },
  });
  await ctx.audit({ action: "customer.create", entityType: "Customer", entityId: customer.id, after: customer });
  await ctx.emit({
    type: "CustomerCreated",
    aggregateType: "Customer",
    aggregateId: customer.id,
    payload: { customerId: customer.id, number },
  });
  return customer;
}

export async function updateCustomer(ctx: ServiceContext, id: string, input: CustomerInput) {
  const before = await ctx.tx.customer.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Customer", id);
  ctx.require("customer", "edit", before.homeSiteId ?? ctx.siteId);
  const data = normalise(parseInput(customerInputSchema, input));
  const after = await ctx.tx.customer.update({ where: { id }, data });
  const changed = Object.keys(data).filter(
    (k) => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(after[k as keyof typeof after]),
  );
  await ctx.audit({ action: "customer.update", entityType: "Customer", entityId: id, before, after });
  if (changed.length) {
    await ctx.emit({
      type: "CustomerUpdated",
      aggregateType: "Customer",
      aggregateId: id,
      payload: { customerId: id, changed },
    });
  }
  return after;
}

export async function addContact(ctx: ServiceContext, customerId: string, input: ContactInput) {
  const customer = await ctx.tx.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new NotFoundError("Customer", customerId);
  ctx.require("customer", "edit", customer.homeSiteId ?? ctx.siteId);
  const data = parseInput(contactInputSchema, input);
  if (data.isPrimary) {
    await ctx.tx.contact.updateMany({ where: { customerId }, data: { isPrimary: false } });
  }
  const contact = await ctx.tx.contact.create({ data: { ...data, customerId } });
  await ctx.audit({ action: "customer.contact.add", entityType: "Customer", entityId: customerId, after: contact });
  return contact;
}

export async function removeContact(ctx: ServiceContext, contactId: string) {
  const contact = await ctx.tx.contact.findUnique({ where: { id: contactId }, include: { customer: true } });
  if (!contact) throw new NotFoundError("Contact", contactId);
  ctx.require("customer", "edit", contact.customer.homeSiteId ?? ctx.siteId);
  await ctx.tx.contact.delete({ where: { id: contactId } });
  await ctx.audit({
    action: "customer.contact.remove",
    entityType: "Customer",
    entityId: contact.customerId,
    before: contact,
  });
}
