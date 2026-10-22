import {
  bankTransactionDirection,
  unreviewedBankSuggestion,
  type BankDirection,
} from "./business-bank-categories";
import { toMoneyAmount } from "@/lib/money";

/**
 * Category carried by an unexplained credit. It is a question, not an answer:
 * it has no IRIS row and would be counted as taxable income, so a transaction
 * can never be approved under it. The user must say what the credit is.
 */
export const PLACEHOLDER_INCOME_CATEGORY = "POTENTIAL_INCOME";

export function isPlaceholderIncomeCategory(
  category: string | null | undefined,
) {
  return (
    String(category ?? "")
      .trim()
      .toUpperCase() === PLACEHOLDER_INCOME_CATEGORY
  );
}

export const PLACEHOLDER_INCOME_ERROR =
  "This credit has not been explained yet. Use the pencil icon and choose what it is (for example Salary, Gift, or Other income), or mark it Internal transfer, Cash movement, or Exclude.";
import {
  bankDescriptionMatchesKeyword as matchesKeyword,
  findLikelyInternalTransferPairs,
  hasInternalTransferLanguage as hasTransferLanguage,
  normalizeBankDescription as normalizeDescription,
  type TransferCandidate,
} from "@/lib/tax/bank-transfer-matching";

/** Words that mark an incoming credit as a gift (whole words, see the matcher). */
export const GIFT_KEYWORDS = ["gift", "gifted", "hiba", "hibah"] as const;

export const CLASSIFICATION_RULES = [
  {
    keywords: ["tax", "withholding", "fbr", "fed", "federal excise"],
    entryType: "EXPENSE",
    category: "TAX_PAYMENT",
    confidence: 0.9,
  },
  {
    keywords: [
      "bank profit",
      "profit credited",
      "profit payment",
      "profit on savings deposit",
      "profit on deposit",
      "savings profit",
      "savings account profit",
      "interest credited",
      "interest income",
      "deposit profit",
      "profit on debt",
      "markup",
    ],
    entryType: "INCOME",
    category: "BANK_PROFIT",
    confidence: 0.88,
  },
  {
    keywords: [
      "bank charge",
      "bank charges",
      "bank fee",
      "bank fees",
      "service charge",
      "annual fee",
      "account maintenance",
      "maintenance fee",
    ],
    entryType: "EXPENSE",
    category: "BANK_CHARGES",
    confidence: 0.92,
  },
  {
    keywords: ["rent received", "rental income", "rent credited"],
    entryType: "INCOME",
    category: "PROPERTY_RENT",
    confidence: 0.92,
  },
  {
    keywords: [
      "rent",
      "k-electric",
      "k electric",
      "electricity",
      "gas bill",
      "utility",
      " ke ",
    ],
    entryType: "EXPENSE",
    category: "UTILITIES_OR_RENT",
    confidence: 0.9,
  },
  {
    keywords: ["fuel", "petrol", "pso", "psos", "shell", "total"],
    entryType: "EXPENSE",
    category: "TRANSPORT",
    confidence: 0.88,
  },
  {
    keywords: ["salary", "payroll", "wages", "compensation"],
    entryType: "INCOME",
    category: "SALARY",
    confidence: 0.95,
  },
  {
    // Pension credits (AG/PPO/HBL PPS treasury disbursements) are as
    // recognisable as payroll, so they get the same SUGGESTED treatment as
    // salary: the chip says what it is and Approve All Safe can confirm it,
    // exactly like the salary rule above. Generic credits still fall through
    // to the POTENTIAL_INCOME placeholder — nothing else changes.
    keywords: ["pension"],
    entryType: "INCOME",
    category: "PENSION",
    confidence: 0.95,
  },
  {
    keywords: [
      "grocery",
      "groceries",
      "mart",
      "superstore",
      "restaurant",
      "food",
    ],
    entryType: "EXPENSE",
    category: "PERSONAL_EXPENSE",
    confidence: 0.8,
  },
] as const;

export function classifyDescription(
  description: string,
  direction?: BankDirection,
) {
  const normalized = normalizeDescription(description);

  // Cash deposits/withdrawals are movements, not automatically income or
  // expenses. Surface them for an explicit cash decision before merchant or
  // payroll keywords can override that safer interpretation.
  if (
    normalized.includes("cash withdrawal") ||
    normalized.includes("cash deposit") ||
    normalized.includes("atm withdrawal") ||
    normalized.includes("atm cash") ||
    normalized.includes("visa atm") ||
    normalized.includes("counter cash")
  ) {
    return {
      status: "POTENTIAL_CASH_MOVEMENT",
      entryType: null,
      category: "CASH_MOVEMENT",
      confidence: 0.85,
    };
  }

  // Transfer language must win over words such as "salary" in an account
  // label. "Transfer from HBL Salary Account" is a reviewable transfer, not
  // earned salary merely because the source account contains that word.
  if (hasTransferLanguage(description)) {
    return {
      status: "POTENTIAL_TRANSFER",
      entryType: null,
      category: "INTERNAL_TRANSFER",
      confidence: 0.8,
    };
  }

  const rule = CLASSIFICATION_RULES.find(
    (candidate) =>
      (!direction ||
        (direction === "credit"
          ? candidate.entryType === "INCOME"
          : direction === "debit"
            ? candidate.entryType === "EXPENSE"
            : false)) &&
      candidate.keywords.some((keyword) => matchesKeyword(normalized, keyword)),
  );

  if (!rule) {
    return {
      status: "UNREVIEWED",
      entryType: null,
      category: null,
      confidence: 0,
    };
  }

  return {
    status: "SUGGESTED",
    entryType: rule.entryType,
    category: rule.category,
    confidence: rule.confidence,
  };
}

