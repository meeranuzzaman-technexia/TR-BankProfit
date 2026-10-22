import { validatePakistaniIban, normalizeIban } from "./iban";
import { parseTaxpayerDateOfBirth } from "./taxpayer-age";
import { getTaxYearStatementRange } from "./tax-year-period";

export const BANK_PROFIT_CERTIFICATE_LABELS = {
  taxYear: "Tax Year",
  reportingPeriodStart: "Reporting Period Start",
  reportingPeriodEnd: "Reporting Period End",
  bankName: "Bank / Financial Institution Name",
  bankNtn: "Bank NTN",
  taxpayerName: "Taxpayer Name",
  taxpayerCnic: "Taxpayer CNIC",
  taxpayerNtn: "Taxpayer NTN",
  accountNumber: "Account Number",
  iban: "IBAN",
  instrumentCategory: "Instrument / Category",
  printedSectionSubsection: "Printed Section / Subsection",
  grossAnnualProfit: "Gross Annual Profit / Yield",
  taxDeducted: "Tax Deducted / Withheld",
  withholdingRate: "Bank-applied Withholding Rate (%)",
  atlStatus: "ATL / Non-ATL Status",
  netProfitCredited: "Net Profit Credited",
  currency: "Currency",
  sukukHolderType: "Sukuk Holder Type (Company / Individual / AOP)",
  sukukReturnBand: "Sukuk Return Band (Above / Below PKR 1M)",
} as const;

export type BankProfitCertificateFieldKind =
  keyof typeof BANK_PROFIT_CERTIFICATE_LABELS;
export type BankProfitCertificateReviewKind =
  | "amount"
  | "positive_amount"
  | "date"
  | "year"
  | "cnic"
  | "currency";

export type BankProfitCertificateFieldDefinition = {
  kind: BankProfitCertificateFieldKind;
  label: string;
  aliases: readonly string[];
  required: boolean | "if_sukuk";
  validationKind?: BankProfitCertificateReviewKind;
  alternativeGroup?: "taxpayer_identity" | "account_identity";
};

/**
 * The review form's canonical bank-profit certificate schema. Extraction
 * labels are mapped to these keys only; the printed legal section, rate and
 * taxpayer-list status remain evidence, not a guessed tax treatment.
 */
