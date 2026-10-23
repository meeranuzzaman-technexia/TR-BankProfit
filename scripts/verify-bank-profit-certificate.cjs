#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, ...rest);
};
require.extensions[".ts"] = function (module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  module._compile(output, filename);
};

const fields = require(path.join(root, "lib/tax/bank-profit-certificate-fields.ts"));
const review = require(path.join(root, "lib/tax/document-review-required.ts"));
const iris = require(path.join(root, "lib/tax/iris-bank-profit-capture.ts"));
const portalFieldMap = require(path.join(root, "lib/tax/portal-field-map.ts"));
const documentSlots = require(path.join(root, "lib/tax/bank-profit-document-slot.ts"));

const L = fields.BANK_PROFIT_CERTIFICATE_LABELS;
const fixtureValues = {
  [L.taxYear]: 2026,
  [L.reportingPeriodStart]: "2025-07-01",
  [L.reportingPeriodEnd]: "2026-06-30",
  [L.bankName]: "Example Bank Limited",
  [L.bankNtn]: "1234567",
  [L.taxpayerName]: "Ayesha Example",
  [L.taxpayerCnic]: "42101-1234567-8",
  [L.taxpayerNtn]: null,
  [L.accountNumber]: "00123456789",
  [L.iban]: null,
  [L.instrumentCategory]: "Term Deposit",
  [L.printedSectionSubsection]: "Section 151(1)(b)",
  [L.grossAnnualProfit]: "1,000,000.00",
  [L.taxDeducted]: "150,000.00",
  [L.withholdingRate]: "15%",
  [L.atlStatus]: "ATL",
  [L.netProfitCredited]: "850,000.00",
  [L.currency]: "PKR",
  [L.sukukHolderType]: null,
  [L.sukukReturnBand]: null,
};
const makeFields = (values = fixtureValues) =>
  Object.entries(values).map(([label, value]) => ({ label, value }));


test("canonical bank-profit review fields are visible; missing values stay null", () => {
  const payload = fields.ensureBankProfitCertificateReviewFields({ fields: [] });
  assert.equal(
    payload.fields.length,
    fields.BANK_PROFIT_CERTIFICATE_FIELD_DEFINITIONS.length,
  );
  assert.ok(payload.fields.every((field) => field.value === null));
  const errors = review.getDocumentReviewRequiredErrors(
    "bank_certificate",
    payload.fields,
    2026,
  );
  assert.ok(errors.some((error) => error.startsWith("Tax Year is required")));
  assert.ok(errors.includes("Enter at least one taxpayer identifier: CNIC or NTN."));
  assert.ok(errors.includes("Enter at least one bank account identifier: account number or IBAN."));
  assert.equal(
    review.isDocumentReviewRequiredField("bank_certificate", L.grossAnnualProfit, payload.fields),
    true,
  );
  assert.equal(
    review.isDocumentReviewRequiredField("bank_certificate", L.taxpayerCnic, payload.fields),
    false,
    "CNIC and NTN form an either/or group rather than two individually required values",
  );
});

test("complete reviewed certificate passes, reconciles, and produces typed canonical evidence", () => {
  const input = makeFields();
  assert.deepEqual(review.getDocumentReviewRequiredErrors("bank_certificate", input, 2026), []);
  const approved = fields.readApprovedBankProfitCertificate(input, 2026);
  assert.deepEqual(approved, {
    schemaVersion: 1,
    taxYear: 2026,
    reportingPeriodStart: "2025-07-01",
    reportingPeriodEnd: "2026-06-30",
    bankName: "Example Bank Limited",
    bankNtn: "1234567",
    taxpayerName: "Ayesha Example",
    taxpayerCnic: "42101-1234567-8",
    taxpayerNtn: null,
    accountNumber: "00123456789",
    iban: null,
    instrumentCategory: "Term Deposit",
    printedSectionSubsection: "Section 151(1)(b)",
    grossAnnualProfit: 1000000,
    taxDeducted: 150000,
    bankAppliedWithholdingRatePercent: 15,
    atlStatus: "ATL",
    netProfitCredited: 850000,
    currency: "PKR",
    sukukHolderType: null,
    sukukReturnBand: null,
  });
  assert.equal("taxTreatment" in approved, false);
  assert.equal("ruleId" in approved, false);
});

test("reviewed certificate facts select the exact captured Section 151 IRIS row", () => {
  const approved = fields.readApprovedBankProfitCertificate(makeFields(), 2026);
  assert.equal(
    iris.bankProfitSubcategoryFromCertificate(approved),
    "bank-or-financial-institution-deposit",
  );
  assert.deepEqual(iris.BANK_PROFIT_FINAL_TAX_ROWS["bank-or-financial-institution-deposit"], {
    code: "64040052",
    description: "Profit on Debt u/s 151(1)(b) from Bank Accounts / Deposits",
    writableDetailCreationVerified: true,
  });
});