function hasLikelyInternalTransferPair(
  transaction: TransferCandidate,
  candidates: TransferCandidate[],
) {
  return findLikelyInternalTransferPairs(transaction, candidates).length > 0;
}

export function classifyTransaction(
  transaction: TransferCandidate,
  transferCandidates: TransferCandidate[],
  options?: { businessEnabled?: boolean },
) {
  const direction = bankTransactionDirection(transaction);
  if (direction === "invalid") return unreviewedBankSuggestion();
  const normalized = normalizeDescription(transaction.description);

  if (hasLikelyInternalTransferPair(transaction, transferCandidates)) {
    return {
      status: "POTENTIAL_TRANSFER",
      entryType: null,
      category: "INTERNAL_TRANSFER",
      confidence: 0.98,
    };
  }

  // A credit that says it is a gift is suggested as a gift received: an
  // inflow of the Wealth Statement, not taxable income. It is only a
  // suggestion; the taxpayer approves it (or picks another category).
  if (
    toMoneyAmount(transaction.credit) > 0 &&
    toMoneyAmount(transaction.debit) === 0 &&
    GIFT_KEYWORDS.some((keyword) => matchesKeyword(normalized, keyword))
  ) {
    return {
      status: "SUGGESTED",
      entryType: "INCOME",
      category: "GIFT",
      confidence: 0.75,
    };
  }

  // Movement/transfer wording has priority; selecting business never makes
  // every bank row a business transaction.
  const movementSuggestion = classifyDescription(
    transaction.description,
    direction,
  );
  if (
    ["POTENTIAL_TRANSFER", "POTENTIAL_CASH_MOVEMENT"].includes(
      movementSuggestion.status,
    )
  )
    return movementSuggestion;
  if (options?.businessEnabled) {
    const businessRules = [
      {
        direction: "credit",
        category: "BUSINESS_SALES",
        keywords: [
          "customer sales receipt",
          "business sales",
          "business sales receipt",
        ],
      },
      {
        direction: "credit",
        category: "BUSINESS_OTHER_RECEIPTS",
        keywords: [
          "other business receipt",
          "business other receipt",
          "business scrap sale",
        ],
      },
      {
        direction: "debit",
        category: "BUSINESS_COST_OF_SALES",
        keywords: [
          "cost of sales",
          "business purchase",
          "business direct cost",
          "purchase for resale",
        ],
      },
      {
        direction: "debit",
        category: "BUSINESS_OPERATING_EXPENSE",
        keywords: [
          "business operating expense",
          "business operating cost",
          "business running cost",
          "business expense",
        ],
      },
    ];
    const businessRule = businessRules.find(
      (rule) =>
        rule.direction === direction &&
        rule.keywords.some((keyword) => matchesKeyword(normalized, keyword)),
    );
    if (businessRule) {
      // Conflicting asset/loan language needs a manual decision, not a guessed
      // operating expense or revenue classification.
      if (
        [
          "equipment purchase",
          "machinery purchase",
          "vehicle purchase",
          "property purchase",
          "loan proceeds",
          "loan disbursement",
        ].some((keyword) => matchesKeyword(normalized, keyword))
      )
        return unreviewedBankSuggestion();
      return {
        status: "SUGGESTED",
        entryType: direction === "credit" ? "INCOME" : "EXPENSE",
        category: businessRule.category,
        confidence: 0.9,
      };
    }
  }
  const descriptionSuggestion = movementSuggestion;

  if (descriptionSuggestion.status !== "UNREVIEWED") {
    return descriptionSuggestion;
  }

  // Both sides are converted before being compared. `Decimal(0)` is truthy,
  // so the previous `!(transaction.debit ?? 0)` form evaluated to false on a
  // zero Decimal and left every transaction unclassified in both directions.
  const debitAmount = toMoneyAmount(transaction.debit);
  const creditAmount = toMoneyAmount(transaction.credit);

  const hasCredit = creditAmount > 0 && debitAmount === 0;
  const hasDebit = debitAmount > 0 && creditAmount === 0;

  if (
    hasCredit &&
    [
      "loan",
      "financing",
      "credit facility",
      "loan proceeds",
      "loan disbursement",
    ].some((keyword) => matchesKeyword(normalized, keyword))
  ) {
    return {
      status: "POTENTIAL_LIABILITY",
      entryType: "LIABILITY",
      category: "LOAN_PROCEEDS",
      confidence: 0.7,
    };
  }

  if (
    hasDebit &&
    [
      "car purchase",
      "vehicle purchase",
      "property purchase",
      "land purchase",
      "equipment purchase",
      "laptop purchase",
      "machinery purchase",
    ].some((keyword) => matchesKeyword(normalized, keyword))
  ) {
    return {
      status: "POTENTIAL_ASSET",
      entryType: "ASSET",
      category: "ASSET_PURCHASE",
      confidence: 0.7,
    };
  }

  // A generic incoming credit is not automatically taxable income. Surface it
  // as a potential-income decision so the user can choose income, internal
  // transfer, or exclusion explicitly.
  if (hasCredit) {
    return {
      status: "POTENTIAL_INCOME",
      entryType: "INCOME",
      category: PLACEHOLDER_INCOME_CATEGORY,
      confidence: 0.55,
    };
  }

  return descriptionSuggestion;
}