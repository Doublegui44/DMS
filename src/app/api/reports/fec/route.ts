import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/session";
import { DomainError } from "@/lib/errors";
import { getFecExport } from "@/modules/accounting";

/** FEC file of a fiscal year (`?year=2026`), pipe-separated, UTF-8. */
export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  try {
    const fec = await query((ctx) => getFecExport(ctx, year));
    return new NextResponse(fec.content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fec.fileName}"`,
        "X-Fec-Lines": String(fec.lineCount),
      },
    });
  } catch (err) {
    if (err instanceof DomainError && err.code === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }
}
