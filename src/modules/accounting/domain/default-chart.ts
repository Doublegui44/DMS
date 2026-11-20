/**
 * Default French chart of accounts (PCG subset for a car dealership), journals and posting
 * mappings. Seeded into the database; everything is editable afterwards (nothing hard-coded).
 */

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export interface AccountDef {
  code: string;
  label: string;
  type: AccountType;
  receivable?: boolean;
  payable?: boolean;
}

export const DEFAULT_ACCOUNTS: AccountDef[] = [
  // Class 1 — equity
  { code: "101000", label: "Capital social", type: "EQUITY" },
  { code: "110000", label: "Report à nouveau", type: "EQUITY" },
  { code: "120000", label: "Résultat de l'exercice", type: "EQUITY" },
  { code: "164000", label: "Emprunts auprès des établissements de crédit", type: "LIABILITY" },
  { code: "181000", label: "Comptes de liaison des établissements", type: "EQUITY" },
  // Class 2 — fixed assets
  { code: "213500", label: "Installations générales, agencements", type: "ASSET" },
  { code: "215400", label: "Matériel industriel (atelier)", type: "ASSET" },
  // Class 3 — stock
  { code: "371000", label: "Stock véhicules neufs (VN)", type: "ASSET" },
  { code: "372000", label: "Stock véhicules d'occasion (VO)", type: "ASSET" },
  { code: "373000", label: "Stock pièces de rechange", type: "ASSET" },
  // Class 4 — third parties
  { code: "401000", label: "Fournisseurs", type: "LIABILITY", payable: true },
  { code: "401100", label: "Fournisseurs — constructeurs", type: "LIABILITY", payable: true },
  { code: "408100", label: "Fournisseurs — factures non parvenues", type: "LIABILITY" },
  { code: "411000", label: "Clients", type: "ASSET", receivable: true },
  { code: "411100", label: "Clients — constructeurs (garantie)", type: "ASSET", receivable: true },
  { code: "421000", label: "Personnel — rémunérations dues", type: "LIABILITY" },
  { code: "445620", label: "TVA déductible sur immobilisations", type: "ASSET" },
  { code: "445660", label: "TVA déductible sur autres biens et services", type: "ASSET" },
  { code: "445710", label: "TVA collectée 20 %", type: "LIABILITY" },
  { code: "445711", label: "TVA collectée 10 %", type: "LIABILITY" },
  { code: "445712", label: "TVA collectée 5,5 %", type: "LIABILITY" },
  { code: "445715", label: "TVA collectée sur marge (biens d'occasion)", type: "LIABILITY" },
  { code: "443100", label: "État — bonus écologique à recevoir", type: "ASSET" },
  { code: "445510", label: "TVA à décaisser", type: "LIABILITY" },
  { code: "447100", label: "Malus écologique collecté à reverser", type: "LIABILITY" },
  { code: "467100", label: "Débours — certificats d'immatriculation", type: "LIABILITY" },
  { code: "467300", label: "Organismes de financement à recevoir", type: "ASSET" },
  { code: "467400", label: "Vendeurs particuliers VO", type: "LIABILITY" },
  { code: "471000", label: "Compte d'attente", type: "ASSET" },
  // Class 5 — treasury
  { code: "512100", label: "Banque", type: "ASSET" },
  { code: "530000", label: "Caisse", type: "ASSET" },
  // Class 6 — expenses
  { code: "602200", label: "Achats de fournitures consommables", type: "EXPENSE" },
  { code: "603710", label: "Variation des stocks VN", type: "EXPENSE" },
  { code: "603720", label: "Variation des stocks VO", type: "EXPENSE" },
  { code: "603730", label: "Variation des stocks pièces", type: "EXPENSE" },
  { code: "604000", label: "Sous-traitance (travaux extérieurs)", type: "EXPENSE" },
  { code: "604100", label: "Achats de contrats de garantie et d'entretien", type: "EXPENSE" },
  { code: "607100", label: "Achats véhicules neufs", type: "EXPENSE" },
  { code: "607200", label: "Achats véhicules d'occasion", type: "EXPENSE" },
  { code: "607300", label: "Achats pièces de rechange", type: "EXPENSE" },
  { code: "607400", label: "Achats d'accessoires", type: "EXPENSE" },
  { code: "613200", label: "Locations immobilières", type: "EXPENSE" },
  { code: "622200", label: "Commissions sur ventes", type: "EXPENSE" },
  { code: "626000", label: "Frais postaux et télécommunications", type: "EXPENSE" },
  { code: "641000", label: "Rémunérations du personnel", type: "EXPENSE" },
  { code: "645000", label: "Charges de sécurité sociale", type: "EXPENSE" },
  { code: "658000", label: "Charges diverses de gestion courante", type: "EXPENSE" },
  // Class 7 — income
  { code: "706100", label: "Main-d'œuvre atelier (clientèle)", type: "INCOME" },
  { code: "706200", label: "Travaux sous-traités refacturés", type: "INCOME" },
  { code: "706300", label: "Main-d'œuvre garantie constructeur", type: "INCOME" },
  { code: "706400", label: "Main-d'œuvre interne (cessions VO)", type: "INCOME" },
  { code: "706500", label: "Produits annexes (garanties, contrats d'entretien)", type: "INCOME" },
  { code: "706600", label: "Commissions de financement", type: "INCOME" },
  { code: "707100", label: "Ventes véhicules neufs", type: "INCOME" },
  { code: "707200", label: "Ventes véhicules d'occasion", type: "INCOME" },
  { code: "707300", label: "Ventes pièces de rechange", type: "INCOME" },
  { code: "707400", label: "Pièces garantie constructeur", type: "INCOME" },
  { code: "707500", label: "Pièces cessions internes", type: "INCOME" },
  { code: "708800", label: "Autres produits d'activités annexes", type: "INCOME" },
  { code: "709000", label: "Rabais, remises et ristournes accordés", type: "INCOME" },
  // Class 8 — special
  { code: "890000", label: "Bilan d'ouverture", type: "EQUITY" },
];

