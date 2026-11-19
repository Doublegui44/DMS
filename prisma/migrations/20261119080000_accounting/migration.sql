-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalKind" AS ENUM ('SALES', 'PURCHASES', 'BANK', 'CASH', 'MISC', 'OPENING');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'LOCKED');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('TRANSFER', 'CARD', 'CHEQUE', 'CASH', 'FINANCE_COMPANY');

-- AlterTable
ALTER TABLE "brand" ADD COLUMN     "oemSupplierId" TEXT;

-- CreateTable
CREATE TABLE "supplier" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isOem" BOOLEAN NOT NULL DEFAULT false,
    "siren" TEXT,
    "vatNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'FR',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "accountCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "class" INTEGER NOT NULL,
    "type" "AccountType" NOT NULL,
    "postable" BOOLEAN NOT NULL DEFAULT true,
    "requiresAnalytic" BOOLEAN NOT NULL DEFAULT false,
    "isReceivable" BOOLEAN NOT NULL DEFAULT false,
    "isPayable" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "journal" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "JournalKind" NOT NULL,
    "accountCode" TEXT,

    CONSTRAINT "journal_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "fiscal_period" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,

    CONSTRAINT "fiscal_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "journalCode" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "reversalOfId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_line" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "departmentCode" "DepartmentCode",
    "partyType" "PartyType",
    "partyId" TEXT,
    "debitCents" INTEGER NOT NULL DEFAULT 0,
    "creditCents" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "letteringCode" TEXT,
    "siteId" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,

    CONSTRAINT "journal_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_mapping" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "siteId" TEXT,
    "brandId" TEXT,
    "accountCode" TEXT NOT NULL,

    CONSTRAINT "account_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "kind" "InvoiceKind" NOT NULL DEFAULT 'INVOICE',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vatRegime" "VatRegime" NOT NULL DEFAULT 'STANDARD',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE,
    "dueDate" DATE,
    "totalExclVatCents" INTEGER NOT NULL DEFAULT 0,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "totalInclVatCents" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "creditedInvoiceId" TEXT,
    "journalEntryId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPriceExclVatCents" INTEGER NOT NULL,
    "discountBp" INTEGER NOT NULL DEFAULT 0,
    "lineExclVatCents" INTEGER NOT NULL,
    "vatRateCode" TEXT NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "departmentCode" "DepartmentCode" NOT NULL,
    "revenueKey" TEXT NOT NULL,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "journalCode" TEXT NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "allocatedCents" INTEGER NOT NULL DEFAULT 0,
    "businessDate" DATE NOT NULL,
    "reference" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_number_key" ON "supplier"("number");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_period_year_month_key" ON "fiscal_period"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_number_key" ON "journal_entry"("number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_reversalOfId_key" ON "journal_entry"("reversalOfId");

-- CreateIndex
CREATE INDEX "journal_entry_sourceType_sourceId_idx" ON "journal_entry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journal_entry_entryDate_idx" ON "journal_entry"("entryDate");

-- CreateIndex
CREATE INDEX "journal_line_accountCode_entryDate_idx" ON "journal_line"("accountCode", "entryDate");

