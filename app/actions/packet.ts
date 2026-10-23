"use server";

import {
  isBusinessBankCategory,
  isMyselfBusinessBankFlow,
} from "@/lib/tax/business-bank-categories";
import {
  buildBusinessPacket,
  businessCoverageSummary,
  type BusinessPacket,
} from "@/lib/tax/business-filing";
import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import PDFDocument from "pdfkit";
import { getServerSession } from "next-auth/next";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateFilingCompleteness } from "@/lib/tax/filing-completeness";
import { isGiftCategory } from "@/lib/tax/gift-income";
import { validateAuthoritativeReconciliation } from "@/lib/tax/reconciliation-calculation";
import { createNotification } from "@/app/actions/notifications";
import { serializePacketMoney } from "@/lib/money";
import { toMoneyAmount, toMoneyNumber, sumMoney, type MoneyInput } from "@/lib/money";
import { resolveApprovedPensionSource, type PensionSource } from "@/lib/tax/pension-source";
import { pensionPacketValidationError } from "@/lib/tax/pension-packet-validation";
import {
  buildPacketRouteMetadata,
  buildPortalFieldMap,
  describeUnmappedPortalSources,
} from "@/lib/tax/portal-field-map";
import {
  parsePersistedSelectionUserDetails,
  resolvePensionFormerEmployerAnswer,
  TY2026_PENSION_FORMER_EMPLOYER_SUBCATEGORY,
} from "@/lib/tax/rules/ty2026/subcategories";
import {
  extractMappedSalaryEmployers,
  normalizeLedgerCategory,
  extractMappedSalaryGross,
  extractMappedSalaryWithholding,
} from "@/lib/tax/withholding-sources";
import {
  readApprovedBankProfitCertificate,
  type ApprovedBankProfitCertificate,
} from "@/lib/tax/bank-profit-certificate-fields";
import {
  bankProfitSubcategoryFromCertificate,
  type BankProfitPortalSource,
  type BankProfitSubcategory,
} from "@/lib/tax/iris-bank-profit-capture";

async function getOwnedDraft(draftId: string) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) throw new Error("Unauthorized");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, dateOfBirth: true, cnic: true },
  });

  if (!user) throw new Error("User profile not found");

  const draft = await prisma.filingDraft.findFirst({
    where: { id: draftId, userId: user.id },
    select: { id: true, userId: true },
  });

  if (!draft) throw new Error("Filing draft not found");

  return { ...draft, taxpayerDateOfBirth: user.dateOfBirth, taxpayerCnic: user.cnic };
}

