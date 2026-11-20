import { redirect } from "next/navigation";
import { query } from "@/lib/session";
import { getReceiptOrderId } from "@/modules/parts";

/** A goods receipt is shown on its purchase order. */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = await query((ctx) => getReceiptOrderId(ctx, id));
  redirect(`/parts/purchasing/${orderId}#receipts`);
}
