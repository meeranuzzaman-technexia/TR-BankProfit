#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, ...rest);
};
require.extensions[".ts"] = function (module, filename) {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    filename,
  );
};

const { BANK_PROFIT_FINAL_TAX_ROWS } = require(path.join(
  root,
  "lib/tax/iris-bank-profit-capture.ts",
));
const navigation = require(path.join(root, "electron-connect/iris-navigation.js"));
const filler = require(path.join(root, "electron-connect/iris-row-filler.js"));
const captureRoot =
  process.env.BANK_PROFIT_IRIS_CAPTURES ||
  path.join(os.homedir(), "Downloads", "Bank Profit HTML");

// Accept both the original MHTML archive names and the user's uploaded HTML/HTM
// names. Files are read in place; the test does not copy taxpayer portal pages.
const CAPTURE_FILES = {
  receipts: [
    "Other Sources - Receipts-Deductions.mhtml",
    "Other Source - Receipts-Deductions.htm",
  ],
  deductions: [
    "Other Sources - Tax Deductions.mhtml",
    "Other Source - Tax Deductions.html",
  ],
  finalTaxSelected: [
    "Other Sources - Tax Deductions Final Tax Popup fields selected.mhtml",
    "Other Source - Tax Deductions - Popup All fields selected.html",
  ],
  computations: [
    "Tax Chargable-Payments - Computations.html",
    "Tax Chargable-Payments - Computations.mhtml",
  ],
};

function hasCapture(name) {
  const candidates = CAPTURE_FILES[name] || [name];
  return candidates.some((candidate) =>
    fs.existsSync(path.join(captureRoot, candidate)),
  );
}

function capturePath(name) {
  const candidates = CAPTURE_FILES[name] || [name];
  const found = candidates
    .map((candidate) => path.join(captureRoot, candidate))
    .find((candidate) => fs.existsSync(candidate));
  assert.ok(
    found,
    `missing ${name} capture under ${captureRoot}; tried ${candidates.join(", ")}`,
  );
  return found;
}

function decodeMhtml(file) {
  const source = fs.readFileSync(file, "latin1");
  const part = source.match(
    /Content-Type: text\/html[^\r\n]*[\s\S]*?\r?\n\r?\n([\s\S]*?)\r?\n------MultipartBoundary/s,
  );
  assert.ok(part, `${path.basename(file)} must contain an HTML MIME part`);
  const quotedPrintable = part[1]
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  return Buffer.from(quotedPrintable, "latin1").toString("utf8");
}

function htmlFor(name) {
  const file = capturePath(name);
  return /\.mhtml?$/i.test(file)
    ? decodeMhtml(file)
    : fs.readFileSync(file, "utf8");
}

function documentFor(name) {
  return new JSDOM(htmlFor(name)).window.document;
}

function rowsFor(document, code) {
  return [...document.querySelectorAll(".tableRows.dataRow[id]")].filter(
    (row) => row.id === code,
  );
}

function inputState(row) {
  return [...row.querySelectorAll(".data-middle-child-wapper input")].map(
    (input) => (input.disabled ? "D" : "E"),
  );
}

function columnHeadersForRow(row) {
  for (let parent = row.parentElement; parent; parent = parent.parentElement) {
    const bars = [...parent.querySelectorAll(".heading-bar")].filter((bar) =>
      [...bar.querySelectorAll("strong")].some(
        (label) => label.textContent.trim().toLowerCase() === "code",
      ),
    );
    if (bars.length === 1) {
      return [...bars[0].querySelectorAll("strong")]
        .map((label) => label.textContent.replace(/\s+/g, " ").trim())
        .filter((label) => !/^(description|code|actions?)$/i.test(label));
    }
    if (bars.length > 1) return [];
  }
  return [];
}

const capturesAvailable =
  fs.existsSync(captureRoot) &&
  ["receipts", "deductions", "finalTaxSelected"].every((name) =>
    CAPTURE_FILES[name].some((candidate) =>
      fs.existsSync(path.join(captureRoot, candidate)),
    ),
  );