function buildPacketPdf(snapshotJson: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];

    document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    const snapshot = JSON.parse(snapshotJson) as {
      filing: {
        taxYear: number;
        filerType: string | null;
        businessStructure: string | null;
        residencyStatus?: string | null;
        taxpayerListStatus?: string | null;
        taxpayerListStatusSource?: string | null;
        taxRuleSetVersion?: string | null;
        taxCalculationRevision?: string | null;
        taxableIncome?: MoneyInput;
        taxPayable?: MoneyInput;
        refundDue?: MoneyInput;
        taxCalculationStatus?: string;
        reconciliationGap?: MoneyInput;
      };
      business?: BusinessPacket;
      pension?: PensionSource;
      portalFieldMap?: ReturnType<typeof buildPortalFieldMap>;
      documents: { documentType: string; fileName: string }[];
      ledgerEntries: {
        entryType: string;
        category: string | null;
        description: string;
        amount: number;
      }[];
    };

    document.fontSize(20).text("TaxRocket Filing Packet", { underline: true });
    document.moveDown();
    document.fontSize(11).text(`Tax Year: ${snapshot.filing.taxYear}`);
    document.text(`Filer: ${snapshot.filing.filerType ?? "Not specified"}`);
    document.text(
      `Business structure: ${snapshot.filing.businessStructure ?? "Not specified"}`,
    );
    document.text(
      `Residency: ${snapshot.filing.residencyStatus === "non_resident" ? "Non-Resident" : snapshot.filing.residencyStatus === "resident" ? "Resident" : "Not selected"}`,
    );
    document.text(
      `Taxpayer-list status: ${snapshot.filing.taxpayerListStatus ?? "Not selected"}`,
    );
    document.text(
      `Status source: ${snapshot.filing.taxpayerListStatusSource ?? "Not selected"}`,
    );
    document.text(
      `Tax rule set: ${snapshot.filing.taxRuleSetVersion ?? "Not selected"}`,
    );

    document.moveDown();
    document.fontSize(14).text("Tax Summary");
    const taxCalculationReady =
      snapshot.filing.taxCalculationStatus === "ESTIMATE";
    // Converted before formatting. These come straight off the draft, where
    // they are Decimal columns, and `Decimal.toLocaleString()` does not group
    // thousands: the final packet would print "PKR 3685290" instead of
    // "PKR 3,685,290" on the document that goes to the FBR.
    const taxValue = (value?: MoneyInput) =>
      taxCalculationReady && value !== null && value !== undefined
        ? `PKR ${toMoneyNumber(value).toLocaleString()}`
        : "Pending — route-specific tax rules required";
    document
      .fontSize(11)
      .text(`Taxable income: ${taxValue(snapshot.filing.taxableIncome)}`);
    document.text(`Tax payable: ${taxValue(snapshot.filing.taxPayable)}`);
    document.text(`Refund due: ${taxValue(snapshot.filing.refundDue)}`);
    document.text(
      `Reconciliation gap: PKR ${Math.abs(
        toMoneyAmount(snapshot.filing.reconciliationGap),
      ).toLocaleString()}`,
    );

    if (snapshot.pension) {
      const pension = snapshot.pension;
      document.moveDown();
      document.fontSize(14).text("Reviewed Annual Pension Source");
      document.fontSize(10);
      const money = (value: number | null) => value === null ? "Not stated" : `PKR ${toMoneyNumber(value).toLocaleString()}`;
      document.text(`Statement gross (annual): ${money(pension.grossAnnual)}`);
      document.text(`Medical allowance (annual, no automatic tax classification): ${money(pension.medicalAnnual)}`);
      document.text(`Net payable (annual): ${money(pension.netAnnual)}`);
      document.text(`APPROVED pension tax base: ${money(pension.annualPension)}`);
      document.text(`Bank pension receipts (cash evidence only, not added again): ${money(pension.ledgerPension)}`);
      document.text(`Actual pension tax deducted: ${money(pension.taxDeducted)}; already in tax ledger: ${money(pension.taxAlreadyInLedger)}`);
      document.text(`Treatment: ${pension.treatment}; profile age bracket: ${pension.ageBracket}`);
      document.text(pension.reviewNote ? `Reviewer decision: ${pension.reviewNote}` : "Basis: reviewed annual gross pension; no manual tax-base override.");
      if (pension.treatment === "final_above_10m") {
        document.text(`Existing app rules, before withholding/credits: base tax ${money(pension.baseTax)} + surcharge ${money(pension.surcharge)} = ${money(pension.taxDue)}. This is not independent legal certification.`);
        document.text(`IRIS packet route: 1008 classifies the annual pension as final-tax income; 64020007 carries the amount above PKR 10M and actual withholding; 923184 carries the Section 4AB surcharge.`);
      }
      const manual = snapshot.portalFieldMap?.mappingGaps?.pensionManualReview;
      if (manual) {
        document.moveDown(0.5);
        document.font("Helvetica-Bold").text("PENSION PORTAL ENTRY: MANUAL REVIEW REQUIRED");
        document.font("Helvetica").text(manual.reason);
        document.text("Verify whether 64020007 requires the full pension or the excess; do not deduct 10M twice. Tax Deducted means actual withholding, never calculated liability. Verify the portal surcharge separately. No automatic pension entry is queued and this packet cannot start desktop autofill.");
      }
    }

    document.moveDown();
    document.fontSize(14).text("Ledger Entries");
    document.fontSize(10);
    if (snapshot.ledgerEntries.length === 0) {
      document.text("No ledger entries recorded.");
    } else {
      for (const entry of snapshot.ledgerEntries) {
        document.text(
          `${entry.entryType} | ${entry.category ?? "—"} | ${entry.description} | PKR ${toMoneyNumber(
            entry.amount,
          ).toLocaleString()}`,
        );
      }
    }

    document.moveDown();
    if (snapshot.business) {
      document.fontSize(14).text("Business — partial verified entry");
      document.fontSize(10);
      for (const [key, value] of Object.entries(
        snapshot.business.approvedInputs,
      )) {
        document.text(
          `${key}: ${value === null ? "Not provided" : value.toLocaleString("en-PK")}`,
        );
      }
      document.text(
        `Queued verified business fields: ${snapshot.business.fields.length}`,
      );
      for (const item of snapshot.business.pending)
        document.text(`Manual / pending: ${item.key} — ${item.reason}`);
      document.moveDown();
    }
    document.fontSize(14).text("Attached Documents");
    document.fontSize(10);
    if (snapshot.documents.length === 0) {
      document.text("No documents attached.");
    } else {
      for (const file of snapshot.documents) {
        document.text(`${file.documentType}: ${file.fileName}`);
      }
    }

    document.moveDown();
    document
      .fontSize(9)
      .fillColor("#666666")
      .text(
        "Generated by TaxRocket. This packet is a snapshot for user review.",
      );
    document.end();
  });
}

