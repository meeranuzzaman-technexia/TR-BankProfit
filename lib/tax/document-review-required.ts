import {
  BUSINESS_SCHEDULE_LABELS,
  businessPurchaseBasisRequired,
  isBusinessPurchaseBasisField,
  parseBusinessPurchaseBasis,
} from "./business-schedule-fields";
import { isSalaryCertificateRequiredField } from "./salary-certificate-fields";
import { ensurePensionStatementReviewFields, isPensionStatementRequiredField, getPensionStatementReviewErrors } from "./pension-statement-fields";
import { parseTaxpayerDateOfBirth } from "./taxpayer-age";
import {
  isBankStatementIbanLabel,
  validateBankStatementIban,
} from "./bank-statement-fields";
import {
  BANK_PROFIT_CERTIFICATE_FIELD_DEFINITIONS,
  getBankProfitCertificateReviewErrors,
  isBankProfitCertificateFieldRequired,
} from "./bank-profit-certificate-fields";

type Field = { label?: unknown; value?: unknown; confidence?: unknown };
type Requirement = {
  label: string;
  aliases?: string[];
  kind?:
    | "amount"
    | "positive_amount"
    | "date"
    | "year"
    | "cnic"
    | "currency"
    | "boolean";
};
const normalize = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Required for the supported app flow, not a claim that every document is legally compulsory. */
const REQUIREMENTS: Record<string, Requirement[]> = {
  cnic: [
    {
      label: "CNIC Number",
      aliases: ["cnic", "identity number"],
      kind: "cnic",
    },
    { label: "Date of Birth", aliases: ["dob", "birth date"], kind: "date" },
  ],
  bank_statement: [
    { label: "IBAN", aliases: ["account iban", "iban number"] },
    {
      label: "Opening Balance",
      aliases: ["balance at 1 february"],
      kind: "amount",
    },
    {
      label: "Closing Balance",
      aliases: ["balance at 1 march"],
      kind: "amount",
    },
    {
      label: "Statement Period Start",
      aliases: ["from date", "period start", "statement start date"],
      kind: "date",
    },
    {
      label: "Statement Period End",
      aliases: ["to date", "period end", "statement end date"],
      kind: "date",
    },
    { label: "Currency", kind: "currency" },
  ],
  bank_certificate: BANK_PROFIT_CERTIFICATE_FIELD_DEFINITIONS.map((field) => ({
    label: field.label,
    aliases: [...field.aliases],
    ...(field.validationKind ? { kind: field.validationKind } : {}),
  })),
  business_books: [
    { label: "Business Name" },
    { label: "Tax Year", kind: "year" },
    { label: "Currency", kind: "currency" },
    {
      label: "Reporting Period Start",
      aliases: [
        "reporting period from",
        "period start",
        "from date",
        "statement period start",
      ],
      kind: "date",
    },
    {
      label: "Reporting Period End",
      aliases: [
        "reporting period to",
        "period end",
        "to date",
        "statement period end",
      ],
      kind: "date",
    },
    {
      label: "Sales for the year",
      aliases: [
        "sales",
        "annual sales",
        "gross sales",
        "gross annual sales",
        "gross sales annual pkr",
        "gross revenue",
        "gross revenue annual pkr",
        "total sales",
        "sales for the year pkr",
      ],
      kind: "positive_amount",
    },
  ],
  business_balance_sheet: [
    { label: "Business Name" },
    { label: "Tax Year", kind: "year" },
    { label: "Balance Sheet Date", kind: "date" },
    { label: "Currency", kind: "currency" },
    { label: "Total Assets", kind: "amount" },
    { label: "Total Equity and Liabilities", kind: "amount" },
  ],
};
function matches(requirement: Requirement, label: unknown) {
  if (requirement.label === "IBAN") return isBankStatementIbanLabel(label);
  return [requirement.label, ...(requirement.aliases ?? [])].some(
    (alias) => normalize(alias) === normalize(label),
  );
}
export function documentReviewFieldRequirement(
  documentType: string,
  label: unknown,
) {
  return REQUIREMENTS[documentType]?.find((requirement) =>
    matches(requirement, label),
  );
}
export function isDocumentReviewRequiredField(
  documentType: string,
  label: unknown,
  fields?: Field[],
) {
  if (
    documentType === "business_books" &&
    isBusinessPurchaseBasisField(label) &&
    businessPurchaseBasisRequired(fields)
  )
    return true;
  if (documentType === "pension_statement") return isPensionStatementRequiredField(label, fields);
  if (documentType === "bank_certificate")
    return isBankProfitCertificateFieldRequired(label, fields);
  return documentType === "salary_certificate"
    ? isSalaryCertificateRequiredField(String(label ?? ""))
    : Boolean(documentReviewFieldRequirement(documentType, label));
}
export function ensureRequiredDocumentReviewFields(
  documentType: string,
  raw: unknown,
): unknown {
  if (documentType === "pension_statement") return ensurePensionStatementReviewFields(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const payload = raw as Record<string, unknown>;
  const fields: Field[] = Array.isArray(payload.fields)
    ? payload.fields
        .filter(
          (field) =>
            field && typeof field === "object" && !Array.isArray(field),
        )
        .map((field) => ({ ...field }))
    : [];
  for (const requirement of REQUIREMENTS[documentType] ?? []) {
    if (!fields.some((field) => matches(requirement, field.label)))
      fields.push({ label: requirement.label, value: null, confidence: 0 });
  }
  return { ...payload, fields };
}
export function getDocumentReviewRequiredErrors(
  documentType: string,
  fields: Field[] | undefined,
  taxYear?: number,
): string[] {
  if (documentType === "pension_statement") return getPensionStatementReviewErrors(fields, taxYear);
  if (documentType === "bank_certificate")
    return getBankProfitCertificateReviewErrors(fields, taxYear);
  const errors: string[] = [];
  const requirements: Requirement[] = [...(REQUIREMENTS[documentType] ?? [])];
  if (
    documentType === "business_books" &&
    businessPurchaseBasisRequired(fields)
  )
    requirements.push({
      label: BUSINESS_SCHEDULE_LABELS.purchaseBasis,
      kind: "boolean",
    });
  for (const requirement of requirements) {
    const found = (fields ?? []).filter((field) =>
      matches(requirement, field.label),
    );
    if (found.length > 1) {
      errors.push(
        `${requirement.label}: duplicate fields; review the extraction.`,
      );
      continue;
    }
    const value = found[0]?.value;
    if (value === null || value === undefined || String(value).trim() === "") {
      errors.push(
        `${requirement.label} is required. Enter it manually from your records if it was not extracted.`,
      );
      continue;
    }
    const text = String(value).trim();
    if (requirement.kind === "boolean") {
      if (parseBusinessPurchaseBasis(value) === null)
        errors.push(
          `${requirement.label}: choose Yes or No from the purchase-specific source; do not use the sales tax basis.`,
        );
    } else if (requirement.label === "IBAN") {
      const result = validateBankStatementIban(found);
      if (!result.valid) errors.push(`IBAN: ${result.error}`);
    } else if (
      requirement.kind === "amount" ||
      requirement.kind === "positive_amount"
    ) {
      const amount = Number(text.replace(/,/g, ""));
      if (
        typeof value === "boolean" ||
        !Number.isFinite(amount) ||
        (documentType !== "bank_statement" && amount < 0) ||
        (requirement.kind === "positive_amount" && amount <= 0)
      )
        errors.push(
          `${requirement.label}: enter a valid ${requirement.kind === "positive_amount" ? "positive " : ""}amount.`,
        );
    } else if (requirement.kind === "date") {
      const parsed = parseTaxpayerDateOfBirth(value);
      if (!parsed) errors.push(`${requirement.label}: enter a valid date.`);
      else if (
        documentType === "business_books" &&
        taxYear &&
        parsed.toISOString().slice(0, 10) !==
          (requirement.label.endsWith("Start")
            ? `${taxYear - 1}-07-01`
            : `${taxYear}-06-30`)
      )
        errors.push(
          `${requirement.label} must cover the full normal TY${taxYear}.`,
        );
      else if (
        documentType === "business_balance_sheet" &&
        taxYear &&
        parsed.toISOString().slice(0, 10) !== `${taxYear}-06-30`
      )
        errors.push(`Balance Sheet Date must be ${taxYear}-06-30.`);
    } else if (
      requirement.kind === "cnic" &&
      text.replace(/[^0-9]/g, "").length !== 13
    ) {
      errors.push("CNIC Number must contain exactly 13 digits.");
    } else if (
      requirement.kind === "year" &&
      (!/^\d{4}$/.test(text) ||
        (taxYear !== undefined && Number(text) !== taxYear))
    ) {
      errors.push(`Tax Year must be ${taxYear ?? "a four-digit year"}.`);
    } else if (
      requirement.kind === "currency" &&
      (!/^[A-Za-z]{3}$/.test(text) ||
        (documentType.startsWith("business_") && text.toUpperCase() !== "PKR"))
    ) {
      errors.push(
        `Currency must be ${documentType.startsWith("business_") ? "PKR" : "a three-letter currency code"}.`,
      );
    }
  }
  return errors;
}

export function storedDocumentReviewRequiredErrors(
  documentType: string,
  extractedData: string | null | undefined,
  taxYear?: number,
) {
  if (!REQUIREMENTS[documentType] && documentType !== "pension_statement") return [];
  try {
    const payload = extractedData ? JSON.parse(extractedData) : null;
    return getDocumentReviewRequiredErrors(
      documentType,
      Array.isArray(payload?.fields) ? payload.fields : [],
      taxYear,
    );
  } catch {
    return [
      "Saved extraction is unreadable. Re-extract or replace this document.",
    ];
  }
}
