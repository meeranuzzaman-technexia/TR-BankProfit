// File: lib/tax/business-profit.ts
//
// Business profit for an individual filing for themselves (TY2026).
//
// The taxpayer declares a handful of yearly figures on the "Business profit"
// step. This module turns them into the taxable business income that joins the
// individual slab (see `computeCombinedSlabRoute` in tax-calculation.ts).
//
// It is a pure function: no database, no wizard state. The rules it encodes:
//
//   taxable business income =
//       sales + other business receipts
//       - cost of sales - operating expenses - depreciation
//       + inadmissible expenses (added back; Section 21)
//       - business loss brought forward (Section 57, only against a profit)
//
// What it deliberately does NOT do (the estimate says so):
//   - It does not test whether an expense is admissible. The taxpayer enters
//     the inadmissible total; Section 21 (for example 21(h) personal
//     expenses, 21(l) cash payments above Rs 250,000, 21(r) the 8% cap on
//     non-integrated sales) is a hint on screen, not a check.
//   - It does not compute depreciation (the taxpayer types the claimed amount).
//   - It does not credit tax already deducted on business receipts. That
//     amount is shown for information only; the Section 153 minimum-tax and
//     refund interaction is not modelled yet.
//   - It does not apply Section 113 minimum tax. At or above the turnover
//     threshold below the estimate stops instead of showing a wrong figure.
//
// Law source: Income Tax Ordinance 2001 as amended to 31.07.2025 (TY2026).

import type { Ty2026SelectionUserDetails } from "./rules/ty2026/subcategories";

/**
 * Section 113(1): minimum tax applies to an individual or AOP whose turnover
 * is Rs 100 million or more in the tax year.
 */
export const BUSINESS_MINIMUM_TAX_TURNOVER_THRESHOLD = 100_000_000;

export type BusinessProfitFigures = Readonly<{
  grossSales: number;
  otherBusinessRevenue: number;
  costOfSales: number;
  operatingExpenses: number;
  depreciation: number;
  inadmissibleExpenses: number;
  lossBroughtForward: number;
  withholdingDeducted: number;
}>;

export type BusinessProfitResult = Readonly<{
  figures: BusinessProfitFigures;
  /** Sales plus other business receipts. */
  turnover: number;
  /** Profit before any brought-forward loss; negative when the year is a loss. */
  profitBeforeLossRelief: number;
  /** Brought-forward loss actually set off this year. */
  lossSetOff: number;
  /** Taxable business income, never below zero. */
  taxableIncome: number;
  /** Loss of this year available to carry forward (zero when there is a profit). */
  lossCarriedForward: number;
  /** Brought-forward loss left unused after this year. */
  broughtForwardLossRemaining: number;
  /** Section 113 applies at this turnover; the estimate must stop. */
  needsMinimumTaxRules: boolean;
}>;

function amount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/** Rounds to paisa so repeated additions never leave floating-point residue. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function readBusinessProfitFigures(
  details: Ty2026SelectionUserDetails | undefined | null,
): BusinessProfitFigures {
  return {
    grossSales: amount(details?.businessGrossSales),
    otherBusinessRevenue: amount(details?.businessOtherRevenue),
    costOfSales: amount(details?.businessCostOfSales),
    operatingExpenses: amount(details?.businessOperatingExpenses),
    depreciation: amount(details?.businessDepreciation),
    inadmissibleExpenses: amount(details?.businessInadmissibleExpenses),
    lossBroughtForward: amount(details?.businessLossBroughtForward),
    withholdingDeducted: amount(details?.businessWithholdingDeducted),
  };
}

/**
 * True once the taxpayer has declared sales. A business with no sales figure
 * has not been described yet, so calculation asks for it instead of treating
 * the empty form as a zero-profit business.
 */
export function hasBusinessSalesFigure(
  details: Ty2026SelectionUserDetails | undefined | null,
): boolean {
  return (
    typeof details?.businessGrossSales === "number" &&
    Number.isFinite(details.businessGrossSales) &&
    details.businessGrossSales > 0
  );
}

export function computeBusinessProfit(
  details: Ty2026SelectionUserDetails | undefined | null,
): BusinessProfitResult {
  const figures = readBusinessProfitFigures(details);

  const turnover = money(figures.grossSales + figures.otherBusinessRevenue);
  const profitBeforeLossRelief = money(
    turnover -
      figures.costOfSales -
      figures.operatingExpenses -
      figures.depreciation +
      figures.inadmissibleExpenses,
  );

  // A brought-forward loss is set off only against a profit. A loss year
  // leaves it untouched and adds its own loss to the carry-forward.
  const lossSetOff =
    profitBeforeLossRelief > 0
      ? money(Math.min(figures.lossBroughtForward, profitBeforeLossRelief))
      : 0;
  const taxableIncome =
    profitBeforeLossRelief > 0 ? money(profitBeforeLossRelief - lossSetOff) : 0;
  const lossCarriedForward =
    profitBeforeLossRelief < 0 ? money(-profitBeforeLossRelief) : 0;

  return {
    figures,
    turnover,
    profitBeforeLossRelief,
    lossSetOff,
    taxableIncome,
    lossCarriedForward,
    broughtForwardLossRemaining: money(figures.lossBroughtForward - lossSetOff),
    needsMinimumTaxRules: turnover >= BUSINESS_MINIMUM_TAX_TURNOVER_THRESHOLD,
  };
}
