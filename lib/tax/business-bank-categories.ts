import type { MoneyInput } from "@/lib/money";

export const BUSINESS_BANK_INCOME_CATEGORIES = ["BUSINESS_SALES", "BUSINESS_OTHER_RECEIPTS"] as const;
export const BUSINESS_BANK_EXPENSE_CATEGORIES = ["BUSINESS_COST_OF_SALES", "BUSINESS_OPERATING_EXPENSE"] as const;
export const BUSINESS_BANK_CATEGORIES = [...BUSINESS_BANK_INCOME_CATEGORIES, ...BUSINESS_BANK_EXPENSE_CATEGORIES] as const;
export type BankDirection = "credit" | "debit" | "invalid";
export type BankAmounts = { debit: MoneyInput; credit: MoneyInput };
export type BankSuggestion = { status: string; entryType: string | null; category: string | null; confidence: number };
export const unreviewedBankSuggestion = (): BankSuggestion => ({ status: "UNREVIEWED", entryType: null, category: null, confidence: 0 });
export const normalizeBankCategory = (value: unknown) => String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
export function isBusinessBankCategory(value: unknown) {
  return (BUSINESS_BANK_CATEGORIES as readonly string[]).includes(normalizeBankCategory(value));
}
export function isMyselfBusinessBankFlow(input: { taxYear?: number; filerType?: string | null; incomeSources?: string | string[] | null }) {
  if (input.taxYear !== 2026 || input.filerType !== "myself") return false;
  try {
    const sources = typeof input.incomeSources === "string" ? JSON.parse(input.incomeSources) : input.incomeSources;
    return Array.isArray(sources) && sources.includes("business");
  } catch { return false; }
}
export function bankTransactionDirection(input: BankAmounts): BankDirection {
  const debit = Number(input.debit ?? 0), credit = Number(input.credit ?? 0);
  if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) return "invalid";
  return credit > 0 && debit === 0 ? "credit" : debit > 0 && credit === 0 ? "debit" : "invalid";
}
export function bankEntryDirectionError(input: BankAmounts, entryType: string | null | undefined): string | null {
  const direction = bankTransactionDirection(input);
  const expected = entryType === "INCOME" || entryType === "LIABILITY" ? "credit" : entryType === "EXPENSE" || entryType === "ASSET" ? "debit" : null;
  return expected && direction === expected ? null : "Choose a transaction type matching its debit/credit direction; a credit is not an expense and a debit is not income.";
}
export function businessBankDecisionError(entryType: string, category: unknown, businessEnabled: boolean): string | null {
  if (!isBusinessBankCategory(category)) return null;
  if (!businessEnabled) return "Business bank categories currently require Myself / Business Income / TY2026. Review the filing setup.";
  const expected = (BUSINESS_BANK_INCOME_CATEGORIES as readonly string[]).includes(normalizeBankCategory(category)) ? "INCOME" : "EXPENSE";
  return entryType === expected ? null : "Choose Income for business receipts, or Expense for business cost of sales/operating expenses.";
}

/** Validates an AI proposal, not an approval. Unknown categories stay manual. */
export function applySafeBankAiSuggestion(
  suggestion: { classification?: unknown; category?: unknown; confidence?: unknown } | undefined,
  amounts: BankAmounts,
  businessEnabled = false,
): BankSuggestion {
  if (!suggestion || bankTransactionDirection(amounts) === "invalid") return unreviewedBankSuggestion();
  const classification = String(suggestion.classification ?? "");
  if (classification === "internal_transfer") return { status: "POTENTIAL_TRANSFER", entryType: null, category: "INTERNAL_TRANSFER", confidence: 0.5 };
  if (classification === "cash_movement") return { status: "POTENTIAL_CASH_MOVEMENT", entryType: null, category: "CASH_MOVEMENT", confidence: 0.5 };
  const typeByClass: Record<string, string> = { income: "INCOME", expense: "EXPENSE", asset: "ASSET", liability: "LIABILITY" };
  const entryType = typeByClass[classification];
  if (!entryType || bankEntryDirectionError(amounts, entryType)) return unreviewedBankSuggestion();
  const category = normalizeBankCategory(suggestion.category);
  const allowed: Record<string, readonly string[]> = {
    INCOME: ["SALARY", "PENSION", "BANK_PROFIT", "PROPERTY_RENT", "DIVIDEND", "SERVICES", "GIFT", "OTHER_INCOME", ...(businessEnabled ? BUSINESS_BANK_INCOME_CATEGORIES : [])],
    EXPENSE: ["PERSONAL_EXPENSE", "UTILITIES_OR_RENT", "TRANSPORT", "BANK_CHARGES", "TAX_PAYMENT", "OTHER_EXPENSE", ...(businessEnabled ? BUSINESS_BANK_EXPENSE_CATEGORIES : [])],
    ASSET: ["PROPERTY", "VEHICLE", "EQUIPMENT", "INVESTMENT", "OTHER_ASSET", "ASSET_PURCHASE"],
    LIABILITY: ["LOAN_PROCEEDS", "CREDIT_CARD", "OTHER_LIABILITY"],
  };
  if (!allowed[entryType].includes(category) || businessBankDecisionError(entryType, category, businessEnabled)) return unreviewedBankSuggestion();
  const rawConfidence = typeof suggestion.confidence === "number" && Number.isFinite(suggestion.confidence) ? suggestion.confidence : 0.5;
  return { status: entryType === "EXPENSE" ? "SUGGESTED" : `POTENTIAL_${entryType}`, entryType, category, confidence: Math.max(0, Math.min(1, rawConfidence)) };
}
