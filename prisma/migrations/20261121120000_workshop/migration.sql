-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'ARRIVED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "RepairOrderKind" AS ENUM ('CUSTOMER', 'INTERNAL');

-- CreateEnum
CREATE TYPE "RepairOrderStatus" AS ENUM ('CHECKED_IN', 'IN_PROGRESS', 'QUALITY_CHECK', 'READY', 'INVOICED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobPayer" AS ENUM ('CUSTOMER', 'WARRANTY', 'INTERNAL', 'INSURANCE');

-- CreateEnum
CREATE TYPE "JobApproval" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('OPEN', 'DONE', 'DECLINED');

-- CreateEnum
CREATE TYPE "WarrantyClaimStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'PAID');

-- AlterEnum
ALTER TYPE "PartMovementKind" ADD VALUE 'RETURN_RO';

-- CreateTable
CREATE TABLE "labour_operation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "brandId" TEXT,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "standardCentiHours" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "labour_operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_bay" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "workshop_bay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technician" (
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "dailyCapacityCentiHours" INTEGER NOT NULL DEFAULT 780,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "technician_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "appointment" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "technicianId" TEXT,
    "bayId" TEXT,
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "plannedCentiHours" INTEGER NOT NULL,
    "concern" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" "RepairOrderKind" NOT NULL DEFAULT 'CUSTOMER',
    "status" "RepairOrderStatus" NOT NULL DEFAULT 'CHECKED_IN',
    "appointmentId" TEXT,
    "customerId" TEXT,
    "vehicleId" TEXT NOT NULL,
    "advisorId" TEXT,
    "openedOn" DATE NOT NULL,
    "promisedOn" DATE,
    "mileageIn" INTEGER NOT NULL,
    "fuelLevelPct" INTEGER NOT NULL,
    "damages" JSONB NOT NULL DEFAULT '[]',
    "signedBy" TEXT,
    "signatureDataUrl" TEXT,
    "qcById" TEXT,
    "qcOn" DATE,
    "qcNotes" TEXT,
    "readyOn" DATE,
    "invoicedOn" DATE,
    "closedOn" DATE,
    "cancelledOn" DATE,
    "customerInvoiceId" TEXT,
    "internalEntryId" TEXT,
    "totalExclVatCents" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ro_job" (
    "id" TEXT NOT NULL,
    "roId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "payer" "JobPayer" NOT NULL DEFAULT 'CUSTOMER',
    "payerCustomerId" TEXT,
    "technicianId" TEXT,
    "isAdditional" BOOLEAN NOT NULL DEFAULT false,
    "approval" "JobApproval" NOT NULL DEFAULT 'NOT_REQUIRED',
    "estimateCents" INTEGER,
    "approvalNote" TEXT,
    "decidedOn" DATE,
    "status" "JobStatus" NOT NULL DEFAULT 'OPEN',
    "completedOn" DATE,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ro_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ro_labour_line" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "operationId" TEXT,
    "label" TEXT NOT NULL,
    "billedCentiHours" INTEGER NOT NULL,
    "rateCents" INTEGER NOT NULL,
    "discountBp" INTEGER NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "ro_labour_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ro_part_line" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "requestedNumber" TEXT,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "discountBp" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "issued" BOOLEAN NOT NULL DEFAULT false,
    "unitCostCents" DECIMAL(18,4),
    "costCents" INTEGER,

    CONSTRAINT "ro_part_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ro_sublet_line" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "supplierReference" TEXT,

    CONSTRAINT "ro_sublet_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clocking" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "roId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER,
    "centiHours" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clocking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claim" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "roId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "WarrantyClaimStatus" NOT NULL DEFAULT 'SUBMITTED',
    "claimedCents" INTEGER NOT NULL,
    "submittedOn" DATE NOT NULL,
    "decidedOn" DATE,
    "paidOn" DATE,
    "creditNoteId" TEXT,
    "notes" TEXT,

    CONSTRAINT "warranty_claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labour_operation_code_key" ON "labour_operation"("code");

-- CreateIndex
CREATE INDEX "labour_operation_brandId_idx" ON "labour_operation"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_bay_siteId_name_key" ON "workshop_bay"("siteId", "name");

-- CreateIndex
CREATE INDEX "technician_siteId_idx" ON "technician"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_number_key" ON "appointment"("number");

-- CreateIndex
CREATE INDEX "appointment_siteId_date_idx" ON "appointment"("siteId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "repair_order_number_key" ON "repair_order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "repair_order_appointmentId_key" ON "repair_order"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "repair_order_customerInvoiceId_key" ON "repair_order"("customerInvoiceId");

-- CreateIndex
CREATE INDEX "repair_order_siteId_status_idx" ON "repair_order"("siteId", "status");

-- CreateIndex
CREATE INDEX "repair_order_vehicleId_idx" ON "repair_order"("vehicleId");

-- CreateIndex
CREATE INDEX "repair_order_customerId_idx" ON "repair_order"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ro_job_roId_lineNo_key" ON "ro_job"("roId", "lineNo");

-- CreateIndex
CREATE INDEX "clocking_technicianId_businessDate_idx" ON "clocking"("technicianId", "businessDate");

-- CreateIndex
CREATE INDEX "clocking_jobId_idx" ON "clocking"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claim_number_key" ON "warranty_claim"("number");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claim_jobId_key" ON "warranty_claim"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claim_invoiceId_key" ON "warranty_claim"("invoiceId");

-- CreateIndex
CREATE INDEX "warranty_claim_siteId_status_idx" ON "warranty_claim"("siteId", "status");

-- AddForeignKey
ALTER TABLE "labour_operation" ADD CONSTRAINT "labour_operation_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_bay" ADD CONSTRAINT "workshop_bay_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician" ADD CONSTRAINT "technician_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician" ADD CONSTRAINT "technician_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "workshop_bay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_advisorId_fkey" FOREIGN KEY ("advisorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ro_job" ADD CONSTRAINT "ro_job_roId_fkey" FOREIGN KEY ("roId") REFERENCES "repair_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ro_job" ADD CONSTRAINT "ro_job_payerCustomerId_fkey" FOREIGN KEY ("payerCustomerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ro_job" ADD CONSTRAINT "ro_job_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ro_labour_line" ADD CONSTRAINT "ro_labour_line_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ro_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ro_labour_line" ADD CONSTRAINT "ro_labour_line_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "labour_operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ro_part_line" ADD CONSTRAINT "ro_part_line_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ro_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ro_part_line" ADD CONSTRAINT "ro_part_line_partId_fkey" FOREIGN KEY ("partId") REFERENCES "part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ro_sublet_line" ADD CONSTRAINT "ro_sublet_line_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ro_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ro_sublet_line" ADD CONSTRAINT "ro_sublet_line_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clocking" ADD CONSTRAINT "clocking_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clocking" ADD CONSTRAINT "clocking_roId_fkey" FOREIGN KEY ("roId") REFERENCES "repair_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clocking" ADD CONSTRAINT "clocking_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ro_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clocking" ADD CONSTRAINT "clocking_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_roId_fkey" FOREIGN KEY ("roId") REFERENCES "repair_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ro_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written guards ─────────────────────────────────────
-- A technician is clocked on one job at a time.
CREATE UNIQUE INDEX "clocking_one_open_per_technician" ON "clocking" ("technicianId") WHERE "endMinute" IS NULL;

ALTER TABLE "clocking" ADD CONSTRAINT "clocking_minutes_check"
  CHECK ("startMinute" >= 0 AND "startMinute" < 1440 AND ("endMinute" IS NULL OR ("endMinute" >= "startMinute" AND "endMinute" <= 1440)));
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_slot_check"
  CHECK ("startMinute" >= 0 AND "startMinute" < 1440 AND "plannedCentiHours" > 0);
ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_checkin_check"
  CHECK ("mileageIn" >= 0 AND "fuelLevelPct" BETWEEN 0 AND 100);
ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_customer_check"
  CHECK (("kind" = 'INTERNAL') OR ("customerId" IS NOT NULL));
ALTER TABLE "ro_labour_line" ADD CONSTRAINT "ro_labour_line_check" CHECK ("billedCentiHours" > 0 AND "rateCents" >= 0);
ALTER TABLE "ro_part_line" ADD CONSTRAINT "ro_part_line_qty_check" CHECK ("qty" > 0);
