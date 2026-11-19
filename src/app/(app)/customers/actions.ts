"use server";

import { revalidatePath } from "next/cache";
import { command } from "@/lib/session";
import { formDataToObject } from "@/lib/validation";
import { addContact, createCustomer, removeContact, updateCustomer, type ContactInput, type CustomerInput } from "@/modules/core";
import type { FormState } from "@/components/shared/form";

export async function saveCustomerAction(id: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const input = formDataToObject(fd) as unknown as CustomerInput;
  const res = await command((ctx) => (id ? updateCustomer(ctx, id, input) : createCustomer(ctx, input)));
  if (!res.ok) return res;
  revalidatePath("/customers");
  return { ok: true, data: { id: res.data.id, redirectTo: `/customers/${res.data.id}` } };
}

export async function addContactAction(customerId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const input = formDataToObject(fd) as unknown as ContactInput;
  const res = await command((ctx) => addContact(ctx, customerId, input));
  if (!res.ok) return res;
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, data: { id: res.data.id } };
}

export async function removeContactAction(customerId: string, contactId: string) {
  const res = await command((ctx) => removeContact(ctx, contactId));
  revalidatePath(`/customers/${customerId}`);
  return res;
}
