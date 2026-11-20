import Link from "next/link";
import { getRequestContext } from "@/lib/session";
import { can } from "@/lib/rbac";

/** A journal entry number, linked only for users who may open journal entries. */
export async function EntryLink({ id, number, testId }: { id: string; number: string; testId?: string }) {
  const { actor } = await getRequestContext();
  return can(actor.permissions, "accounting.entry", "view") ? (
    <Link className="text-primary hover:underline" href={`/accounting/entries/${id}`} data-testid={testId}>
      {number}
    </Link>
  ) : (
    <span data-testid={testId}>{number}</span>
  );
}