export function accountClass(code: string): number {
  return Number(code[0]);
}

export const DEFAULT_JOURNALS = [
  { code: "VE", label: "Ventes", kind: "SALES" as const },
  { code: "AC", label: "Achats", kind: "PURCHASES" as const },
  { code: "BQ", label: "Banque", kind: "BANK" as const, accountCode: "512100" },
  { code: "CA", label: "Caisse", kind: "CASH" as const, accountCode: "530000" },
  { code: "OD", label: "Opérations diverses", kind: "MISC" as const },
  { code: "AN", label: "À-nouveaux", kind: "OPENING" as const },
];

/** Posting keys used by the builders and services. Revenue keys also carry their default department. */
export const DEFAULT_MAPPINGS: Record<string, string> = {
  RECEIVABLE_CUSTOMER: "411000",
  RECEIVABLE_OEM: "411100",
  PAYABLE_SUPPLIER: "401000",
  PAYABLE_OEM: "401100",
  GOODS_RECEIVED_NOT_INVOICED: "408100",
  VAT_COLLECTED_STANDARD: "445710",
  VAT_COLLECTED_INTERMEDIATE: "445711",
  VAT_COLLECTED_REDUCED: "445712",
  VAT_COLLECTED_MARGIN: "445715",
  VAT_DEDUCTIBLE_GOODS: "445660",
  VAT_DEDUCTIBLE_FIXED: "445620",
  REVENUE_VN: "707100",
  REVENUE_VO: "707200",
  REVENUE_PARTS: "707300",
  REVENUE_LABOUR: "706100",
  REVENUE_SUBLET: "706200",
  REVENUE_WARRANTY_LABOUR: "706300",
  REVENUE_INTERNAL_LABOUR: "706400",
  REVENUE_WARRANTY_PARTS: "707400",
  REVENUE_INTERNAL_PARTS: "707500",
  REVENUE_ADDON: "706500",
  REVENUE_FINANCE_COMMISSION: "706600",
  REVENUE_OTHER: "708800",
  DISCOUNTS_GRANTED: "709000",
  REGISTRATION_FEES: "467100",
  ECO_BONUS_RECEIVABLE: "443100",
  ECO_MALUS_PAYABLE: "447100",
  PURCHASE_VN: "607100",
  PURCHASE_VO: "607200",
  PURCHASE_PARTS: "607300",
  PURCHASE_ACCESSORY: "607400",
  PURCHASE_ADDON: "604100",
  PURCHASE_RECONDITIONING: "604000",
  PURCHASE_SUBLET: "604000", // work bought from another garage for a repair order
  STOCK_VN: "371000",
  STOCK_VO: "372000",
  STOCK_PARTS: "373000",
  STOCK_VARIATION_VN: "603710",
  STOCK_VARIATION_VO: "603720",
  STOCK_VARIATION_PARTS: "603730",
  FINANCE_COMPANY_RECEIVABLE: "467300",
  PRIVATE_SELLER: "467400",
  TREASURY_TRANSFER: "512100",
  TREASURY_CARD: "512100",
  TREASURY_CHEQUE: "512100",
  TREASURY_CASH: "530000",
  TREASURY_FINANCE_COMPANY: "467300",
  TREASURY_TRADE_IN: "467400", // the trade-in purchase (Cr 467400) offsets the customer's invoice
  CAPITAL: "101000",
  OPENING_BALANCE: "890000",
  SUSPENSE: "471000",
  SITE_LIAISON: "181000", // stock moved between sites of the same legal entity nets to zero
};

/** Revenue keys offered on manual invoices, with their natural department. */
export const REVENUE_KEYS: { key: string; label: string; department: "VN" | "VO" | "WORKSHOP" | "PARTS" | "OVERHEAD" }[] = [
  { key: "REVENUE_VN", label: "New vehicle sale", department: "VN" },
  { key: "REVENUE_VO", label: "Used vehicle sale", department: "VO" },
  { key: "REVENUE_LABOUR", label: "Workshop labour", department: "WORKSHOP" },
  { key: "REVENUE_SUBLET", label: "Sublet work", department: "WORKSHOP" },
  { key: "REVENUE_PARTS", label: "Parts", department: "PARTS" },
  { key: "REVENUE_ADDON", label: "Add-on product", department: "VN" },
  { key: "REVENUE_FINANCE_COMMISSION", label: "Finance commission", department: "VN" },
  { key: "REVENUE_OTHER", label: "Other income", department: "OVERHEAD" },
];

export type PaymentMethod = "TRANSFER" | "CARD" | "CHEQUE" | "CASH" | "FINANCE_COMPANY" | "TRADE_IN";

/** Methods that move money (offered on payment forms); FINANCE_COMPANY and TRADE_IN are recorded by sales. */
export const CASH_METHODS = ["TRANSFER", "CARD", "CHEQUE", "CASH"] as const;

/** Treasury mapping key per payment method. */
export function treasuryKey(method: PaymentMethod): string {
  return `TREASURY_${method}`;
}

/** A trade-in "pays" with the customer's own car: its treasury account (467400) is the customer's. */
export function treasuryIsCounterparty(method: PaymentMethod): boolean {
  return method === "TRADE_IN";
}

/** Journal used for each payment method. */
export function journalForMethod(method: PaymentMethod): string {
  return method === "CASH" ? "CA" : method === "FINANCE_COMPANY" || method === "TRADE_IN" ? "OD" : "BQ";
}
