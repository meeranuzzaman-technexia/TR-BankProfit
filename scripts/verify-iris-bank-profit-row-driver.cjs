#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const driver = require("../electron-connect/iris-bank-profit-row-driver.js");
const navigation = require("../electron-connect/iris-navigation.js");
const { FakeIrisBankProfit, CODE, LABEL } = require("./lib/fake-iris-bank-profit.cjs");

const ROOT = path.join(__dirname, "..");
const ROW_FIELD = {
  irisCode: CODE,
  label: LABEL,
  column: "Taxable Amount",
  value: "45000",
  sourceGroup: "bankProfitFields",
};
const INVESTMENT = "Bank savings deposit — synthetic";
const CONTENTS = "1. Account / IBAN PK00TEST0000000000000000\n2. Bank savings deposit — synthetic\n3. Test Bank Limited";
const TARGETS = {
  "64040052": "Profit on Debt u/s 151(1)(b) from Bank Accounts / Deposits",
  "64040053": "Profit on Debt u/s 151(1)(c) from Government Securities",
  "64040054": "151(1) (d) - Profit on Debt u/s 151 from Others",
  "64330056": "Return on Investment in Sukuks u/s 151(1A) @ 25%",
  "64330055": "Return on Investment in Sukuks u/s 151(1A) @ 12.5%",
  "64330054": "Return on Investment in Sukuks u/s 151(1A) @ 10%",
};

function harness(options = {}) {
  const fake = options.fake || new FakeIrisBankProfit(options.fakeOptions);
  const steps = [];
  return {
    fake,
    steps,
    run: (extra = {}) =>
      driver.ensureBankProfitFinalTaxRow(fake, {
        mode: "live",
        code: fake.code,
        investment: INVESTMENT,
        contents: CONTENTS,
        sleep: async () => {},
        timeoutMs: 50,
        onStep: (step, detail) => steps.push({ step, detail }),
        ...extra,
      }),
  };
}

