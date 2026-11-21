import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocumentKind } from "@/modules/reports";

/** Opens the printable PDF of a document in a new tab (`/api/pdf/<kind>/<id>`). */
export async function PdfButton({ kind, id, variant = "outline" }: { kind: DocumentKind; id: string; variant?: "outline" | "ghost" }) {
  const t = await getTranslations("pdf");
  return (
    <Button asChild size="sm" variant={variant}>
      <Link href={`/api/pdf/${kind}/${id}`} target="_blank" prefetch={false} data-testid={`pdf-${kind}`}>
        <FileDown /> {t("download")}
      </Link>
    </Button>
  );
}
