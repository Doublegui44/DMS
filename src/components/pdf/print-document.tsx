import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/dates";
import { formatBp, formatMoney } from "@/lib/money";
import type { PrintDoc, PrintField } from "@/modules/reports";

/**
 * One A4 template for every printable document (D-069). It only lays out a `PrintDoc`:
 * amounts, VAT and mentions were decided by the reports module. Built-in Helvetica
 * covers WinAnsi (accents, €), which is all the seed and the UI produce.
 */
type T = (key: string, values?: Record<string, string | number>) => string;

const INK = "#1f2328";
const MUTED = "#6b7280";
const RULE = "#d9dce1";
const ACCENT = "#2a78d6";

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 84, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 9, color: INK, lineHeight: 1.35 },
  row: { flexDirection: "row" },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  issuerName: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  muted: { color: MUTED },
  small: { fontSize: 7.5, color: MUTED },
  title: { fontFamily: "Helvetica-Bold", fontSize: 16, color: ACCENT, textAlign: "right", marginBottom: 4 },
  number: { fontFamily: "Helvetica-Bold", fontSize: 11, textAlign: "right", marginTop: 2 },
  parties: { flexDirection: "row", gap: 16, marginBottom: 14 },
  fields: { flex: 1 },
  recipient: { flex: 1, borderWidth: 1, borderColor: RULE, borderRadius: 4, padding: 10 },
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  field: { flexDirection: "row", marginBottom: 1.5 },
  fieldKey: { width: 92, color: MUTED },
  fieldValue: { flex: 1 },
  sectionTitle: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, marginBottom: 3 },
  badge: { fontSize: 7.5, color: ACCENT, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 3, fontSize: 7.5, color: MUTED },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 3 },
  cLabel: { flex: 1, paddingRight: 6 },
  cQty: { width: 40, textAlign: "right" },
  cUnit: { width: 64, textAlign: "right" },
  cDisc: { width: 40, textAlign: "right" },
  cVat: { width: 40, textAlign: "right" },
  cAmount: { width: 72, textAlign: "right" },
  subtotal: { flexDirection: "row", justifyContent: "flex-end", paddingTop: 3, color: MUTED },
  bottom: { flexDirection: "row", gap: 16, marginTop: 14 },
  vatBox: { flex: 1 },
  totals: { width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalStrong: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, marginTop: 2, borderTopWidth: 1, borderTopColor: INK, fontFamily: "Helvetica-Bold", fontSize: 10.5 },
  notes: { marginTop: 14 },
  signatures: { flexDirection: "row", gap: 16, marginTop: 18 },
  signature: { flex: 1, height: 70, borderWidth: 1, borderColor: RULE, borderRadius: 4, padding: 8 },
  footer: { position: "absolute", bottom: 22, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 5, fontSize: 7, color: MUTED },
});

const money = (c: number | undefined) => (c === undefined ? "" : formatMoney(c));

function fieldValue(f: PrintField) {
  if (f.cents !== undefined) return formatMoney(f.cents);
  if (f.date !== undefined) return formatDate(f.date);
  return f.text ?? "—";
}