export async function getLatestFilingPacketAction(draftId: string) {
  try {
    const draft = await getOwnedDraft(draftId);
    const packet = await prisma.filingPacket.findFirst({
      where: {
        filingDraftId: draft.id,
        userId: draft.userId,
        status: { not: "SUPERSEDED" },
      },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        packetHash: true,
        status: true,
        approvalStatus: true,
        taxPayable: true,
        refundDue: true,
        fileUrl: true,
        createdAt: true,
        snapshotJson: true,
      },
    });

    // The mapping gaps live INSIDE the snapshot; re-reading them on fetch means the
    // practitioner sees the same "manual entry required" list on the packet step
    // whether the packet was just generated or was loaded from a previous session.
    let mappingGaps: unknown = null;
    let businessCoverage: ReturnType<typeof businessCoverageSummary> = null;
    if (packet) {
      try {
        const snapshot = JSON.parse(packet.snapshotJson) as {
          portalFieldMap?: { mappingGaps?: unknown };
          business?: BusinessPacket;
        };
        const pensionError = await pensionPacketValidationError(snapshot, draft.id, draft.userId, { allowManual: true });
        if (pensionError) return { success: false, error: pensionError };
        businessCoverage = businessCoverageSummary(snapshot.business);
        mappingGaps = snapshot.portalFieldMap?.mappingGaps ?? null;
      } catch {
        mappingGaps = null;
      }
    }

    return {
      success: true,
      // Money leaves the database layer as a plain number: Decimal is not
      // JSON-serialisable to the client and misbehaves with `+` and `if`.
      packet: packet
        ? {
            ...serializePacketMoney(packet),
            pdfUrl: packet.fileUrl ? `/api/packets/${packet.id}` : null,
            mappingGaps,
            businessCoverage,
          }
        : null,
    };
  } catch (error) {
    console.error("Error fetching filing packet:", error);
    return { success: false, error: "Failed to fetch filing packet" };
  }
}

/**
 * `acceptUnmappedPortalSources` is the practitioner's explicit override of the
 * coverage gate: the packet is generated, the amounts that IRIS will not be filled
 * for stay listed in the snapshot, and the wizard says so. Without it the gate
 * refuses, because a packet that quietly omits priced income is worse than no
 * packet.
 */