test("Bank Profit fields use the statement gross and certificate withholding on the captured 64040052 row", () => {
  const map = portalFieldMap.buildPortalFieldMap({
    taxYear: 2026,
    filerType: "myself",
    taxpayerListStatus: "ATL",
    ledgerEntries: [
      {
        id: "bank-ledger-profit",
        entryType: "INCOME",
        category: "BANK_PROFIT",
        description: "Bank profit from annual statement",
        amount: 45000,
      },
    ],
    bankProfitSource: {
      documentId: "approved-bank-certificate",
      subcategory: "bank-or-financial-institution-deposit",
      investment: "Bank savings deposit — synthetic",
      contents: "1. PK00TEST0000000000000000\n2. Bank savings deposit — synthetic\n3. Test Bank Limited",
      statementGrossProfit: 45000,
      taxDeducted: 9000,
      taxChargeable: 9000,
    },
  });
  const fields = portalFieldMap.flattenPortalFieldMap(map);
  assert.deepEqual(
    fields
      .filter((field) => field.irisCode === "64040052")
      .map((field) => [field.column, field.value, field.portalArea, field.irisSection]),
    [
      ["Taxable Amount", "45000", "Other Sources", "Tax Deductions"],
      ["Tax Deducted", "9000", "Other Sources", "Tax Deductions"],
      ["Tax Chargeable", "9000", "Other Sources", "Tax Deductions"],
    ],
  );
  assert.equal(
    fields.some((field) => field.irisCode === "500312"),
    false,
    "do not duplicate the same bank profit in the computed Other Sources summary row",
  );
  assert.ok(fields.filter((field) => field.irisCode === "64040052").every(
    (field) =>
      field.bankProfitInvestment === "Bank savings deposit — synthetic" &&
      field.bankProfitContents.includes("Test Bank Limited"),
  ));
});

test("a clearly identified bank deposit maps when the certificate does not print a subsection", () => {
  const approved = fields.readApprovedBankProfitCertificate(
    makeFields({
      ...fixtureValues,
      [L.instrumentCategory]: "Bank savings deposit — synthetic",
      [L.printedSectionSubsection]: "Not specified; no treatment inferred",
    }),
    2026,
  );
  assert.equal(
    iris.bankProfitSubcategoryFromCertificate(approved),
    "bank-or-financial-institution-deposit",
  );
});

test("Sukuk holder and return band select distinct Final Tax rows", () => {
  const base = fields.readApprovedBankProfitCertificate(makeFields(), 2026);
  assert.equal(
    iris.bankProfitSubcategoryFromCertificate({
      ...base,
      instrumentCategory: "Sukuk",
      printedSectionSubsection: "Section 151(1A)",
      sukukHolderType: "Individual / AOP",
      sukukReturnBand: "Not exceeding PKR 1 million",
    }),
    "sukuk-individual-aop-below-1m",
  );
  assert.equal(
    iris.bankProfitSubcategoryFromCertificate({
      ...base,
      instrumentCategory: "Sukuk",
      printedSectionSubsection: "Section 151(1A)",
      sukukHolderType: "Company",
      sukukReturnBand: "Not applicable",
    }),
    "sukuk-company",
  );
});

test("gross less withheld tax must equal the printed net credit; values are not repaired", () => {
  const input = makeFields({ ...fixtureValues, [L.netProfitCredited]: "849,999.99" });
  const errors = review.getDocumentReviewRequiredErrors("bank_certificate", input, 2026);
  assert.ok(errors.some((error) => error.includes("must equal Net Profit Credited")));
  assert.equal(
    fields.readApprovedBankProfitCertificate(input, 2026),
    null,
    "invalid figures cannot be represented as an approved canonical payload",
  );
});

test("tax year, reporting dates, rate, CNIC and currency are validated", () => {
  const input = makeFields({
    ...fixtureValues,
    [L.taxYear]: 2025,
    [L.reportingPeriodStart]: "2025-06-30",
    [L.withholdingRate]: "101%",
    [L.taxpayerCnic]: "1234",
    [L.currency]: "PK",
  });
  const errors = review.getDocumentReviewRequiredErrors("bank_certificate", input, 2026);
  assert.ok(errors.some((error) => error.includes("Tax Year must be 2026")));
  assert.ok(errors.some((error) => error.includes("Reporting period must fall within Tax Year 2026")));
  assert.ok(errors.some((error) => error.includes("rate from 0 to 100")));
  assert.ok(errors.includes("Taxpayer CNIC must contain exactly 13 digits."));
  assert.ok(errors.includes("Currency must be a three-letter currency code, such as PKR."));
});

test("Sukuk-specific fields are conditional and never inferred", () => {
  const input = makeFields({
    ...fixtureValues,
    [L.instrumentCategory]: "Sukuk",
    [L.sukukHolderType]: null,
    [L.sukukReturnBand]: null,
  });
  const errors = review.getDocumentReviewRequiredErrors("bank_certificate", input, 2026);
  assert.ok(errors.some((error) => error.startsWith(`${L.sukukHolderType} is required`)));
  assert.ok(errors.some((error) => error.startsWith(`${L.sukukReturnBand} is required`)));
  assert.equal(review.isDocumentReviewRequiredField("bank_certificate", L.sukukHolderType, input), true);
  const completed = makeFields({
    ...fixtureValues,
    [L.instrumentCategory]: "Sukuk",
    [L.sukukHolderType]: "Individual/AOP",
    [L.sukukReturnBand]: "Below PKR 1,000,000",
  });
  assert.deepEqual(review.getDocumentReviewRequiredErrors("bank_certificate", completed, 2026), []);
});

