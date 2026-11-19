"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionForm, Field, TextInput } from "@/components/shared/form";
import { addContactAction, removeContactAction } from "../actions";

interface ContactRow {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export function ContactsPanel({ customerId, contacts, canEdit }: { customerId: string; contacts: ContactRow[]; canEdit: boolean }) {
  const t = useTranslations("customer");
  const tc = useTranslations("common");
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      {contacts.length === 0 && <p className="text-sm text-muted-foreground">{tc("noResults")}</p>}
      <ul className="divide-y text-[13px]">
        {contacts.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-1.5">
            <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
              {c.isPrimary && <Star className="size-3.5 fill-amber-400 text-amber-500" aria-label="Primary" />}
              {c.name}
              {c.role && <span className="font-normal text-muted-foreground">· {c.role}</span>}
            </span>
            <span className="text-muted-foreground">{c.email}</span>
            <span className="text-muted-foreground">{c.phone}</span>
            {canEdit && (
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={pending}
                aria-label={tc("delete")}
                onClick={() => start(async () => void (await removeContactAction(customerId, c.id)))}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit &&
        (adding ? (
          <ActionForm
            action={addContactAction.bind(null, customerId)}
            submitLabel={t("addContact")}
            successMessage="Contact added"
            className="rounded-md border p-3"
          >
            {(e) => (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Field label={t("firstName")} name="firstName" error={e.firstName}>
                  <TextInput name="firstName" invalid={!!e.firstName} />
                </Field>
                <Field label={t("lastName")} name="lastName" error={e.lastName}>
                  <TextInput name="lastName" invalid={!!e.lastName} />
                </Field>
                <Field label="Role" name="role">
                  <TextInput name="role" />
                </Field>
                <Field label={t("email")} name="email">
                  <TextInput name="email" type="email" />
                </Field>
                <Field label={t("phone")} name="phone">
                  <TextInput name="phone" />
                </Field>
                <label className="col-span-full flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" name="isPrimary" className="size-3.5" /> Primary contact
                </label>
              </div>
            )}
          </ActionForm>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus /> {t("addContact")}
          </Button>
        ))}
    </div>
  );
}