export function PrintDocument({ doc, t }: { doc: PrintDoc; t: T }) {
  const hasUnit = doc.sections.some((sec) => sec.lines.some((l) => l.unitCents !== undefined));
  const hasDiscount = doc.sections.some((sec) => sec.lines.some((l) => l.discountBp));
  const hasVat = doc.sections.some((sec) => sec.lines.some((l) => l.vatRateBp !== undefined));
  const title = `${t(`titles.${doc.title}`)} ${doc.number}`;
  return (
    <Document title={title} author={doc.issuer.name} subject={t(`titles.${doc.title}`)} creator="DMS Simulator" producer="DMS Simulator">
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View>
            <Text style={s.issuerName}>{doc.issuer.name}</Text>
            {doc.issuer.lines.map((l, i) => (
              <Text key={i} style={s.muted}>
                {l}
              </Text>
            ))}
            {doc.issuer.ids?.map((id) => (
              <Text key={id.key} style={s.small}>
                {t(`ids.${id.key}`)} {id.value}
              </Text>
            ))}
          </View>
          <View>
            <Text style={s.title}>{t(`titles.${doc.title}`)}</Text>
            <Text style={s.number}>{doc.number}</Text>
            {doc.date && <Text style={[s.muted, { textAlign: "right" }]}>{formatDate(doc.date)}</Text>}
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.fields}>
            {doc.fields.map((f) => (
              <View key={f.key} style={s.field}>
                <Text style={s.fieldKey}>{t(`fields.${f.key}`)}</Text>
                <Text style={s.fieldValue}>{fieldValue(f)}</Text>
              </View>
            ))}
          </View>
          <View style={s.recipient}>
            <Text style={s.label}>{t(doc.kind === "warranty-claim" ? "claimedFrom" : "billTo")}</Text>
            <Text style={s.bold}>{doc.recipient.name}</Text>
            {doc.recipient.lines.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
            {doc.recipient.ids?.map((id) => (
              <Text key={id.key} style={s.small}>
                {t(`ids.${id.key}`)} {id.value}
              </Text>
            ))}
          </View>
        </View>

        <View style={s.th} fixed>
          <Text style={s.cLabel}>{t("columns.description")}</Text>
          <Text style={s.cQty}>{t("columns.qty")}</Text>
          {hasUnit && <Text style={s.cUnit}>{t("columns.unit")}</Text>}
          {hasDiscount && <Text style={s.cDisc}>{t("columns.discount")}</Text>}
          {hasVat && <Text style={s.cVat}>{t("columns.vat")}</Text>}
          <Text style={s.cAmount}>{doc.amounts === "incl" ? t("columns.amountIncl") : t("columns.amountExcl")}</Text>
        </View>
        {doc.sections.map((sec, i) => (
          <View key={i} wrap={sec.lines.length > 8}>
            {(sec.title || sec.badge) && (
              <View style={s.sectionTitle}>
                <Text style={s.bold}>{sec.title}</Text>
                {sec.badge && (
                  <Text style={s.badge}>
                    {t(`badges.${sec.badge}`)}
                    {sec.note ? ` · ${sec.note}` : ""}
                  </Text>
                )}
              </View>
            )}
            {sec.lines.map((l, j) => (
              <View key={j} style={s.tr} wrap={false}>
                <View style={s.cLabel}>
                  <Text>{l.label}</Text>
                  {l.detail && <Text style={s.small}>{l.detail}</Text>}
                </View>
                <Text style={s.cQty}>{l.qty ?? ""}</Text>
                {hasUnit && <Text style={s.cUnit}>{money(l.unitCents)}</Text>}
                {hasDiscount && <Text style={s.cDisc}>{l.discountBp ? formatBp(l.discountBp, 1) : ""}</Text>}
                {hasVat && <Text style={s.cVat}>{l.vatRateBp === null ? "*" : l.vatRateBp === undefined ? "" : formatBp(l.vatRateBp, 1)}</Text>}
                <Text style={s.cAmount}>{formatMoney(l.amountCents)}</Text>
              </View>
            ))}
            {sec.lines.length === 0 && (
              <View style={s.tr}>
                <Text style={[s.cLabel, s.muted]}>{t("noLines")}</Text>
              </View>
            )}
            {sec.subtotalCents !== undefined && (
              <View style={s.subtotal}>
                <Text>
                  {t("subtotal")} {formatMoney(sec.subtotalCents)}
                </Text>
              </View>
            )}
          </View>
        ))}

        <View style={s.bottom} wrap={false}>
          <View style={s.vatBox}>
            {doc.vat.length > 0 && (
              <>
                <Text style={s.label}>{t("vatSummary")}</Text>
                <View style={s.th}>
                  <Text style={s.cVat}>{t("columns.vat")}</Text>
                  <Text style={s.cAmount}>{t("vatBase")}</Text>
                  <Text style={s.cAmount}>{t("vatAmount")}</Text>
                </View>
                {doc.vat.map((v) => (
                  <View key={v.vatRateBp} style={s.tr}>
                    <Text style={s.cVat}>{formatBp(v.vatRateBp, 1)}</Text>
                    <Text style={s.cAmount}>{formatMoney(v.baseCents)}</Text>
                    <Text style={s.cAmount}>{formatMoney(v.vatCents)}</Text>
                  </View>
                ))}
              </>
            )}
            {hasVat && doc.sections.some((sec) => sec.lines.some((l) => l.vatRateBp === null)) && <Text style={[s.small, { marginTop: 4 }]}>* {t("noVatShown")}</Text>}
          </View>
          <View style={s.totals}>
            {doc.totals.map((x) => (
              <View key={x.key} style={x.strong ? s.totalStrong : s.totalRow}>
                <Text>{t(`totals.${x.key}`)}</Text>
                <Text>{formatMoney(x.cents)}</Text>
              </View>
            ))}
          </View>
        </View>

        {doc.notes.length > 0 && (
          <View style={s.notes} wrap={false}>
            <Text style={s.label}>{t("notes")}</Text>
            {doc.notes.map((n, i) => (
              <Text key={i}>{n}</Text>
            ))}
          </View>
        )}

        {doc.signatures.length > 0 && (
          <View style={s.signatures} wrap={false}>
            {doc.signatures.map((sig) => (
              <View key={sig.key} style={s.signature}>
                <Text style={s.label}>{t(`signatures.${sig.key}`)}</Text>
                {sig.name && <Text>{sig.name}</Text>}
              </View>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          {doc.mentions.map((m, i) => (
            <Text key={i}>{m}</Text>
          ))}
          <Text render={({ pageNumber, totalPages }) => `${doc.number} · ${t("page", { page: pageNumber, pages: totalPages })}`} style={{ textAlign: "right" }} />
        </View>
      </Page>
    </Document>
  );
}

/** Renders a document to PDF bytes (server only). */
export async function renderPrintDocument(doc: PrintDoc, t: T): Promise<Buffer> {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  return renderToBuffer(<PrintDocument doc={doc} t={t} />);
}