test("duplicate aliases block approval instead of silently selecting one", () => {
  const input = makeFields();
  input.push({ label: "Gross Annual Profit", value: 999999 });
  assert.ok(
    review
      .getDocumentReviewRequiredErrors("bank_certificate", input, 2026)
      .some((error) => error.includes("Gross Annual Profit / Yield: duplicate fields")),
  );
});

test("generic optional holder/return labels do not collide with canonical Sukuk-only fields", () => {
  const input = makeFields({
    ...fixtureValues,
    [L.sukukHolderType]: "Not applicable - bank deposit",
    [L.sukukReturnBand]: "Not applicable",
  });
  input.push(
    { label: "Holder Type", value: "Individual / AOP" },
    { label: "Return Band", value: "Not applicable" },
  );
  assert.deepEqual(review.getDocumentReviewRequiredErrors("bank_certificate", input, 2026), []);
});

test("approval, edit invalidation, UI, and filing-completeness gates are wired", () => {
  const action = fs.readFileSync(path.join(root, "app/actions/extraction.ts"), "utf8");
  const ui = fs.readFileSync(path.join(root, "components/tax/filing/wizard-documents-step.tsx"), "utf8");
  const hook = fs.readFileSync(path.join(root, "components/tax/filing/hooks/use-filing-documents.ts"), "utf8");
  const gate = fs.readFileSync(path.join(root, "lib/tax/filing-completeness.ts"), "utf8");
  const packet = fs.readFileSync(path.join(root, "app/actions/packet.ts"), "utf8");
  assert.match(action, /mapping: "BANK_PROFIT_CERTIFICATE"/);
  assert.match(action, /approvedBankProfitCertificate: canonical/);
  assert.match(action, /invalidateFilingForDocumentChange/);
  assert.match(ui, /isBankProfitCertificate \|\|/);
  assert.match(ui, /Gross profit minus tax withheld must/);
  assert.match(hook, /Save & Approve Map again before continuing/);
  assert.match(gate, /"bank_certificate"/);
  assert.match(gate, /Bank Profit Certificate: \$\{error\}/);
  assert.match(packet, /source: "bank_profit"/);
  assert.match(packet, /statementGrossProfit: gross/);
  assert.match(packet, /taxDeducted: approved\.taxDeducted/);
  assert.match(packet, /taxChargeable: toMoneyNumber\(line\.calculatedTax\)/);
  assert.match(packet, /investment,/);
  assert.match(packet, /approved\.iban \|\| approved\.accountNumber/);
  assert.match(packet, /approved\.bankName\.trim\(\)/);
  assert.match(packet, /bankProfitSources,/);
  const desktop = fs.readFileSync(path.join(root, "electron-connect/main.js"), "utf8");
  assert.match(desktop, /const executionGroups = plan\.groups\.flatMap/);
  assert.match(desktop, /Array\.from\(bankProfitCodes\)\.map/);
});

test("multiple Bank Profit categories keep separate certificate slots and IRIS rows", () => {
  const deposit = "bank-or-financial-institution-deposit";
  const government = "government-securities-non-individual";
  assert.equal(documentSlots.bankProfitCertificateSlot(deposit), `bank_certificate:${deposit}`);
  assert.equal(documentSlots.bankProfitCertificateSlot(government), `bank_certificate:${government}`);
  assert.equal(documentSlots.bankProfitCertificateSubcategory(`bank_certificate:${government}`), government);
  assert.equal(documentSlots.bankProfitCertificateSubcategory("bank_certificate:not-a-rule"), null);

  const map = portalFieldMap.buildPortalFieldMap({
    taxYear: 2026,
    filerType: "myself",
    taxpayerListStatus: "ATL",
    ledgerEntries: [{ id: "ledger", entryType: "INCOME", category: "BANK_PROFIT", description: "Combined", amount: 1700000 }],
    bankProfitSources: [
      { documentId: "deposit", subcategory: deposit, investment: "Deposit", contents: "Deposit evidence", statementGrossProfit: 450000, taxDeducted: 90000, taxChargeable: 90000 },
      { documentId: "government", subcategory: government, investment: "Government security", contents: "Security evidence", statementGrossProfit: 1250000, taxDeducted: 250000, taxChargeable: 250000 },
    ],
  });
  const mapped = portalFieldMap.flattenPortalFieldMap(map).filter((field) => ["64040052", "64040053"].includes(field.irisCode));
  assert.equal(mapped.length, 6);
  assert.deepEqual(new Set(mapped.map((field) => field.irisCode)), new Set(["64040052", "64040053"]));
});
