// Regression guard: section-tab hit-test races (Angular accordion animation) must be
// retried, and the wealth driver must surface the hit-test reason in its log note.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
let pass = 0;
const nav = fs.readFileSync(path.join(root, "electron-connect/iris-navigation.js"), "utf8");
if (!/for \(let attempt = 1; attempt <= 10; attempt\+\+\) \{\s*tab = await runAction\("section-tab"\)/.test(nav))
  throw new Error("iris-navigation: section-tab retry loop missing");
if (!nav.includes('interaction: tab.actionResult?.interaction ?? null'))
  throw new Error("iris-navigation: tab failure does not propagate interaction");
pass += 1;
console.log("  ok - iris-navigation: section-tab retry + interaction propagation");
const drv = fs.readFileSync(path.join(root, "electron-connect/iris-wealth-driver.js"), "utf8");
if (!drv.includes("moved.interaction.reason")) throw new Error("wealth driver: hit-test reason not surfaced");
pass += 1;
console.log("  ok - iris-wealth-driver: section_unavailable note includes hit-test reason");

// New auto wealth rows: zakat -> 7076, WHT -> 7052 (previously "manual entry" packet items)
const wr = fs.readFileSync(path.join(root, "lib/tax/wealth-rows.ts"), "utf8");
if (!/case "OTHER_EXPENSE":[\s\S]*?return "7076"/.test(wr)) throw new Error("zakat->7076 missing");
if (!/case "TAX_PAYMENT":\s*return "7052"/.test(wr)) throw new Error("TAX_PAYMENT->7052 missing");
if (!/if \(!code \|\| !WEALTH_EXPENSE_ROWS\[code\]\)/.test(fs.readFileSync(path.join(root, "lib/tax/portal-field-map.ts"), "utf8")))
  throw new Error("portal-field-map wealth totals pipeline changed");
pass += 2;

console.log('  ok - wealth-rows: zakat->7076, WHT->7052 auto mappings');
console.log(`\nwealth nav retry sanity: ${pass} assertions passed`);
