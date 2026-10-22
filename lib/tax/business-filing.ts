import { buildReviewedBusinessSchedules } from "./business-schedule-fields";
import type { Prisma } from "@prisma/client";
import contract from "@/electron-connect/iris-business-contract.json";
import { computeBusinessProfit } from "./business-profit";
import type { PortalFieldMapEntry } from "./portal-field-map";
import type { Ty2026SelectionUserDetails } from "./rules/ty2026/subcategories";

export const BUSINESS_BALANCE_SHEET_TYPE = "business_balance_sheet";
export const BUSINESS_BALANCE_LABELS = {
  businessName: "Business Name",
  taxYear: "Tax Year",
  closingDate: "Balance Sheet Date",
  currency: "Currency",
  totalAssets: "Total Assets",
  totalEquityLiabilities: "Total Equity and Liabilities",
  plant: "Plant / Machinery / Equipment / Furniture",
  stock: "Stocks / Stores / Spares",
  advances: "Advances / Deposits / Prepayments",
  cash: "Business Cash in Hand",
  securities: "Bonds / Securities",
  otherAssets: "Other Business Assets",
  capital: "Owner Capital",
  loans: "Long Term Borrowings / Debt / Loan",
  payables: "Trade Creditors / Payables",
  otherLiabilities: "Other Business Liabilities",
  land: "Business Land",
  building: "Business Building",
  bank: "Business Bank Balance",
  vehicle: "Business Motor Vehicles",
} as const;
const scalarCodes = {
  plant: "3303",
  stock: "3315",
  advances: "3312",
  cash: "3319",
  securities: "3321",
  otherAssets: "3348",
  capital: "3352",
  loans: "3371",
  payables: "3384",
  otherLiabilities: "3398",
} as const;
const assetKeys = [
  "plant",
  "stock",
  "advances",
  "cash",
  "securities",
  "otherAssets",
  "land",
  "building",
  "bank",
  "vehicle",
] as const;
const liabilityKeys = [
  "capital",
  "loans",
  "payables",
  "otherLiabilities",
] as const;
const norm = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export type BusinessField = {
  label?: unknown;
  value?: unknown;
  confidence?: unknown;
};
function payload(raw: unknown): { fields: BusinessField[] } {
  const p = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    !p ||
    typeof p !== "object" ||
    !Array.isArray((p as { fields?: unknown }).fields)
  )
    throw new Error("Business Balance Sheet has no reviewed fields.");
  return p as { fields: BusinessField[] };
}
function get(fields: BusinessField[], label: string): unknown {
  const matches = fields.filter((f) => norm(f.label) === norm(label));
  if (matches.length > 1)
    throw new Error(`Duplicate Balance Sheet field: ${label}.`);
  return matches[0]?.value;
}
function amount(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n =
    typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0)
    throw new Error(
      "Balance Sheet amounts must be non-negative numbers; missing amounts must stay blank.",
    );
  return Math.round(n * 100) / 100;
}
export function ensureBusinessBalanceReviewFields(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const p = raw as Record<string, unknown>;
  const fields: BusinessField[] = Array.isArray(p.fields)
    ? p.fields.filter((f) => f && typeof f === "object")
    : [];
  for (const label of Object.values(BUSINESS_BALANCE_LABELS)) {
    if (!fields.some((f) => norm(f.label) === norm(label)))
      fields.push({ label, value: null, confidence: 0 });
  }
  return { ...p, fields };
}
export function readBusinessBalanceSheet(raw: unknown, taxYear: number) {
  const { fields } = payload(raw);
  const name = String(
    get(fields, BUSINESS_BALANCE_LABELS.businessName) ?? "",
  ).trim();
  const year = Number(get(fields, BUSINESS_BALANCE_LABELS.taxYear));
  const date = String(
    get(fields, BUSINESS_BALANCE_LABELS.closingDate) ?? "",
  ).trim();
  const currency = String(get(fields, BUSINESS_BALANCE_LABELS.currency) ?? "")
    .trim()
    .toUpperCase();
  if (!name) throw new Error("Enter the Business Name on the Balance Sheet.");
  if (year !== taxYear || date !== `${taxYear}-06-30`)
    throw new Error(
      `Balance Sheet must be for TY${taxYear}, closing ${taxYear}-06-30 (normal full-year individual return).`,
    );
  if (currency !== "PKR")
    throw new Error(
      "Only a PKR Business Balance Sheet is supported; do not silently convert currencies.",
    );
  const amounts: Record<string, number | null> = {};
  for (const [key, label] of Object.entries(BUSINESS_BALANCE_LABELS)) {
    if (!["businessName", "taxYear", "closingDate", "currency"].includes(key))
      amounts[key] = amount(get(fields, label));
  }
  const assets = amounts.totalAssets,
    liabilities = amounts.totalEquityLiabilities;
  if (
    assets === null ||
    liabilities === null ||
    Math.abs(assets - liabilities) > 0.01
  )
    throw new Error(
      "Enter matching Total Assets and Total Equity and Liabilities; no automatic balancing amount is created.",
    );
  const knownAssetTotal = assetKeys.reduce((s, k) => s + (amounts[k] ?? 0), 0);
  const knownLiabilityTotal = liabilityKeys.reduce(
    (s, k) => s + (amounts[k] ?? 0),
    0,
  );
  if (
    knownAssetTotal > assets + 0.01 ||
    knownLiabilityTotal > liabilities + 0.01
  )
    throw new Error(
      "Balance Sheet detail exceeds the declared total; review classifications and duplicates.",
    );
  const gaps: string[] = [];
  if (assetKeys.some((k) => amounts[k] === null))
    gaps.push(
      "Missing asset breakdown: blanks are not treated as confirmed zero.",
    );
  if (liabilityKeys.some((k) => amounts[k] === null))
    gaps.push(
      "Missing capital/liability breakdown: blanks are not treated as confirmed zero.",
    );
  if (Math.abs(knownAssetTotal - assets) > 0.01)
    gaps.push("Asset breakdown does not yet reconcile to Total Assets.");
  if (Math.abs(knownLiabilityTotal - liabilities) > 0.01)
    gaps.push(
      "Capital/liability breakdown does not yet reconcile to its total.",
    );
  return {
    version: "1.0",
    businessName: name,
    taxYear: year,
    closingDate: date,
    currency,
    amounts,
    gaps,
  };
}
export type BusinessPacket = ReturnType<typeof buildBusinessPacket>;
export function buildBusinessPacket(input: {
  taxYear: number;
  filerType: string | null;
  incomeSources: string[];
  selections: { source: string; subcategory: string; detailsJson: string }[];
  books?: {
    id: string;
    extractedData: string | null;
    extractionStatus: string;
  }[];
  balanceSheet?: {
    id: string;
    extractedData: string | null;
    extractionStatus: string;
  } | null;
}) {
  if (!input.incomeSources.includes("business")) return null;
  if (input.taxYear !== 2026 || input.filerType !== "myself")
    throw new Error(
      "Verified business entry currently supports Myself / TY2026 only.",
    );
  const selections = input.selections.filter(
    (s) => s.source === "business" && s.subcategory === "profit-return",
  );
  if (selections.length !== 1)
    throw new Error(
      "Business packet needs exactly one approved Business Profit selection.",
    );
  const parsed = JSON.parse(selections[0].detailsJson);
  const raw = parsed?.userDetails;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(
      "Business Profit details are missing; regenerate the packet after reviewing the business form.",
    );
  const keys = [
    "businessGrossSales",
    "businessOtherRevenue",
    "businessCostOfSales",
    "businessOperatingExpenses",
    "businessDepreciation",
    "businessInadmissibleExpenses",
    "businessLossBroughtForward",
    "businessWithholdingDeducted",
  ];
  const approvedInputs: Record<string, number | null> = {};
  for (const key of keys) approvedInputs[key] = amount(raw[key]);
  if (
    approvedInputs.businessGrossSales === null ||
    approvedInputs.businessGrossSales <= 0
  )
    throw new Error(
      "A reviewed positive annual Sales amount is required for the current business estimate.",
    );
  const excludesSalesTaxes = raw.businessSalesExcludeIndirectTax === true;
  const fields: PortalFieldMapEntry[] = [];
  const pending: { key: string; amount: number | null; reason: string }[] = [];
  const queue = (
    code: string,
    value: number,
    sectionId: keyof typeof contract,
    source: string,
  ) => {
    const spec = contract[sectionId];
    const row = (
      spec.rows as Record<string, { label: string; disabled: boolean[] }>
    )[code];
    if (!row || row.disabled[0])
      throw new Error(
        `Business code ${code} has no proven first editable column.`,
      );
    fields.push({
      ourCategory: source,
      ourDescription: source,
      ourAmount: value,
      irisCode: code,
      irisDescription: row.label,
      portalArea: "Business",
      section: spec.tab,
      column:
        sectionId === "business_balance_sheet" ? "Amount" : "Total Amount",
      isTaxField: false,
      sourceEntryCount: 1,
    });
  };
  if (excludesSalesTaxes)
    queue(
      "3009",
      approvedInputs.businessGrossSales,
      "business_trading",
      "BUSINESS_GROSS_SALES",
    );
  else
    pending.push({
      key: "businessGrossSales",
      amount: approvedInputs.businessGrossSales,
      reason:
        "Confirm on Business Profit that sales exclude Sales Tax/FED before queuing IRIS 3009.",
    });
  const reasons: Record<string, string> = {
    businessOtherRevenue:
      "Other revenue needs its source breakdown; do not guess the aggregate into Others (3128).",
    businessCostOfSales:
      "Cost of sales is a computed total (3030); opening stock, purchases, direct costs and closing stock are required.",
    businessOperatingExpenses:
      "Admin expenses need head-wise breakdown; the total (3199) is computed.",
    businessDepreciation:
      "Book/tax depreciation and asset detail must be distinguished; no assumed 3248 write.",
    businessInadmissibleExpenses:
      "Add-backs require their specific reason/line; no guessed Other deduction.",
    businessLossBroughtForward:
      "Prior losses require origin-year/eligibility details.",
    businessWithholdingDeducted:
      "Business tax deducted needs section/regime/detail evidence, not a universal credit.",
  };
  for (const [key, reason] of Object.entries(reasons)) {
    if (approvedInputs[key] === null || approvedInputs[key]! > 0)
      pending.push({
        key,
        amount: approvedInputs[key],
        reason:
          approvedInputs[key] === null
            ? `Not provided (not confirmed zero). ${reason}`
            : reason,
      });
  }
  let balanceSheet: ReturnType<typeof readBusinessBalanceSheet> | null = null;
  if (input.balanceSheet) {
    if (input.balanceSheet.extractionStatus !== "MAPPED")
      throw new Error(
        "Review and map the uploaded Business Balance Sheet before generating a new packet.",
      );
    balanceSheet = readBusinessBalanceSheet(
      input.balanceSheet.extractedData,
      input.taxYear,
    );
    for (const [key, code] of Object.entries(scalarCodes)) {
      const value = balanceSheet.amounts[key];
      if (value !== null)
        queue(
          code,
          value,
          "business_balance_sheet",
          `BUSINESS_BALANCE_${key.toUpperCase()}`,
        );
    }
    for (const key of ["land", "building", "bank", "vehicle"]) {
      if (balanceSheet.amounts[key] === null || balanceSheet.amounts[key]! > 0)
        pending.push({
          key: `balanceSheet.${key}`,
          amount: balanceSheet.amounts[key],
          reason:
            "Needs verified business asset/account detail flow; not routed to personal Wealth Statement.",
        });
    }
    for (const reason of balanceSheet.gaps)
      pending.push({ key: "balanceSheet.breakdown", amount: null, reason });
  } else
    pending.push({
      key: "balanceSheet",
      amount: null,
      reason:
        "Business Balance Sheet not supplied; remaining asset/capital/liability review is manual.",
    });
  if ((input.books?.length ?? 0) > 1)
    throw new Error(
      "Keep one current approved Business Books document; duplicate schedules cannot be summed.",
    );
  const schedules = input.books?.[0]
    ? buildReviewedBusinessSchedules({
        taxYear: input.taxYear,
        approvedInputs,
        salesExcludeIndirectTax: excludesSalesTaxes,
        document: input.books[0],
      })
    : null;
  if (schedules) {
    if (
      balanceSheet &&
      norm(balanceSheet.businessName) !== norm(schedules.businessName)
    )
      throw new Error(
        "Business Books and Balance Sheet have different business names; review identity before forwarding.",
      );
    fields.push(...schedules.fields);
    for (const key of schedules.completed) {
      const index = pending.findIndex((item) => item.key === key);
      if (index >= 0) pending.splice(index, 1);
    }
    if (schedules.fields.some((field) => field.irisCode === "3088")) {
      const depreciation = pending.find(
        (item) => item.key === "businessDepreciation",
      );
      if (depreciation)
        depreciation.reason =
          "Accounting depreciation is queued in 3088. Tax depreciation / initial allowance in computed 3248 still needs a verified asset schedule; it is not auto-copied from book depreciation.";
    }
    for (const reason of schedules.notes)
      pending.push({ key: "businessScheduleReview", amount: null, reason });
  }
  // Partial by design until the business identity, full schedules and derived
  // profit/readback are verified. This is never a ready-to-submit certificate.
  pending.push({
    key: "businessFinalReview",
    amount: null,
    reason:
      "Verify the saved business identity and principal activity, remaining schedules, calculated profit/tax and final reconciliation in FBR yourself.",
  });
  return {
    version: schedules?.fields.length
      ? "business-entry-v2"
      : "business-entry-v1",
    taxYear: input.taxYear,
    approvedInputs,
    computedEstimate: computeBusinessProfit(raw as Ty2026SelectionUserDetails),
    salesExcludeIndirectTax: excludesSalesTaxes,
    schedules,
    balanceSheet,
    balanceSheetDocumentId: input.balanceSheet?.id ?? null,
    fields,
    pending,
    coverage: "partial_manual_required" as const,
  };
}

/** An optional Business Balance Sheet change must never leave old figures approved. */
export async function invalidateBusinessBalancePackets(
  tx: Pick<Prisma.TransactionClient, "filingPacket" | "filingDraft">,
  filingDraftId: string,
  userId: string,
) {
  await tx.filingPacket.updateMany({
    where: { filingDraftId, userId, status: { not: "SUPERSEDED" } },
    data: { status: "SUPERSEDED", approvalStatus: "SUPERSEDED" },
  });
  await tx.filingDraft.update({
    where: { id: filingDraftId },
    data: {
      packetApprovalConfirmed: false,
      packetApprovalAt: null,
      packetApprovalByUserId: null,
      status: "IN_PROGRESS",
    },
  });
}

export function businessCoverageSummary(business?: BusinessPacket | null) {
  return business
    ? {
        status: business.coverage,
        queuedFields: business.fields.length,
        pending: business.pending.map((item) => `${item.key}: ${item.reason}`),
      }
    : null;
}