test("capture contract: Final Tax chooser has the exact checked, enabled Bank Profit option", () => {
  const modal = fs.readFileSync(
    path.join(ROOT, "test-fixtures/iris/other-sources/modal-add-final-tax.html"),
    "utf8",
  );
  const doc = new JSDOM(modal).window.document;
  assert.equal(doc.querySelector("[mat-dialog-title] .left").textContent.trim(), "Add Final Tax");
  const cards = [...doc.querySelectorAll(".source-card")];
  assert.equal(cards.length, 1);
  assert.equal(cards[0].querySelector("p").textContent.trim(), LABEL);
  const checkbox = cards[0].querySelector('input[type="checkbox"]');
  assert.equal(cards[0].classList.contains("source-card--checked"), true);
  assert.equal(cards[0].querySelector("mat-checkbox").classList.contains("mat-mdc-checkbox-checked"), true);
  assert.equal(checkbox.classList.contains("mdc-checkbox--selected"), true);
  assert.equal(checkbox.hasAttribute("checked"), false, "the capture is serialized markup, so the live property is not represented as an attribute");
  assert.equal(checkbox.disabled, false);
  assert.equal([...doc.querySelectorAll("button")].find((b) => b.textContent.trim() === "ADD").disabled, false);

  const liveDom = new JSDOM(modal, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const state = liveDom.window.eval(
    driver.buildPageScript({ op: "dialog_state", title: driver.DIALOG_TITLE }),
  );
  assert.equal(state.targetChecked, true);
  assert.equal(state.checkedCount, 1);
  assert.equal(state.addEnabled, true);
});

test("capture contract: absent 64040052 row, expanded Final Tax grid, exact three headers", () => {
  const page = fs.readFileSync(
    path.join(ROOT, "test-fixtures/iris/other-sources/final-tax-row-missing.html"),
    "utf8",
  );
  const fake = new FakeIrisBankProfit();
  assert.equal(fake.rows().length, 0);
  const panel = [...fake.container.querySelectorAll("mat-expansion-panel")].find(
    (item) => item.querySelector("mat-panel-title")?.textContent.trim() === "Final Tax",
  );
  assert.ok(panel);
  assert.deepEqual(
    [...panel.querySelectorAll(".heading-bar strong")]
      .map((item) => item.textContent.trim())
      .filter((label) => !["Description", "Code"].includes(label)),
    ["Taxable Amount", "Tax Deducted", "Tax Chargeable"],
  );
  assert.match(page, /Other Sources/);
});

test("capture contract: 64040052 parent Add opens the exact Investment detail dialog", () => {
  const dialog = new JSDOM(
    fs.readFileSync(
      path.join(ROOT, "test-fixtures/iris/other-sources/investment-dialog-empty.html"),
      "utf8",
    ),
  ).window.document;
  const investment = dialog.querySelector('input[placeholder="Investment"]');
  const contents = dialog.querySelector("textarea");
  assert.equal(investment?.getAttribute("maxlength"), "50");
  assert.match(contents?.getAttribute("placeholder") || "", /Account, Bond or Certificates/);
  assert.match(contents?.getAttribute("placeholder") || "", /Current or Savings/);
  assert.match(contents?.getAttribute("placeholder") || "", /Name of Institution/);

  const afterAdd = new JSDOM(
    fs.readFileSync(
      path.join(ROOT, "test-fixtures/iris/other-sources/final-tax-row-after-add.html"),
      "utf8",
    ),
  ).window.document;
  const rows = [...afterAdd.querySelectorAll('[id="64040052"]')];
  assert.equal(rows.length, 2);
  assert.equal(
    rows[0].querySelector('#add-adjustable-tax-generic[title="Add"][fonticon="add"]') !== null,
    true,
  );
  assert.equal(rows[1].classList.contains("section-detail-child-row"), true);
});

test("plan: a verified absent 64040052 code routes to Other Sources / Final Tax, not unlocated", () => {
  const tour = {
    complete: true,
    sections: [{ id: "other_sources_tax_deductions", mappingVerified: false, rows: [] }],
  };
  const planned = navigation.planSectionFills([ROW_FIELD], tour);
  assert.equal(planned.groups.length, 1);
  assert.equal(planned.groups[0].sectionId, "other_sources_tax_deductions");
  assert.equal(planned.groups[0].gridTitle, "Final Tax");
  assert.equal(planned.unlocated.length, 0);

  const withoutTour = navigation.planSectionFills([ROW_FIELD], null);
  assert.equal(withoutTour.groups.length, 1);
  assert.equal(withoutTour.groups[0].sectionId, "other_sources_tax_deductions");
  assert.equal(withoutTour.groups[0].gridTitle, "Final Tax");

  assert.deepEqual(
    navigation.validateRequiredGridTarget(
      "other_sources_tax_deductions",
      "Final Tax",
      [],
    ),
    {
      ok: true,
      normalizedGridTitle: "final tax",
      safeRowCodes: [],
    },
    "the exact, evidence-backed absent row may navigate by verified grid without pretending its code was observed",
  );
  assert.equal(
    navigation.validateRequiredGridTarget("tax_deductions", "Final Tax", []).status,
    "unsupported_grid_rows",
  );
  assert.equal(
    navigation.validateRequiredGridTarget(
      "other_sources_tax_deductions",
      "Final Tax",
      ["7052"],
    ).status,
    "unsupported_grid_rows",
  );
});

test("live: opens only Final Tax, adds 64040052, fills its Investment detail, then verifies parent/detail cells", async () => {
  const h = harness();
  const out = await h.run();
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.status, "row_added");
  assert.equal(out.added, true);
  assert.equal(h.fake.rows().length, 2);
  const [summary, detail] = h.fake.rows();
  assert.equal(summary.classList.contains("section-detail-child-row"), false);
  assert.equal(detail.classList.contains("section-detail-child-row"), true);
  assert.equal(summary.querySelector(".data-first-child").textContent, CODE);
  assert.equal(detail.querySelector(".data-first-child").textContent, CODE);
  assert.equal(summary.querySelectorAll("input").length, 3);
  assert.ok([...summary.querySelectorAll("input")].every((input) => input.disabled));
  assert.equal(detail.querySelectorAll("input").length, 3);
  assert.ok([...detail.querySelectorAll("input")].every((input) => !input.disabled && !input.readOnly));
  assert.deepEqual(
    h.fake.clicks.filter((click) => click.tag === "BUTTON").map((click) => click.text),
    ["+ Section", "ADD", "ADD"],
  );
  assert.equal(
    h.fake.clicks.some(
      (click) => click.tag === "MAT-ICON" && click.id === "add-adjustable-tax-generic",
    ),
    true,
  );
  assert.match(detail.querySelector(".row-description-text").textContent, /Bank savings deposit/);
  assert.match(detail.querySelector(".row-description-text").textContent, /Test Bank Limited/);
  assert.deepEqual(
    h.fake.clicks.filter((click) => /save|calculate|submit|payment/i.test(click.text)),
    [],
  );
  assert.equal(h.fake.dialogs().length, 0);
  assert.ok(h.steps.some((step) => step.step === "bank_profit_row_added"));
});

