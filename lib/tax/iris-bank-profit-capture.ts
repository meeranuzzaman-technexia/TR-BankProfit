import type { ApprovedBankProfitCertificate } from "./bank-profit-certificate-fields";

export type BankProfitSubcategory =
  | "bank-or-financial-institution-deposit"
  | "government-securities-non-individual"
  | "other-profit-on-debt"
  | "sukuk-company"
  | "sukuk-individual-aop-above-1m"
  | "sukuk-individual-aop-below-1m";

/** TY2026 Other Sources -> Tax Deductions -> Final Tax capture contract. */
export const BANK_PROFIT_FINAL_TAX_ROWS: Readonly<
  Record<BankProfitSubcategory, { code: string; description: string; writableDetailCreationVerified: boolean }>
> = {
  "bank-or-financial-institution-deposit": {
    code: "64040052",
    description: "Profit on Debt u/s 151(1)(b) from Bank Accounts / Deposits",
    writableDetailCreationVerified: true,
  },
  "government-securities-non-individual": {
    code: "64040053",
    description: "Profit on Debt u/s 151(1)(c) from Government Securities",
    writableDetailCreationVerified: true,
  },
  "other-profit-on-debt": {
    code: "64040054",
    description: "151(1) (d) - Profit on Debt u/s 151 from Others",
    writableDetailCreationVerified: true,
  },
  "sukuk-company": {
    code: "64330056",
    description: "Return on Investment in Sukuks u/s 151(1A) @ 25%",
    writableDetailCreationVerified: true,
  },
  "sukuk-individual-aop-above-1m": {
    code: "64330055",
    description: "Return on Investment in Sukuks u/s 151(1A) @ 12.5%",
    writableDetailCreationVerified: true,
  },
  "sukuk-individual-aop-below-1m": {
    code: "64330054",
    description: "Return on Investment in Sukuks u/s 151(1A) @ 10%",
    writableDetailCreationVerified: true,
  },
};

export const BANK_PROFIT_WRITEABLE_CODES: ReadonlySet<string> = new Set(
  Object.values(BANK_PROFIT_FINAL_TAX_ROWS)
    .filter((row) => row.writableDetailCreationVerified)
    .map((row) => row.code),
);

const normalized = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Derive only what the reviewed certificate explicitly identifies. */
export function bankProfitSubcategoryFromCertificate(
  certificate: ApprovedBankProfitCertificate,
): BankProfitSubcategory | null {
  const section = normalized(certificate.printedSectionSubsection);
  const instrument = normalized(certificate.instrumentCategory);
  if (/151 1 b\b/.test(section)) return "bank-or-financial-institution-deposit";
  if (/151 1 c\b/.test(section)) return "government-securities-non-individual";
  if (/151 1 d\b/.test(section)) return "other-profit-on-debt";
  if (!/151 1 ?a\b/.test(section) && /\bbank\b/.test(instrument) && /\b(account|deposit)\b/.test(instrument))
    return "bank-or-financial-institution-deposit";
  if (!/151 1 ?a\b/.test(section) && !instrument.includes("sukuk")) return null;

  const holder = normalized(certificate.sukukHolderType);
  const band = normalized(certificate.sukukReturnBand);
  if (holder.includes("company")) return "sukuk-company";
  if (!holder.includes("individual") && !holder.includes("aop")) return null;
  if (band.includes("below") || band.includes("less") || band.includes("not exceed"))
    return "sukuk-individual-aop-below-1m";
  if (band.includes("above") || band.includes("greater") || band.includes("exceed"))
    return "sukuk-individual-aop-above-1m";
  return null;
}

export type BankProfitPortalSource = {
  documentId: string;
  subcategory: BankProfitSubcategory;
  /** Exact IRIS Investment modal value from the approved certificate. */
  investment: string;
  /** Account/instrument/institution lines requested by the IRIS modal. */
  contents: string;
  /** Current calculation tax base, sourced from bank-statement ledger income. */
  statementGrossProfit: number;
  /** Actual withholding printed on the approved bank-profit certificate. */
  taxDeducted: number;
  /** Current route tax from the saved calculation line. */
  taxChargeable: number;
};