export const BANK_PROFIT_CERTIFICATE_FIELD_DEFINITIONS: readonly BankProfitCertificateFieldDefinition[] = [
  { kind: "taxYear", label: BANK_PROFIT_CERTIFICATE_LABELS.taxYear, aliases: ["assessment year", "taxation year"], required: true, validationKind: "year" },
  { kind: "reportingPeriodStart", label: BANK_PROFIT_CERTIFICATE_LABELS.reportingPeriodStart, aliases: ["reporting period from", "period start", "profit period start", "from date"], required: true, validationKind: "date" },
  { kind: "reportingPeriodEnd", label: BANK_PROFIT_CERTIFICATE_LABELS.reportingPeriodEnd, aliases: ["reporting period to", "period end", "profit period end", "to date"], required: true, validationKind: "date" },
  { kind: "bankName", label: BANK_PROFIT_CERTIFICATE_LABELS.bankName, aliases: ["bank name", "financial institution name", "institution name", "bank financial institution name"], required: true },
  { kind: "bankNtn", label: BANK_PROFIT_CERTIFICATE_LABELS.bankNtn, aliases: ["bank ntn number", "financial institution ntn", "institution ntn", "bank tax registration number"], required: true },
  { kind: "taxpayerName", label: BANK_PROFIT_CERTIFICATE_LABELS.taxpayerName, aliases: ["customer name", "account holder name", "name of taxpayer"], required: true },
  { kind: "taxpayerCnic", label: BANK_PROFIT_CERTIFICATE_LABELS.taxpayerCnic, aliases: ["taxpayer cnic number", "customer cnic", "cnic number", "identity number"], required: false, validationKind: "cnic", alternativeGroup: "taxpayer_identity" },
  { kind: "taxpayerNtn", label: BANK_PROFIT_CERTIFICATE_LABELS.taxpayerNtn, aliases: ["taxpayer ntn number", "customer ntn", "taxpayer tax number"], required: false, alternativeGroup: "taxpayer_identity" },
  { kind: "accountNumber", label: BANK_PROFIT_CERTIFICATE_LABELS.accountNumber, aliases: ["account no", "bank account number", "account number/iban"], required: false, alternativeGroup: "account_identity" },
  { kind: "iban", label: BANK_PROFIT_CERTIFICATE_LABELS.iban, aliases: ["account iban", "iban number"], required: false, alternativeGroup: "account_identity" },
  { kind: "instrumentCategory", label: BANK_PROFIT_CERTIFICATE_LABELS.instrumentCategory, aliases: ["instrument", "product category", "investment product", "profit category"], required: true },
  { kind: "printedSectionSubsection", label: BANK_PROFIT_CERTIFICATE_LABELS.printedSectionSubsection, aliases: ["section/subsection", "tax section", "withholding section", "printed tax section"], required: true },
  { kind: "grossAnnualProfit", label: BANK_PROFIT_CERTIFICATE_LABELS.grossAnnualProfit, aliases: ["gross annual profit", "annual gross profit", "annual profit", "annual yield", "gross profit annual pkr"], required: true, validationKind: "positive_amount" },
  { kind: "taxDeducted", label: BANK_PROFIT_CERTIFICATE_LABELS.taxDeducted, aliases: ["tax deducted", "tax withheld", "withholding tax deducted", "tax deducted/withheld"], required: true, validationKind: "amount" },
  { kind: "withholdingRate", label: BANK_PROFIT_CERTIFICATE_LABELS.withholdingRate, aliases: ["bank applied withholding rate", "withholding rate", "withholding tax rate", "wht rate", "tax rate applied"], required: true, validationKind: "amount" },
  { kind: "atlStatus", label: BANK_PROFIT_CERTIFICATE_LABELS.atlStatus, aliases: ["atl status", "non-atl status", "taxpayer status", "atl/non-atl"], required: true },
  { kind: "netProfitCredited", label: BANK_PROFIT_CERTIFICATE_LABELS.netProfitCredited, aliases: ["net profit credited", "net yield credited", "profit credited", "net amount credited"], required: true, validationKind: "amount" },
  { kind: "currency", label: BANK_PROFIT_CERTIFICATE_LABELS.currency, aliases: ["profit currency", "certificate currency"], required: true, validationKind: "currency" },
  { kind: "sukukHolderType", label: BANK_PROFIT_CERTIFICATE_LABELS.sukukHolderType, aliases: ["sukuk holder type", "sukuk holder classification", "sukuk ownership type"], required: "if_sukuk" },
  { kind: "sukukReturnBand", label: BANK_PROFIT_CERTIFICATE_LABELS.sukukReturnBand, aliases: ["sukuk return band", "sukuk profit band"], required: "if_sukuk" },
];

export type BankProfitCertificateFieldLike = {
  label?: unknown;
  value?: unknown;
  confidence?: unknown;
  [key: string]: unknown;
};

