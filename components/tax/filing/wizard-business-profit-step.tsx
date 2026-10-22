"use client";

import { CheckCircle2, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { StepHeading } from "@/components/tax/wizard-ui";
import {
  BUSINESS_MINIMUM_TAX_TURNOVER_THRESHOLD,
  computeBusinessProfit,
  hasBusinessSalesFigure,
} from "@/lib/tax/business-profit";
import {
  TY2026_BUSINESS_PROFIT_FIELDS,
  TY2026_BUSINESS_PROFIT_SUBCATEGORY,
  type Ty2026IncomeSelectionInput,
  type Ty2026SelectionUserDetails,
} from "@/lib/tax/rules/ty2026/subcategories";

type WizardBusinessProfitStepProps = Readonly<{
  selections: readonly Ty2026IncomeSelectionInput[];
  onToggle: (selection: Ty2026IncomeSelectionInput) => void;
  onDetailsChange: (selection: Ty2026IncomeSelectionInput) => void;
}>;

const rupees = (value: number) =>
  `Rs ${Math.round(value).toLocaleString("en-PK")}`;

/**
 * "Business profit" step of a filing for yourself (Myself).
 *
 * The figures are saved as ONE selection on the `business` source, so the
 * wizard's existing draft saving, resume and "a changed figure resets the
 * steps after it" rules apply without any special handling. The selection is
 * created when the first figure is typed and removed when the form is emptied,
 * which keeps Continue disabled until something has been entered.
 */
export function WizardBusinessProfitStep({
  selections,
  onToggle,
  onDetailsChange,
}: WizardBusinessProfitStepProps) {
  const existing = selections.find(
    (selection) =>
      selection.source === "business" &&
      selection.subcategory === TY2026_BUSINESS_PROFIT_SUBCATEGORY,
  );
  const details = existing?.details;
  const profit = computeBusinessProfit(details);
  const hasSales = hasBusinessSalesFigure(details);

  function setFigure(
    key: (typeof TY2026_BUSINESS_PROFIT_FIELDS)[number]["key"],
    raw: string,
  ) {
    const parsed = raw === "" ? undefined : Number(raw);
    const next: Ty2026SelectionUserDetails = { ...(details ?? {}) };
    if (parsed === undefined || Number.isNaN(parsed)) {
      delete next[key];
    } else {
      next[key] = parsed as never;
    }

    const selection: Ty2026IncomeSelectionInput = {
      source: "business",
      subcategory: TY2026_BUSINESS_PROFIT_SUBCATEGORY,
      details: next,
    };
    const hasAnyFigure = Object.keys(next).length > 0;

    if (!existing) {
      if (hasAnyFigure) onToggle(selection);
      return;
    }
    if (!hasAnyFigure) {
      // Toggling an existing selection removes it.
      onToggle({
        source: "business",
        subcategory: TY2026_BUSINESS_PROFIT_SUBCATEGORY,
      });
      return;
    }
    onDetailsChange(selection);
  }

  function confirmSalesBasis(checked: boolean) {
    const selection: Ty2026IncomeSelectionInput = {
      source: "business",
      subcategory: TY2026_BUSINESS_PROFIT_SUBCATEGORY,
      details: { ...(details ?? {}), businessSalesExcludeIndirectTax: checked },
    };
    if (existing) onDetailsChange(selection);
    else onToggle(selection);
  }

  return (
    <div className="space-y-6">
      <StepHeading
        title="Tell us about your business for the year"
        description="Enter the yearly figures of your business. We use them to estimate the income tax on your business profit. Tax already deducted by customers is not what you owe, so it is kept separate."
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">Tax Year 2026</Badge>
        <span>All amounts are in PKR for the full tax year</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {TY2026_BUSINESS_PROFIT_FIELDS.map((field) => {
          const current = details?.[field.key];
          return (
            <label
              key={field.key}
              className="block rounded-xl border border-border bg-card p-4"
            >
              <span className="text-sm font-semibold text-foreground">
                {field.label}
                {field.required ? " *" : ""}
              </span>
              <input
                type="number"
                min={field.min}
                step="any"
                inputMode="decimal"
                placeholder="0"
                value={typeof current === "number" ? current : ""}
                onChange={(event) => setFigure(field.key, event.target.value)}
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="mt-2 block text-[11px] leading-snug text-muted-foreground">
                {field.hint}
              </span>
            </label>
          );
        })}
      </div>

      <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
        <input
          type="checkbox"
          checked={details?.businessSalesExcludeIndirectTax === true}
          onChange={(event) => confirmSalesBasis(event.target.checked)}
        />
        <span>
          I confirm Sales for the year excludes Sales Tax and Federal Excise.
          Only this approved basis can be entered as Gross Revenue (3009) in
          FBR. Other business totals stay manual until their detailed schedules
          are available.
        </span>
      </label>

      <div
        className={`rounded-xl border p-4 ${
          hasSales ? "border-amanah bg-amanah/5" : "border-border bg-muted/30"
        }`}
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          {hasSales ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amanah" />
          ) : (
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div className="space-y-1 text-sm">
            {!hasSales ? (
              <p className="text-muted-foreground">
                Enter your sales for the year to see your estimated taxable
                business profit.
              </p>
            ) : profit.needsMinimumTaxRules ? (
              <p className="text-foreground">
                Your turnover is{" "}
                {rupees(BUSINESS_MINIMUM_TAX_TURNOVER_THRESHOLD)} or more. A
                special minimum tax applies at this size, so the final figure
                has to come from IRIS.
              </p>
            ) : profit.profitBeforeLossRelief < 0 ? (
              <>
                <p className="font-semibold text-foreground">
                  Business loss for the year:{" "}
                  {rupees(profit.lossCarriedForward)}
                </p>
                <p className="text-muted-foreground">
                  No tax is estimated on a loss. The loss can be carried forward
                  to the next six years.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-foreground">
                  Estimated taxable business profit:{" "}
                  {rupees(profit.taxableIncome)}
                </p>
                {profit.lossSetOff > 0 ? (
                  <p className="text-muted-foreground">
                    After setting off {rupees(profit.lossSetOff)} of
                    brought-forward loss.
                  </p>
                ) : null}
              </>
            )}
            <p className="text-xs text-muted-foreground">
              This is an estimate from the figures you typed. We do not check
              which expenses the law allows; IRIS gives the final tax.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