test("live: an existing verified row is reused without opening the chooser", async () => {
  const h = harness({ fakeOptions: { preexistingRow: true } });
  const out = await h.run();
  assert.equal(out.ok, true);
  assert.equal(out.status, "row_present");
  assert.equal(out.added, false);
  assert.equal(h.fake.rows().length, 2);
  assert.equal(h.fake.clicks.length, 0);
});

test("live: every supported profit category selects only its exact popup option and creates its own coded child row", async () => {
  for (const [code, label] of Object.entries(TARGETS)) {
    const h = harness({ fakeOptions: { targetCode: code, targetLabel: label } });
    const out = await h.run();
    assert.equal(out.ok, true, `${code}: ${JSON.stringify(out)}`);
    assert.equal(h.fake.rows().length, 2, code);
    assert.ok(h.fake.rows().every((row) => row.id === code), code);
    assert.match(h.fake.rows()[1].textContent, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(
      h.fake.clicks.filter((click) => click.inDialog && click.tag === "INPUT").length,
      0,
      `${code}: the already-selected exact option must not toggle another category`,
    );
  }
});

test("live: resumes the already-open Investment popup shown by IRIS", async () => {
  const fake = new FakeIrisBankProfit();
  fake.addParentRow();
  fake.openInvestmentDialog();
  const h = harness({ fake });
  const out = await h.run();
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.status, "row_detail_added");
  assert.equal(fake.rows().length, 2);
  assert.equal(
    fake.clicks.some((click) => click.id === "add-adjustable-tax-generic"),
    false,
  );
});