export async function generateFilingPacketAction(
  draftId: string,
  options?: { acceptUnmappedPortalSources?: boolean },
) {
  try {
    const draft = await getOwnedDraft(draftId);
    const [
      draftData,
      documents,
      ledgerEntries,
      latestPacket,
      taxCredits,
      salaryCertificate,
      bankProfitCertificate,
      businessSelections,
      pensionSelections,
      businessBalanceSheet,
      businessBooks,
    ] = await Promise.all([
      prisma.filingDraft.findUnique({
        where: { id: draft.id },
        select: {
          taxYear: true,
          status: true,
          filerType: true,
          businessStructure: true,
          residencyStatus: true,
          incomeSources: true,
          readinessChecks: true,
          openingWealth: true,
          closingWealth: true,
          reconciliationGap: true,
          reconciliationStatus: true,
          reconciliationMethod: true,
          reconciliationNote: true,
          taxableIncome: true,
          taxWithheld: true,
          taxPayable: true,
          refundDue: true,
          taxCalculationStatus: true,
          taxpayerListStatus: true,
          taxpayerListStatusSource: true,
          taxpayerListStatusCheckedAt: true,
          taxRuleSetVersion: true,
          taxCalculationRevision: true,
          packetApprovalConfirmed: true,
        },
      }),
      prisma.document.findMany({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
        },
        select: {
          documentType: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          extractionStatus: true,
        },
      }),
      prisma.ledgerEntry.findMany({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          entryDate: true,
          entryType: true,
          category: true,
          description: true,
          amount: true,
          source: true,
          sourceTransactionId: true,
          bankAccountId: true,
        },
      }),
      prisma.filingPacket.findFirst({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
        },
        orderBy: { version: "desc" },
        select: { id: true, version: true, approvalStatus: true },
      }),
      prisma.filingTaxCredit.findMany({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
        },
        select: {
          id: true,
          section: true,
          subcategory: true,
          amount: true,
          source: true,
        },
      }),
      prisma.document.findFirst({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
          documentType: "salary_certificate",
          extractionStatus: "MAPPED",
        },
        select: { extractedData: true },
      }),
      prisma.document.findFirst({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
          documentType: "bank_certificate",
          extractionStatus: "MAPPED",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, extractedData: true },
      }),
      prisma.filingIncomeSelection.findMany({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
          source: "business",
        },
        select: { source: true, subcategory: true, detailsJson: true },
      }),
      prisma.filingIncomeSelection.findMany({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
          source: "pension",
          status: "SELECTED",
        },
        select: { subcategory: true, detailsJson: true },
      }),
      prisma.document.findFirst({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
          documentType: "business_balance_sheet",
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, extractedData: true, extractionStatus: true },
      }),
      prisma.document.findMany({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
          documentType: "business_books",
          extractionStatus: "MAPPED",
        },
        select: { id: true, extractedData: true, extractionStatus: true },
      }),
    ]);

    if (!draftData) {
      return { success: false, error: "Filing draft not found" };
    }

    if (
      draftData.residencyStatus !== "resident" &&
      draftData.residencyStatus !== "non_resident"
    ) {
      return {
        success: false,
        error:
          "Missing filing context: select Resident or Non-Resident before generating the packet",
      };
    }

    if (
      draftData.taxCalculationStatus !== "ESTIMATE" ||
      !["ATL", "NON_ATL", "LATE_FILER"].includes(
        draftData.taxpayerListStatus ?? "",
      ) ||
      !draftData.taxRuleSetVersion ||
      !draftData.taxCalculationRevision
    ) {
      return {
        success: false,
        error:
          "Calculate a current ATL, Late Filer or Non-ATL tax estimate first",
      };
    }

    // Re-read authoritative document/account/statement/transaction state at
    // packet-generation time. A stale approval checkbox must never be enough
    // to create a packet after account data becomes incomplete.
    const [completeness, reconciliation] = await Promise.all([
      validateFilingCompleteness({
        draftId: draft.id,
        userId: draft.userId,
      }),
      validateAuthoritativeReconciliation({
        draftId: draft.id,
        userId: draft.userId,
      }),
    ]);
    const integrityBlockers = Array.from(
      new Set([
        ...completeness.blockers,
        ...("blockers" in reconciliation ? reconciliation.blockers : []),
      ]),
    );
    if (integrityBlockers.length > 0) {
      return { success: false, error: integrityBlockers.join(" · ") };
    }

    if (!draftData.packetApprovalConfirmed) {
      return {
        success: false,
        error: "Approve the filing data before generating the final packet",
      };
    }

    const parsedIncomeSources = JSON.parse(draftData.incomeSources) as string[];
    const parsedReadinessChecks = JSON.parse(
      draftData.readinessChecks,
    ) as string[];
    const salaryCertificateTaxWithheld = extractMappedSalaryWithholding(
      salaryCertificate?.extractedData ?? null,
    );
    const salaryCertificateGrossSalary = extractMappedSalaryGross(
      salaryCertificate?.extractedData ?? null,
    );
    let bankProfitSource: BankProfitPortalSource | undefined;
    if (parsedIncomeSources.includes("bank_profit")) {
      if (!bankProfitCertificate) {
        return {
          success: false,
          error:
            "Map and approve the Bank Profit Certificate before generating the IRIS packet.",
        };
      }
      let payload: {
        fields?: Array<{ label?: unknown; value?: unknown }>;
        approvedBankProfitCertificate?: ApprovedBankProfitCertificate;
      };
      try {
        payload = JSON.parse(bankProfitCertificate.extractedData || "{}");
      } catch {
        return {
          success: false,
          error: "The approved Bank Profit Certificate is unreadable. Re-map it before filing.",
        };
      }
      const approved = readApprovedBankProfitCertificate(
        payload.fields,
        draftData.taxYear,
      );
      if (!approved || !payload.approvedBankProfitCertificate) {
        return {
          success: false,
          error: "The Bank Profit Certificate is not currently approved. Review and map it again.",
        };
      }
      const certificateSubcategory = bankProfitSubcategoryFromCertificate(approved);
      if (!certificateSubcategory) {
        return {
          success: false,
          error:
            "The approved Bank Profit Certificate does not identify a supported Section 151 category. Review its printed section/instrument fields.",
        };
      }
      const calculationLines = await prisma.filingTaxCalculationLine.findMany({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
          calculationRevision: draftData.taxCalculationRevision,
          source: "bank_profit",
        },
        select: {
          subcategory: true,
          taxBase: true,
          calculatedTax: true,
        },
      });
      if (calculationLines.length !== 1) {
        return {
          success: false,
          error:
            "The current calculation must contain exactly one Bank Profit line before IRIS mapping. Recalculate Tax.",
        };
      }
      const calculationLine = calculationLines[0];
      if (calculationLine.subcategory !== certificateSubcategory) {
        return {
          success: false,
          error: `Bank Profit selection (${calculationLine.subcategory}) does not match the approved certificate (${certificateSubcategory}). Correct the selection or certificate and recalculate Tax.`,
        };
      }
      const statementGrossProfit = toMoneyNumber(calculationLine.taxBase);
      const currentLedgerGrossProfit = toMoneyNumber(
        sumMoney(
          ledgerEntries
            .filter(
              (entry) =>
                entry.entryType === "INCOME" &&
                ["BANK_PROFIT", "PROFIT_ON_DEBT"].includes(
                  normalizeLedgerCategory(entry.category),
                ),
            )
            .map((entry) => entry.amount),
        ),
      );
      if (currentLedgerGrossProfit !== statementGrossProfit) {
        return {
          success: false,
          error:
            "Bank-statement profit changed after the saved calculation. Recalculate Tax before generating the IRIS packet.",
        };
      }
      if (statementGrossProfit !== approved.grossAnnualProfit) {
        return {
          success: false,
          error: `Bank-statement profit (PKR ${statementGrossProfit.toLocaleString("en-PK")}) does not match the approved certificate gross (PKR ${approved.grossAnnualProfit.toLocaleString("en-PK")}). Reconcile them before IRIS entry.`,
        };
      }
      const investment = approved.instrumentCategory.trim();
      if (investment.length > 50) {
        return {
          success: false,
          error:
            "The approved Bank Profit instrument/category is longer than the 50 characters accepted by IRIS. Shorten it to the certificate's concise printed category and approve it again.",
        };
      }
      bankProfitSource = {
        documentId: bankProfitCertificate.id,
        subcategory: calculationLine.subcategory as BankProfitSubcategory,
        investment,
        contents: [
          `1. ${approved.iban || approved.accountNumber}`,
          `2. ${approved.instrumentCategory.trim()}`,
          `3. ${approved.bankName.trim()}`,
        ].join("\n"),
        statementGrossProfit,
        taxDeducted: approved.taxDeducted,
        taxChargeable: toMoneyNumber(calculationLine.calculatedTax),
      };
    }

    const bankAccountsForPacket = await prisma.bankAccount.findMany({
      where: { filingDraftId: draft.id, userId: draft.userId },
      select: { id: true, iban: true },
    });

    // A gift's donor number lives on the bank transaction it came from; the
    // ledger entry only points back at it.
    const giftSourceIds = ledgerEntries
      .filter((e) => isGiftCategory(e.category) && e.sourceTransactionId)
      .map((e) => e.sourceTransactionId as string);
    const giftDonorByTransaction = new Map<string, string | null>(
      giftSourceIds.length === 0
        ? []
        : (
            await prisma.bankTransaction.findMany({
              where: {
                id: { in: giftSourceIds },
                filingDraftId: draft.id,
                userId: draft.userId,
              },
              select: { id: true, giftDonorId: true },
            })
          ).map((t) => [t.id, t.giftDonorId] as [string, string | null]),
    );

    let business: BusinessPacket;
    try {
      business = buildBusinessPacket({
        taxYear: draftData.taxYear,
        filerType: draftData.filerType,
        incomeSources: parsedIncomeSources,
        selections: businessSelections,
        balanceSheet: businessBalanceSheet,
        books: businessBooks,
      });
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Review the business schedules before generating a new packet.",
      };
    }
    const businessBankEntries = ledgerEntries.filter((entry) =>
      isBusinessBankCategory(entry.category),
    );
    const businessBankAccountIds = new Set(
      businessBankEntries.map((entry) => entry.bankAccountId).filter(Boolean),
    );
    const unscopedBusinessBankEntries = businessBankEntries.some(
      (entry) => !entry.bankAccountId,
    );
    let pensionSource: PensionSource | null = null;
    if (parsedIncomeSources.includes("pension")) {
      const latestPensionStatement = await prisma.document.findFirst({
        where: { filingDraftId: draft.id, userId: draft.userId, documentType: "pension_statement" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, extractionStatus: true, extractedData: true },
      });
      const formerEmployerSelection = pensionSelections.find(s => s.subcategory === TY2026_PENSION_FORMER_EMPLOYER_SUBCATEGORY);
      const taxAsSalary = formerEmployerSelection
        ? resolvePensionFormerEmployerAnswer({ details: parsePersistedSelectionUserDetails(formerEmployerSelection.detailsJson) ?? undefined }) === "yes"
        : false;
      const category = normalizeLedgerCategory;
      try {
        pensionSource = resolveApprovedPensionSource({
          document: latestPensionStatement, taxYear: draftData.taxYear,
          profile: { dateOfBirth: draft.taxpayerDateOfBirth, cnic: draft.taxpayerCnic },
          taxAsSalary,
          ledgerPension: sumMoney(ledgerEntries.filter(e => e.entryType === "INCOME" && category(e.category) === "PENSION").map(e => e.amount)),
          ledgerTaxWithheld: sumMoney(ledgerEntries.filter(e => e.entryType === "EXPENSE" && category(e.category) === "TAX_PAYMENT").map(e => e.amount)),
        });
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Review the latest Pension Statement." };
      }
      if (pensionSource.treatment === "unknown_age") return { success: false, error: "Confirm profile/CNIC date of birth and recalculate the above-10M pension before generating a packet." };
      // Bind the current source, Yes/No answer and profile age to the exact
      // calculation revision. Never generate a new map around old tax totals.
      const lines = await prisma.filingTaxCalculationLine.findMany({
        where: { filingDraftId: draft.id, userId: draft.userId, calculationRevision: draftData.taxCalculationRevision, source: { in: ["pension", "combined_slab"] } },
        select: { detailsJson: true },
      });
      const currentFingerprint = pensionSource.fingerprint;
      const matchesSource = lines.some(line => {
        try { return JSON.parse(line.detailsJson).pensionSource?.fingerprint === currentFingerprint; } catch { return false; }
      });
      if (!matchesSource) return { success: false, error: "Pension source, profile age or answer changed (or this is an older calculation). Recalculate Tax and approve a fresh pension packet." };
    }

    // Build portalFieldMap using IRIS codes for Electron agent
    const portalFieldMap = buildPortalFieldMap({
      taxYear: draftData.taxYear,
      filerType: draftData.filerType,
      taxpayerListStatus: draftData.taxpayerListStatus,
      businessBankEntriesCoveredByDeclaredProfit:
        Boolean(business) && isMyselfBusinessBankFlow(draftData),
      ledgerEntries: ledgerEntries.map((e) => ({
        id: e.id,
        entryType: e.entryType,
        category: e.category,
        description: e.description,
        amount: e.amount as any,
        date: e.entryDate,
        giftDonorId: e.sourceTransactionId
          ? (giftDonorByTransaction.get(e.sourceTransactionId) ?? null)
          : null,
      })),
      taxCredits: taxCredits.map((c) => ({
        id: c.id,
        section: c.section,
        subcategory: c.subcategory,
        amount: c.amount as any,
        source: c.source,
      })),
      taxableIncome: draftData.taxableIncome
        ? Number(draftData.taxableIncome)
        : 0,
      taxWithheld: draftData.taxWithheld ? Number(draftData.taxWithheld) : 0,
      pensionSource: pensionSource ?? undefined,
      bankProfitSource,
      salaryCertificateTaxWithheld,
      salaryCertificateGrossSalary,
      // Employers named on the reviewed salary certificate; the agent adds
      // each one by name on the IRIS Salary page.
      employers: extractMappedSalaryEmployers(
        salaryCertificate?.extractedData ?? null,
      ),
      // Net cash moved out of the bank; becomes a 7012 Cash in hand movement.
      netCashMovement:
        "preview" in reconciliation && reconciliation.preview
          ? reconciliation.preview.netCashMovement
          : null,
      // Wealth Statement bank rows (7030): IBAN + closing balance per account.
      bankAccounts:
        "preview" in reconciliation && reconciliation.preview
          ? reconciliation.preview.accountBalances.flatMap((balance) => {
              const account = bankAccountsForPacket.find(
                (candidate) => candidate.id === balance.bankAccountId,
              );
              return account?.iban
                ? [
                    {
                      iban: account.iban,
                      bankName: balance.bankName,
                      accountLabel: balance.accountLabel,
                      closingBalance: balance.closingBalance,
                      ownershipReviewRequired:
                        unscopedBusinessBankEntries ||
                        businessBankAccountIds.has(balance.bankAccountId),
                    },
                  ]
                : [];
            })
          : [],
    });
    if (business) {
      if (businessBankEntries.length)
        business.pending.push({
          key: "businessBankAccountOwnership",
          amount: null,
          reason:
            "Accounts with business cash records need business/personal/mixed ownership review. Their balances are not automatically written as personal Wealth bank rows; complete the appropriate business/account detail and reconciliation manually.",
        });
      portalFieldMap.businessFields = business.fields;
      portalFieldMap.totalFields += business.fields.length;
      for (const item of business.pending) {
        if (item.amount !== null && item.amount > 0) {
          portalFieldMap.mappingGaps.unmappedCategories.push({
            category: `BUSINESS_${item.key}`,
            entryIds: [],
            totalAmount: item.amount,
            reason: item.reason,
          });
        }
      }
    }
    const routeMetadata = buildPacketRouteMetadata({
      taxYear: draftData.taxYear,
      filerType: draftData.filerType,
      businessStructure: draftData.businessStructure,
      incomeSources: parsedIncomeSources,
    });

    // A packet whose income the portal cannot carry must not be filed as if it
    // were complete. `unmappedCategories` means the ENGINE priced that income (so
    // taxCalculationStatus is ESTIMATE and every money gate above passes) while
    // the PORTAL map has no verified IRIS line for it — a business/services/
    // capital-gains taxpayer would otherwise generate a salary-only packet, have
    // the agent fill it cleanly, and file a return that quietly omits income.
    const coverageGate = describeUnmappedPortalSources(portalFieldMap.mappingGaps);
    if (coverageGate.blocked.length > 0 && !options?.acceptUnmappedPortalSources) {
      return {
        success: false,
        error: coverageGate.refusal,
        // The UI offers the override from these same numbers, never from its own
        // copy of them.
        unmappedPortalSources: coverageGate.blocked,
      };
    }
    const coverage = business
      ? {
          ...coverageGate.coverage,
          mode: "partial_manual_entry_required" as const,
          acceptedByOperator: options?.acceptUnmappedPortalSources === true,
          unmappedSources: coverageGate.blocked,
          businessCoverage: business.coverage,
          businessPending: business.pending,
        }
      : coverageGate.coverage;

    const snapshot = {
      generatedAt: new Date().toISOString(),
      filing: {
        ...draftData,
        status:
          latestPacket?.approvalStatus === "APPROVED"
            ? "IN_PROGRESS"
            : draftData.status,
        incomeSources: parsedIncomeSources,
        readinessChecks: parsedReadinessChecks,
      },
      documents,
      ledgerEntries,
      taxCredits,
      routeMetadata,
      portalFieldMap,
      ...(pensionSource ? { pension: pensionSource } : {}),
      business,
      coverage,
    };

    const snapshotJson = JSON.stringify(snapshot);
    const packetHash = createHash("sha256").update(snapshotJson).digest("hex");
    const version = (latestPacket?.version ?? 0) + 1;

    const packet = await prisma.$transaction(async (tx) => {
      if (latestPacket?.approvalStatus === "APPROVED") {
        await tx.filingPacket.update({
          where: { id: latestPacket.id },
          data: {
            approvalStatus: "SUPERSEDED",
            status: "SUPERSEDED",
          },
        });

        await tx.filingDraft.update({
          where: { id: draft.id },
          data: { status: "IN_PROGRESS" },
        });
      }

      return tx.filingPacket.create({
        data: {
          filingDraftId: draft.id,
          userId: draft.userId,
          version,
          packetHash,
          snapshotJson,
          status: "GENERATED",
          approvalStatus: "APPROVED",
          approvedAt: new Date(),
          approvedByUserId: draft.userId,
          taxPayable: draftData.taxPayable ?? 0,
          refundDue: draftData.refundDue ?? 0,
        },
        select: {
          id: true,
          version: true,
          packetHash: true,
          status: true,
          approvalStatus: true,
          taxPayable: true,
          refundDue: true,
          createdAt: true,
        },
      });
    });

    await prisma.filingDraft.update({
      where: { id: draft.id },
      data: { status: "APPROVED_FOR_FILING" },
    });

    await createNotification({
      userId: draft.userId,
      type: "FILING_STATUS",
      title: `Filing packet v${version} generated`,
      message: `Tax year ${draftData.taxYear} packet is ready for your review.`,
      link: `/tax/new?draftId=${draft.id}`,
    });

    // Same boundary as the fetch action: the client receives numbers.
    // The mapping gaps ride along so the practitioner sees, BEFORE approving,
    // which income the portal will not be filled for — the alternative is finding
    // out from an empty IRIS grid during a filing window.
    const mappingGaps =
      (snapshot.portalFieldMap && snapshot.portalFieldMap.mappingGaps) || null;
    return {
      success: true,
      packet: {
        ...serializePacketMoney(packet),
        mappingGaps,
        coverage,
        businessCoverage: businessCoverageSummary(business),
      },
    };
  } catch (error) {
    console.error("Error generating filing packet:", error);
    return { success: false, error: "Failed to generate filing packet" };
  }
}