test("the Other Sources income row is computed; 64040052 has a writable Final Tax detail row", (context) => {
  if (!capturesAvailable) return context.skip(`no complete captures at ${captureRoot}`);
  const receipts = documentFor("receipts");
  const profitOnDebt = rowsFor(receipts, "500312");
  assert.equal(profitOnDebt.length, 1);
  assert.deepEqual(inputState(profitOnDebt[0]), ["D", "D", "D", "D"]);
  assert.deepEqual(columnHeadersForRow(profitOnDebt[0]), [
    "Total Amount",
    "Subject to Final Tax",
    "Subject to Exemption",
    "Subject to Normal Tax",
  ]);

  const deductions = documentFor("deductions");
  const bankDepositRows = rowsFor(deductions, "64040052");
  assert.deepEqual(
    bankDepositRows.map(inputState),
    [
      ["D", "D", "D"],
      ["E", "E", "E"],
    ],
  );
  assert.ok(
    bankDepositRows[1].classList.contains("section-detail-child-row"),
    "the only writable duplicate is the post-selection detail child",
  );
  assert.deepEqual(columnHeadersForRow(bankDepositRows[1]), [
    "Taxable Amount",
    "Tax Deducted",
    "Tax Chargeable",
  ]);
});

test("all supplied profit categories have an exact Final Tax code and the verified Investment-detail route", (context) => {
  if (!capturesAvailable) return context.skip(`no complete captures at ${captureRoot}`);
  const popup = documentFor("finalTaxSelected");
  for (const [subcategory, target] of Object.entries(BANK_PROFIT_FINAL_TAX_ROWS)) {
    const rows = rowsFor(popup, target.code);
    assert.ok(rows.length > 0, `${subcategory} -> ${target.code} is in the capture`);
    assert.equal(target.writableDetailCreationVerified, true);
  }
});

test("the Computations capture confirms surcharge code 923184 uses the writable Total Income column", (context) => {
  if (!hasCapture("computations"))
    return context.skip(`no Computations capture at ${captureRoot}`);
  const computations = documentFor("computations");
  const surcharge = rowsFor(computations, "923184");
  assert.equal(surcharge.length, 1);
  assert.deepEqual(columnHeadersForRow(surcharge[0]), [
    "Total Income",
    "Subject to Final Tax",
    "Subject to Exemption",
    "Subject to Normal Tax",
  ]);
  assert.deepEqual(inputState(surcharge[0]), ["E", "D", "D", "D"]);
});

test("desktop plan routes 64040052 to Other Sources and the filler selects its writable duplicate", (context) => {
  if (!capturesAvailable) return context.skip(`no complete captures at ${captureRoot}`);
  const tour = {
    sections: [
      {
        id: "other_sources_tax_deductions",
        mappingVerified: true,
        rows: [
          { code: "64040052", gridTitle: "Final Tax" },
          { code: "64040052", gridTitle: "Final Tax" },
        ],
      },
      { id: "withholding", rows: [{ code: "64040052", gridTitle: "Final Tax" }] },
    ],
  };
  const fields = ["Taxable Amount", "Tax Deducted", "Tax Chargeable"].map(
    (column, index) => ({
      irisCode: "64040052",
      column,
      value: ["45000", "9000", "9000"][index],
      rowSelector: '[id="64040052"]',
      label: column,
    }),
  );
  const plan = navigation.planSectionFills(fields, tour);
  assert.equal(plan.unlocated.length, 0);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].sectionId, "other_sources_tax_deductions");
  assert.equal(plan.groups[0].gridTitle, "Final Tax");

  const dom = new JSDOM(htmlFor("deductions"));
  global.document = dom.window.document;
  global.window = dom.window;
  global.Event = dom.window.Event;
  const results = dom.window.eval(
    filler.buildInPageFillScript(fields.map(filler.prepareField), { dryRun: true }),
  );
  assert.deepEqual(results.map((result) => result.status), ["filled", "filled", "filled"]);
  assert.deepEqual(results.map((result) => result.columnIndex), [0, 1, 2]);
});
