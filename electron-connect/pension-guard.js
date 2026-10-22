// Defense in depth: the server validates source freshness before handing out a
// pinned context. The desktop repeats the narrow packet contract because it is
// the last process allowed to type into a live IRIS return.
const PENSION_GUARD_BUILD_TAG = "fix52-computed-surcharge-readback-20261020";

function pensionEntryHold(snapshot) {
  const hasPension =
    Array.isArray(snapshot?.filing?.incomeSources) &&
    snapshot.filing.incomeSources.includes("pension");
  if (!hasPension && !snapshot?.pension) return null;

  const source = snapshot?.pension;
  let message;
  if (
    source?.version !== "pension-source-v1" ||
    !/^[a-f0-9]{64}$/.test(source?.fingerprint || "")
  ) {
    message =
      "This old pension packet has no approved annual-source contract. Recalculate, regenerate and approve a new packet. Nothing was changed in FBR.";
  } else if (
    !["exempt", "exempt_age70", "salary", "final_above_10m"].includes(
      source.treatment,
    ) ||
    !Number.isFinite(source.taxDeducted) ||
    source.taxDeducted < 0 ||
    (source.treatment !== "final_above_10m" && source.taxDeducted > 0)
  ) {
    message =
      "Pension treatment or actual withholding is not verified by the approved source. Recalculate and approve a fresh pension packet before portal entry. Nothing was changed in FBR.";
  } else {
    const detailed =
      snapshot.portalFieldMapDetailed ||
      (!Array.isArray(snapshot.portalFieldMap)
        ? snapshot.portalFieldMap
        : null);
    const fields = Array.isArray(snapshot.portalFieldMap)
      ? snapshot.portalFieldMap
      : [
          ...(Array.isArray(detailed?.incomeFields)
            ? detailed.incomeFields
            : []),
          ...(Array.isArray(detailed?.adjustableTaxFields)
            ? detailed.adjustableTaxFields
            : []),
        ];
    const match = (irisCode, column, value) => {
      const rows = Array.isArray(fields)
        ? fields.filter(
            (field) =>
              String(field.irisCode) === irisCode && field.column === column,
          )
        : [];
      return (
        rows.length === 1 &&
        Number(rows[0].value ?? rows[0].ourAmount) === value
      );
    };
    const annual = Number(source.annualPension);
    const fingerprintMatches =
      detailed?.computationHints?.pensionSourceFingerprint === source.fingerprint;

    if (source.treatment === "final_above_10m") {
      const excess = Math.max(0, annual - 10_000_000);
      const baseTax = Math.round(excess * 0.05);
      const surcharge = Math.round(baseTax * 0.1);
      if (
        !(annual > 10_000_000) ||
        !fingerprintMatches ||
        source.baseTax !== baseTax ||
        source.surcharge !== surcharge ||
        source.taxDue !== baseTax + surcharge ||
        !match("1008", "Total Amount", annual) ||
        !match("1008", "Subject to Final Tax", excess) ||
        !match("1008", "Subject to Exemption", 10_000_000) ||
        !match("64020007", "Taxable Amount", excess) ||
        !match("64020007", "Tax Deducted", Number(source.taxDeducted)) ||
        !match("923184", "Total Amount", surcharge) ||
        detailed?.mappingGaps?.pensionManualReview
      ) {
        message =
          "Pension final-tax autofill contract is incomplete. Regenerate a reviewed packet with the PKR 10 million exemption, excess-only Final/64020007 base and Section 4AB surcharge. Nothing was changed in FBR.";
      }
    } else {
      const expectedExempt = source.treatment === "salary" ? 0 : annual;
      if (
        !(annual > 0) ||
        !fingerprintMatches ||
        !match("1008", "Total Amount", annual) ||
        !match("1008", "Subject to Exemption", expectedExempt) ||
        !match("1008", "Subject to Final Tax", 0)
      ) {
        message =
          "Pension source/column contract is incomplete. Regenerate a reviewed packet with verified Total, Exemption and Final columns before portal entry. Nothing was changed in FBR.";
      }
    }
  }

  if (!message) return null;
  return {
    paused: true,
    pauseAction: "portal_state_confirmation",
    pauseMessage: message,
    executionLog: [],
    result: {
      mode: "pension_contract_review",
      requiredAction: "portal_state_confirmation",
      message,
      pensionCoverage: "contract_incomplete",
      reviewRequired: true,
      readyToSubmit: false,
      submitted: false,
      pension: source
        ? {
            annualPension: source.annualPension,
            treatment: source.treatment,
            baseTax: source.baseTax,
            surcharge: source.surcharge,
            taxDeducted: source.taxDeducted,
            taxDue: source.taxDue,
          }
        : null,
      summary: { total: 0, entered: 0, skipped: 0, failed: 0 },
    },
  };
}
module.exports = { PENSION_GUARD_BUILD_TAG, pensionEntryHold };
