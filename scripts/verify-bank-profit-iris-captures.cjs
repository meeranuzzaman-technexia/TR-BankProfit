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
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
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
const capturesAvailable = fs.existsSync(captureRoot);

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

function documentFor(name) {
  return new JSDOM(decodeMhtml(path.join(captureRoot, name))).window.document;
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

test("the stable Other Sources page proves 500312 is computed and 64040052 has one writable child", (context) => {
  if (!capturesAvailable) return context.skip(`no captures at ${captureRoot}`);
  const receipts = documentFor("Other Sources - Receipts-Deductions.mhtml");
  assert.deepEqual(inputState(rowsFor(receipts, "500312")[0]), ["D", "D", "D", "D"]);

  const deductions = documentFor("Other Sources - Tax Deductions.mhtml");
  assert.deepEqual(
    rowsFor(deductions, "64040052").map(inputState),
    [
      ["D", "D", "D"],
      ["E", "E", "E"],
    ],
  );
});

test("every supported Section 151 category is tied to the exact captured Final Tax code", (context) => {
  if (!capturesAvailable) return context.skip(`no captures at ${captureRoot}`);
  const popup = documentFor(
    "Other Sources - Tax Deductions Final Tax Popup fields selected.mhtml",
  );
  for (const [subcategory, target] of Object.entries(BANK_PROFIT_FINAL_TAX_ROWS)) {
    assert.ok(rowsFor(popup, target.code).length > 0, `${subcategory} -> ${target.code}`);
  }
});

test("desktop plan routes 64040052 to Other Sources and the filler picks its writable duplicate", (context) => {
  if (!capturesAvailable) return context.skip(`no captures at ${captureRoot}`);
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

  const dom = new JSDOM(
    decodeMhtml(path.join(captureRoot, "Other Sources - Tax Deductions.mhtml")),
  );
  global.document = dom.window.document;
  global.window = dom.window;
  global.Event = dom.window.Event;
  const results = dom.window.eval(
    filler.buildInPageFillScript(fields.map(filler.prepareField), { dryRun: true }),
  );
  assert.deepEqual(results.map((result) => result.status), ["filled", "filled", "filled"]);
  assert.deepEqual(results.map((result) => result.columnIndex), [0, 1, 2]);
});
