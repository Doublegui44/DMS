import { NextResponse, type NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { DomainError } from "@/lib/errors";
import { DOCUMENT_KINDS, documentFileName, getPrintableDocument, type DocumentKind } from "@/modules/reports";
import { renderPrintDocument } from "@/components/pdf/print-document";

/** PDF of an invoice, credit note, order form, repair order or warranty claim. `?download=1` saves it. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ doc: string; id: string }> }) {
  const { doc: kind, id } = await params;
  if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Unknown document" }, { status: 404 });
  try {
    const doc = await query((ctx) => getPrintableDocument(ctx, kind as DocumentKind, id));
    const t = await getTranslations("pdf");
    const tr = t as unknown as (key: string, values?: Record<string, string | number>) => string;
    const pdf = await renderPrintDocument(doc, tr);
    const disposition = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${documentFileName(doc.kind, doc.number)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof DomainError && err.code === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (err instanceof DomainError && err.code === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw err;
  }
}