export async function generateFilingPacketPdfAction(draftId: string) {
  try {
    const draft = await getOwnedDraft(draftId);
    const [packet, completeness, reconciliation] = await Promise.all([
      prisma.filingPacket.findFirst({
        where: {
          filingDraftId: draft.id,
          userId: draft.userId,
          status: { not: "SUPERSEDED" },
        },
        orderBy: { version: "desc" },
      }),
      validateFilingCompleteness({
        draftId: draft.id,
        userId: draft.userId,
      }),
      validateAuthoritativeReconciliation({
        draftId: draft.id,
        userId: draft.userId,
      }),
    ]);

    const integrityBlockers = Array.from(
      new Set([
        ...completeness.blockers,
        ...("blockers" in reconciliation ? reconciliation.blockers : []),
      ]),
    );
    if (integrityBlockers.length > 0) {
      return { success: false, error: integrityBlockers.join(" · ") };
    }

    if (!packet) {
      return {
        success: false,
        error: "Generate a current packet snapshot first",
      };
    }

    const pensionError = await pensionPacketValidationError(JSON.parse(packet.snapshotJson), draft.id, draft.userId, { allowManual: true });
    if (pensionError) return { success: false, error: pensionError };
    const pdfBuffer = await buildPacketPdf(packet.snapshotJson);
    const packetDirectory = path.join(process.cwd(), "uploads", "packets");
    await mkdir(packetDirectory, { recursive: true });

    const storedFileName = `${packet.id}.pdf`;
    await writeFile(path.join(packetDirectory, storedFileName), pdfBuffer);

    const fileUrl = `packets/${storedFileName}`;
    await prisma.filingPacket.update({
      where: { id: packet.id },
      data: { fileUrl },
    });

    return {
      success: true,
      pdfUrl: `/api/packets/${packet.id}`,
      version: packet.version,
    };
  } catch (error) {
    console.error("Error generating filing packet PDF:", error);
    return { success: false, error: "Failed to generate filing packet PDF" };
  }
}