function normalizedLabel(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getBankProfitCertificateFieldKind(
  label: unknown,
): BankProfitCertificateFieldKind | null {
  const normalized = normalizedLabel(label);
  if (!normalized) return null;
  const definition = BANK_PROFIT_CERTIFICATE_FIELD_DEFINITIONS.find((field) =>
    [field.label, ...field.aliases].some(
      (candidate) => normalizedLabel(candidate) === normalized,
    ),
  );
  return definition?.kind ?? null;
}

export function bankProfitCertificateFieldValue(
  fields: BankProfitCertificateFieldLike[] | undefined,
  kind: BankProfitCertificateFieldKind,
): unknown {
  return fields?.find(
    (field) => getBankProfitCertificateFieldKind(field.label) === kind,
  )?.value;
}

function isMissing(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

export function parseBankProfitCertificateAmount(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) {
    return null;
  }
  const text = String(value)
    .trim()
    .replace(/^\s*(?:PKR|Rs\.?|₨)\s*/i, "")
    .replace(/[\s,]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

export function parseBankProfitCertificateRate(value: unknown): number | null {
  if (typeof value === "boolean" || value === null || value === undefined) {
    return null;
  }
  const text = String(value)
    .trim()
    .replace(/\s*(?:%|percent|pct)\s*$/i, "")
    .replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) return null;
  const rate = Number(text);
  return Number.isFinite(rate) ? rate : null;
}

function parseIsoDate(value: unknown): string | null {
  const parsed = parseTaxpayerDateOfBirth(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

function fieldValuesByKind(
  fields: BankProfitCertificateFieldLike[] | undefined,
) {
  return new Map<BankProfitCertificateFieldKind, BankProfitCertificateFieldLike[]>(
    BANK_PROFIT_CERTIFICATE_FIELD_DEFINITIONS.map((definition) => [
      definition.kind,
      (fields ?? []).filter(
        (field) => getBankProfitCertificateFieldKind(field.label) === definition.kind,
      ),
    ]),
  );
}

function isSukukInstrument(fields: BankProfitCertificateFieldLike[] | undefined) {
  const category = String(
    bankProfitCertificateFieldValue(fields, "instrumentCategory") ?? "",
  )
    .trim()
    .toLowerCase();
  return category.includes("sukuk");
}

export function isBankProfitCertificateFieldRequired(
  label: unknown,
  fields?: BankProfitCertificateFieldLike[],
): boolean {
  const kind = getBankProfitCertificateFieldKind(label);
  const definition = BANK_PROFIT_CERTIFICATE_FIELD_DEFINITIONS.find(
    (field) => field.kind === kind,
  );
  if (!definition) return false;
  if (definition.required === true) return true;
  return definition.required === "if_sukuk" && isSukukInstrument(fields);
}

function formatAmount(amount: number) {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Full review gate used by the editor, approval action, and filing completeness. */
export function getBankProfitCertificateReviewErrors(
  fields: BankProfitCertificateFieldLike[] | undefined,
  expectedTaxYear?: number,
): string[] {
  const errors: string[] = [];
  const valuesByKind = fieldValuesByKind(fields);

  for (const definition of BANK_PROFIT_CERTIFICATE_FIELD_DEFINITIONS) {
    const matches = valuesByKind.get(definition.kind) ?? [];
    if (matches.length > 1) {
      errors.push(`${definition.label}: duplicate fields; review the extraction.`);
      continue;
    }
    if (isBankProfitCertificateFieldRequired(definition.label, fields) && isMissing(matches[0]?.value)) {
      errors.push(
        `${definition.label} is required. Enter it manually from the certificate if it was not extracted; do not infer it.`,
      );
    }
  }

  const taxpayerIdProvided = ["taxpayerCnic", "taxpayerNtn"].some(
    (kind) => !isMissing(bankProfitCertificateFieldValue(fields, kind as BankProfitCertificateFieldKind)),
  );
  if (!taxpayerIdProvided) {
    errors.push("Enter at least one taxpayer identifier: CNIC or NTN.");
  }
  const accountIdProvided = ["accountNumber", "iban"].some(
    (kind) => !isMissing(bankProfitCertificateFieldValue(fields, kind as BankProfitCertificateFieldKind)),
  );
  if (!accountIdProvided) {
    errors.push("Enter at least one bank account identifier: account number or IBAN.");
  }

  const value = (kind: BankProfitCertificateFieldKind) =>
    bankProfitCertificateFieldValue(fields, kind);
  const taxYearValue = value("taxYear");
  if (!isMissing(taxYearValue)) {
    const yearText = String(taxYearValue).trim();
    if (!/^\d{4}$/.test(yearText) || (expectedTaxYear !== undefined && Number(yearText) !== expectedTaxYear)) {
      errors.push(`Tax Year must be ${expectedTaxYear ?? "a four-digit year"}.`);
    }
  }

  const start = parseIsoDate(value("reportingPeriodStart"));
  const end = parseIsoDate(value("reportingPeriodEnd"));
  if (!isMissing(value("reportingPeriodStart")) && !start) {
    errors.push("Reporting Period Start: enter a valid date in YYYY-MM-DD format.");
  }
  if (!isMissing(value("reportingPeriodEnd")) && !end) {
    errors.push("Reporting Period End: enter a valid date in YYYY-MM-DD format.");
  }
  if (start && end) {
    if (start > end) {
      errors.push("Reporting Period Start cannot be after Reporting Period End.");
    } else if (expectedTaxYear !== undefined) {
      const range = getTaxYearStatementRange(expectedTaxYear);
      const rangeStart = range.start.toISOString().slice(0, 10);
      const rangeEnd = range.end.toISOString().slice(0, 10);
      if (start < rangeStart || end > rangeEnd) {
        errors.push(
          `Reporting period must fall within Tax Year ${expectedTaxYear}: ${rangeStart} to ${rangeEnd}.`,
        );
      }
    }
  }

  const cnic = value("taxpayerCnic");
  if (!isMissing(cnic) && String(cnic).replace(/\D/g, "").length !== 13) {
    errors.push("Taxpayer CNIC must contain exactly 13 digits.");
  }
  const iban = value("iban");
  if (!isMissing(iban) && String(iban).trim().toUpperCase().startsWith("PK")) {
    const validation = validatePakistaniIban(String(iban));
    if (!validation.valid) errors.push(`IBAN: ${validation.error}`);
  }

  const gross = parseBankProfitCertificateAmount(value("grossAnnualProfit"));
  const tax = parseBankProfitCertificateAmount(value("taxDeducted"));
  const rate = parseBankProfitCertificateRate(value("withholdingRate"));
  const net = parseBankProfitCertificateAmount(value("netProfitCredited"));
  if (!isMissing(value("grossAnnualProfit")) && (gross === null || gross <= 0)) {
    errors.push("Gross Annual Profit / Yield: enter a valid positive amount.");
  }
  if (!isMissing(value("taxDeducted")) && (tax === null || tax < 0)) {
    errors.push("Tax Deducted / Withheld: enter a valid amount of zero or more.");
  }
  if (!isMissing(value("withholdingRate")) && (rate === null || rate < 0 || rate > 100)) {
    errors.push("Bank-applied Withholding Rate (%): enter the printed rate from 0 to 100, without converting it to a tax rule.");
  }
  if (!isMissing(value("netProfitCredited")) && (net === null || net < 0)) {
    errors.push("Net Profit Credited: enter a valid amount of zero or more.");
  }

  const currency = value("currency");
  if (!isMissing(currency) && !/^[A-Za-z]{3}$/.test(String(currency).trim())) {
    errors.push("Currency must be a three-letter currency code, such as PKR.");
  }

  if (gross !== null && tax !== null && net !== null) {
    const grossCents = Math.round(gross * 100);
    const taxCents = Math.round(tax * 100);
    const netCents = Math.round(net * 100);
    if (taxCents > grossCents || grossCents - taxCents !== netCents) {
      errors.push(
        `Gross Annual Profit / Yield minus Tax Deducted / Withheld must equal Net Profit Credited (current values: ${formatAmount(gross)} - ${formatAmount(tax)} = ${formatAmount(gross - tax)} in the certificate currency).`,
      );
    }
  }

  return [...new Set(errors)];
}

export type ApprovedBankProfitCertificate = {
  schemaVersion: 1;
  taxYear: number;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  bankName: string;
  bankNtn: string;
  taxpayerName: string;
  taxpayerCnic: string | null;
  taxpayerNtn: string | null;
  accountNumber: string | null;
  iban: string | null;
  instrumentCategory: string;
  printedSectionSubsection: string;
  grossAnnualProfit: number;
  taxDeducted: number;
  bankAppliedWithholdingRatePercent: number;
  atlStatus: string;
  netProfitCredited: number;
  currency: string;
  sukukHolderType: string | null;
  sukukReturnBand: string | null;
};

/** Builds the typed canonical payload after getBankProfitCertificateReviewErrors passes. */
export function readApprovedBankProfitCertificate(
  fields: BankProfitCertificateFieldLike[] | undefined,
  expectedTaxYear?: number,
): ApprovedBankProfitCertificate | null {
  if (getBankProfitCertificateReviewErrors(fields, expectedTaxYear).length > 0) {
    return null;
  }
  const text = (kind: BankProfitCertificateFieldKind) => {
    const raw = bankProfitCertificateFieldValue(fields, kind);
    return isMissing(raw) ? null : String(raw).trim();
  };
  const taxYear = Number(text("taxYear"));
  const reportingPeriodStart = parseIsoDate(text("reportingPeriodStart"));
  const reportingPeriodEnd = parseIsoDate(text("reportingPeriodEnd"));
  const grossAnnualProfit = parseBankProfitCertificateAmount(text("grossAnnualProfit"));
  const taxDeducted = parseBankProfitCertificateAmount(text("taxDeducted"));
  const bankAppliedWithholdingRatePercent = parseBankProfitCertificateRate(text("withholdingRate"));
  const netProfitCredited = parseBankProfitCertificateAmount(text("netProfitCredited"));
  const bankName = text("bankName");
  const bankNtn = text("bankNtn");
  const taxpayerName = text("taxpayerName");
  const instrumentCategory = text("instrumentCategory");
  const printedSectionSubsection = text("printedSectionSubsection");
  const atlStatus = text("atlStatus");
  const currency = text("currency");

  if (
    !Number.isInteger(taxYear) ||
    !reportingPeriodStart ||
    !reportingPeriodEnd ||
    !bankName ||
    !bankNtn ||
    !taxpayerName ||
    !instrumentCategory ||
    !printedSectionSubsection ||
    grossAnnualProfit === null ||
    taxDeducted === null ||
    bankAppliedWithholdingRatePercent === null ||
    !atlStatus ||
    netProfitCredited === null ||
    !currency
  ) {
    return null;
  }

  const rawIban = text("iban");
  return {
    schemaVersion: 1,
    taxYear,
    reportingPeriodStart,
    reportingPeriodEnd,
    bankName,
    bankNtn,
    taxpayerName,
    taxpayerCnic: text("taxpayerCnic"),
    taxpayerNtn: text("taxpayerNtn"),
    accountNumber: text("accountNumber"),
    iban: rawIban
      ? rawIban.toUpperCase().startsWith("PK")
        ? normalizeIban(rawIban)
        : rawIban
      : null,
    instrumentCategory,
    printedSectionSubsection,
    grossAnnualProfit,
    taxDeducted,
    bankAppliedWithholdingRatePercent,
    atlStatus,
    netProfitCredited,
    currency: currency.toUpperCase(),
    sukukHolderType: text("sukukHolderType"),
    sukukReturnBand: text("sukukReturnBand"),
  };
}

/** Adds editable blanks for every canonical field the extractor did not return. */
export function ensureBankProfitCertificateReviewFields(extracted: unknown): unknown {
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) {
    return extracted;
  }
  const payload = extracted as Record<string, unknown>;
  const fields: BankProfitCertificateFieldLike[] = Array.isArray(payload.fields)
    ? payload.fields.filter(
        (field): field is BankProfitCertificateFieldLike =>
          Boolean(field) && typeof field === "object" && !Array.isArray(field),
      )
    : [];

  for (const definition of BANK_PROFIT_CERTIFICATE_FIELD_DEFINITIONS) {
    if (
      !fields.some(
        (field) => getBankProfitCertificateFieldKind(field.label) === definition.kind,
      )
    ) {
      fields.push({ label: definition.label, value: null, confidence: 0 });
    }
  }

  return { ...payload, fields };
}