-- CreateIndex
CREATE INDEX "journal_line_partyType_partyId_idx" ON "journal_line"("partyType", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_line_entryId_lineNo_key" ON "journal_line"("entryId", "lineNo");

-- CreateIndex
CREATE INDEX "account_mapping_key_idx" ON "account_mapping"("key");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_number_key" ON "invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_journalEntryId_key" ON "invoice"("journalEntryId");

-- CreateIndex
CREATE INDEX "invoice_customerId_status_idx" ON "invoice"("customerId", "status");

-- CreateIndex
CREATE INDEX "invoice_sourceType_sourceId_idx" ON "invoice"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_line_invoiceId_lineNo_key" ON "invoice_line"("invoiceId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "payment_number_key" ON "payment"("number");

-- CreateIndex
CREATE UNIQUE INDEX "payment_journalEntryId_key" ON "payment"("journalEntryId");

-- CreateIndex
CREATE INDEX "payment_customerId_idx" ON "payment"("customerId");

-- CreateIndex
CREATE INDEX "payment_supplierId_idx" ON "payment"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_oemSupplierId_key" ON "brand"("oemSupplierId");

-- AddForeignKey
ALTER TABLE "brand" ADD CONSTRAINT "brand_oemSupplierId_fkey" FOREIGN KEY ("oemSupplierId") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_journalCode_fkey" FOREIGN KEY ("journalCode") REFERENCES "journal"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "fiscal_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "account"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_mapping" ADD CONSTRAINT "account_mapping_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_mapping" ADD CONSTRAINT "account_mapping_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_mapping" ADD CONSTRAINT "account_mapping_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "account"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_creditedInvoiceId_fkey" FOREIGN KEY ("creditedInvoiceId") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_journalCode_fkey" FOREIGN KEY ("journalCode") REFERENCES "journal"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────
-- Hard guarantees for the ledger (see DECISIONS D-008, D-020).
-- ─────────────────────────────────────────────────────────────

-- A line is one-sided and non-negative.
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_one_sided"
  CHECK ("debitCents" >= 0 AND "creditCents" >= 0 AND ("debitCents" = 0) <> ("creditCents" = 0));

-- Nothing can be posted into, changed in or removed from a locked period.
CREATE OR REPLACE FUNCTION dms_assert_period_open(p_period_id TEXT) RETURNS VOID AS $$
DECLARE s TEXT;
BEGIN
  SELECT "status" INTO s FROM "fiscal_period" WHERE "id" = p_period_id;
  IF s = 'LOCKED' THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: fiscal period % is locked', p_period_id USING ERRCODE = 'P0001';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dms_journal_entry_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ENTRY_IMMUTABLE: journal entries cannot be modified, post a reversal' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM dms_assert_period_open(OLD."periodId");
    RETURN OLD;
  END IF;
  PERFORM dms_assert_period_open(NEW."periodId");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_entry"
  FOR EACH ROW EXECUTE FUNCTION dms_journal_entry_guard();

CREATE OR REPLACE FUNCTION dms_journal_line_guard() RETURNS TRIGGER AS $$
DECLARE pid TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only lettering may change after posting (it is not a posting).
    IF (NEW."entryId", NEW."lineNo", NEW."accountCode", NEW."departmentCode", NEW."partyType", NEW."partyId",
        NEW."debitCents", NEW."creditCents", NEW."label", NEW."siteId", NEW."entryDate")
       IS DISTINCT FROM
       (OLD."entryId", OLD."lineNo", OLD."accountCode", OLD."departmentCode", OLD."partyType", OLD."partyId",
        OLD."debitCents", OLD."creditCents", OLD."label", OLD."siteId", OLD."entryDate") THEN
      RAISE EXCEPTION 'ENTRY_IMMUTABLE: posted lines cannot be modified' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "periodId" INTO pid FROM "journal_entry" WHERE "id" = COALESCE(NEW."entryId", OLD."entryId");
  PERFORM dms_assert_period_open(pid);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_line_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_line"
  FOR EACH ROW EXECUTE FUNCTION dms_journal_line_guard();

-- Every entry balances and has at least two lines, checked at COMMIT.
CREATE OR REPLACE FUNCTION dms_journal_entry_balanced() RETURNS TRIGGER AS $$
DECLARE d BIGINT; c BIGINT; n INT;
BEGIN
  SELECT COALESCE(SUM("debitCents"), 0), COALESCE(SUM("creditCents"), 0), COUNT(*)
    INTO d, c, n FROM "journal_line" WHERE "entryId" = NEW."entryId";
  IF n > 0 AND (n < 2 OR d <> c) THEN
    RAISE EXCEPTION 'UNBALANCED_ENTRY: entry % has % lines, debit % <> credit %', NEW."entryId", n, d, c
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_entry_balanced
  AFTER INSERT ON "journal_line"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION dms_journal_entry_balanced();