test("safety: missing certificate detail stops before opening any chooser or detail modal", async () => {
  const fake = new FakeIrisBankProfit();
  const out = await driver.ensureBankProfitFinalTaxRow(fake, {
    mode: "live",
    sleep: async () => {},
    timeoutMs: 50,
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, "investment_details_missing");
  assert.equal(fake.clicks.length, 0);
});

test("live: an unverified existing row shape is held rather than duplicated", async () => {
  const h = harness({ fakeOptions: { preexistingRow: true, malformedPreexistingRow: true } });
  const out = await h.run();
  assert.equal(out.ok, false);
  assert.equal(out.status, "row_layout_unverified");
  assert.equal(h.fake.rows().length, 1);
  assert.equal(h.fake.clicks.length, 0);
});

test("live: an unchecked Bank Profit option is ticked exactly once before ADD", async () => {
  const h = harness({ fakeOptions: { targetChecked: false } });
  const out = await h.run();
  assert.equal(out.ok, true);
  assert.equal(out.status, "row_added");
  assert.ok(h.fake.clicks.some((click) => click.tag === "INPUT"));
  assert.equal(h.fake.rows().length, 2);
});

test("safety: any other checked source cancels the chooser without ADD", async () => {
  const h = harness({ fakeOptions: { extraChecked: ["Dividend u/s 150 @7.5%"] } });
  const out = await h.run();
  assert.equal(out.ok, false);
  assert.equal(out.status, "unexpected_sources_selected");
  assert.equal(h.fake.rows().length, 0);
  assert.ok(h.fake.clicks.some((click) => click.inDialog && click.text === "Cancel"));
  assert.equal(h.fake.clicks.some((click) => click.inDialog && click.text === "ADD"), false);
  assert.equal(h.fake.dialogs().length, 0);
});

test("safety: last-moment source selection or disabled ADD is rechecked before clicking", async () => {
  const lateSource = harness({
    fakeOptions: { lateOtherChecked: "Dividend u/s 150 @7.5%" },
  });
  const lateSourceResult = await lateSource.run();
  assert.equal(lateSourceResult.status, "unexpected_sources_selected_before_add");
  assert.equal(lateSource.fake.rows().length, 0);
  assert.equal(lateSource.fake.clicks.some((click) => click.inDialog && click.text === "ADD"), false);
  assert.equal(lateSource.fake.dialogs().length, 0);

  const lateDisabled = harness({ fakeOptions: { lateAddDisabled: true } });
  const lateDisabledResult = await lateDisabled.run();
  assert.equal(lateDisabledResult.status, "add_button_disabled_before_add");
  assert.equal(lateDisabled.fake.rows().length, 0);
  assert.equal(lateDisabled.fake.clicks.some((click) => click.inDialog && click.text === "ADD"), false);
  assert.equal(lateDisabled.fake.dialogs().length, 0);
});

test("safety: a locked target with no row and a missing option both cancel without ADD", async () => {
  for (const fakeOptions of [
    { targetDisabled: true },
    { omitTarget: true },
  ]) {
    const h = harness({ fakeOptions });
    const out = await h.run();
    assert.equal(out.ok, false);
    assert.ok(["bank_profit_option_locked", "bank_profit_option_missing"].includes(out.status));
    assert.equal(h.fake.rows().length, 0);
    assert.equal(h.fake.clicks.some((click) => click.inDialog && click.text === "ADD"), false);
    assert.equal(h.fake.dialogs().length, 0);
  }
});

test("safety: duplicate options, ADD buttons, or dialogs are ambiguous and never added", async () => {
  const duplicateTarget = harness({ fakeOptions: { duplicateTarget: true } });
  const duplicateChoice = await duplicateTarget.run();
  assert.equal(duplicateChoice.status, "bank_profit_option_ambiguous");
  assert.equal(duplicateTarget.fake.rows().length, 0);
  assert.equal(duplicateTarget.fake.dialogs().length, 0);
  assert.equal(duplicateTarget.fake.clicks.some((click) => click.inDialog && click.text === "ADD"), false);

  const duplicateAdd = harness({ fakeOptions: { duplicateAdd: true } });
  const addAmbiguous = await duplicateAdd.run();
  assert.equal(addAmbiguous.status, "add_button_disabled");
  assert.equal(duplicateAdd.fake.rows().length, 0);
  assert.equal(duplicateAdd.fake.dialogs().length, 0);
  assert.equal(duplicateAdd.fake.clicks.some((click) => click.inDialog && click.text === "ADD"), false);

  const duplicateDialog = harness({ fakeOptions: { duplicateDialog: true } });
  const dialogsAmbiguous = await duplicateDialog.run();
  assert.equal(dialogsAmbiguous.status, "ambiguous_dialog");
  assert.equal(duplicateDialog.fake.rows().length, 0);
  assert.equal(duplicateDialog.fake.dialogs().length, 2);
  assert.equal(duplicateDialog.fake.clicks.some((click) => click.inDialog), false);
});

test("safety: disabled ADD, dry mode, and verify-only mode never create a row", async () => {
  const disabled = harness({ fakeOptions: { addDisabled: true } });
  const denied = await disabled.run();
  assert.equal(denied.status, "add_button_disabled");
  assert.equal(disabled.fake.rows().length, 0);
  assert.equal(disabled.fake.dialogs().length, 0);
  assert.equal(disabled.fake.clicks.some((click) => click.inDialog && click.text === "ADD"), false);

  const dryFake = new FakeIrisBankProfit();
  const dry = await driver.ensureBankProfitFinalTaxRow(dryFake, {
    mode: "dry",
    sleep: async () => {},
    timeoutMs: 50,
  });
  assert.equal(dry.status, "row_missing_dry");
  assert.equal(dryFake.clicks.length, 0);
  assert.equal(dryFake.rows().length, 0);

  const dryPopupFake = new FakeIrisBankProfit();
  dryPopupFake.openDialog();
  const dryPopup = await driver.ensureBankProfitFinalTaxRow(dryPopupFake, {
    mode: "dry",
    sleep: async () => {},
    timeoutMs: 50,
  });
  assert.equal(dryPopup.status, "row_missing_dry");
  assert.equal(dryPopupFake.clicks.length, 0);
  assert.equal(dryPopupFake.dialogs().length, 1);

  const dryExistingPopupFake = new FakeIrisBankProfit({ preexistingRow: true });
  dryExistingPopupFake.openDialog();
  const dryExistingPopup = await driver.ensureBankProfitFinalTaxRow(dryExistingPopupFake, {
    mode: "dry",
    sleep: async () => {},
    timeoutMs: 50,
  });
  assert.equal(dryExistingPopup.status, "row_present");
  assert.equal(dryExistingPopupFake.clicks.length, 0);
  assert.equal(dryExistingPopupFake.dialogs().length, 1);

  const verifyOnlyFake = new FakeIrisBankProfit();
  const verifyOnly = await driver.ensureBankProfitFinalTaxRow(verifyOnlyFake, {
    mode: "live",
    addIfMissing: false,
    sleep: async () => {},
    timeoutMs: 50,
  });
  assert.equal(verifyOnly.status, "row_missing_verify_only");
  assert.equal(verifyOnlyFake.clicks.length, 0);

  const verifyOnlyPopupFake = new FakeIrisBankProfit();
  verifyOnlyPopupFake.openDialog();
  const verifyOnlyPopup = await driver.ensureBankProfitFinalTaxRow(verifyOnlyPopupFake, {
    mode: "live",
    addIfMissing: false,
    sleep: async () => {},
    timeoutMs: 50,
  });
  assert.equal(verifyOnlyPopup.status, "row_missing_verify_only");
  assert.equal(verifyOnlyPopupFake.clicks.length, 0);
  assert.equal(verifyOnlyPopupFake.dialogs().length, 1);
});

test("click whitelist: row driver cannot name another row, dialog, selector or return action", () => {
  assert.throws(() => driver.buildPageScript({ op: "inspect", code: "7052" }), /unsupported profit category code/);
  assert.match(
    driver.buildPageScript({ op: "inspect", code: "64040053" }),
    /Profit on Debt u\/s 151\(1\)\(c\) from Government Securities/,
  );
  assert.throws(() => driver.buildPageScript({ op: "dialog_state", title: "Add Personal Expenses" }), /only Add Final Tax/);
  assert.throws(() => driver.buildPageScript({ op: "dialog_tick", title: driver.DIALOG_TITLE, label: "Dividend" }), /only the verified Bank Profit/);
  assert.throws(() => driver.buildPageScript({ op: "dialog_click", title: driver.DIALOG_TITLE, button: "Save" }), /only Add Final Tax ADD or Cancel/);
  assert.throws(() => driver.buildPageScript({ op: "open_final_tax_add", rowId: "7052" }), /no dynamic target/);
  assert.throws(() => driver.buildPageScript({ op: "open_investment_detail", rowId: "7052" }), /no dynamic target/);
  assert.throws(() => driver.buildPageScript({ op: "investment_dialog_click", button: "Save" }), /only Investment ADD/);
  assert.throws(
    () => driver.buildPageScript({ op: "investment_dialog_fill", investment: "", contents: "x" }),
    /invalid Investment detail values/,
  );
});

test("desktop build packages the narrow Bank Profit row driver and wires it before live filling", () => {
  const agentPackage = JSON.parse(
    fs.readFileSync(path.join(ROOT, "electron-connect/package.json"), "utf8"),
  );
  assert.ok(agentPackage.build.files.includes("iris-bank-profit-row-driver.js"));
  const main = fs.readFileSync(path.join(ROOT, "electron-connect/main.js"), "utf8");
  assert.match(main, /irisBankProfitRowDriver\.ensureBankProfitFinalTaxRow/);
  assert.match(main, /isBankProfitFinalTaxGroup\s*\?\s*\[\]\s*:/);
  assert.match(main, /const addIfMissing = group\.fields\.some/);
  assert.match(main, /takenKeys\.has\(autofillItemKey\(field\)\)/);
  assert.match(main, /addIfMissing,/);
  assert.match(main, /investment:/);
  assert.match(main, /contents:/);
  assert.match(main, /sectionVerified = true/);
});
