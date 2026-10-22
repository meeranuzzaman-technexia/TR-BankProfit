import contract from "@/electron-connect/iris-business-contract.json";
import type { PortalFieldMapEntry } from "./portal-field-map";

/** Optional reviewed source facts, never invented from an aggregate or bank debit. */
export const BUSINESS_SCHEDULE_LABELS = {
  openingStock: "Opening Stock", purchases: "Net Purchases Excluding Sales Tax and FED", closingStock: "Closing Stock",
  fuel: "Direct Costs - Fuel", wages: "Direct Costs - Salaries and Wages", power: "Direct Costs - Power",
  gas: "Direct Costs - Gas", repairs: "Direct Costs - Repair and Maintenance", stores: "Direct Costs - Stores and Spares",
  otherDirect: "Other Direct Expenses", unallocatedDirect: "Unallocated Direct Expenses",
  selling: "Selling Expenses Excluded from Gross Sales", purchaseBasis: "Purchases Exclude Sales Tax and FED",
  rent: "Business Rent", rates: "Business Rates Taxes and Cess", salaries: "Administrative Salaries",
  transport: "Business Transport", utilities: "Business Utilities", communication: "Business Communication",
  adminRepairs: "Administrative Repair and Maintenance", stationery: "Business Stationery and Office Supplies",
  marketing: "Business Marketing", bankCharges: "Bank Charges", otherIndirect: "Other Indirect Expenses Excluding Bank Charges",
  technicalFees: "Other Revenue - Technical and Professional Fees", assetGain: "Other Revenue - Accounting Gain on Assets",
  intangibleGain: "Other Revenue - Accounting Gain on Intangibles", scrap: "Other Revenue - Scrap Sales",
  otherRevenue: "Other Revenue - Other Receipts Excluding Scrap Sales",
  personalAddback: "Personal Expenditure Add-back", accountingDepreciation: "Accounting Depreciation", lossYear: "Loss Origin Tax Year", ordinaryLoss: "Ordinary Business Loss Brought Forward",
} as const;
type Key = keyof typeof BUSINESS_SCHEDULE_LABELS;
type Field = { label?: unknown; value?: unknown; confidence?: unknown };
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const aliases: Partial<Record<Key, string[]>> = {
  purchases: ["Purchases for the year", "Purchases / direct costs", "Net Purchases (excluding Sales Tax, Federal Excise)"],
  unallocatedDirect: ["Direct manufacturing expenses", "Additional direct expenses"],
  transport: ["Transport"], utilities: ["Utilities"], marketing: ["Marketing"],
};
/** Explicit reviewed facts only: never derive purchase tax basis from sales. */
export function parseBusinessPurchaseBasis(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  return ["true", "yes"].includes(text) ? true : ["false", "no"].includes(text) ? false : null;
}
export function isBusinessPurchaseBasisField(label: unknown): boolean {
  return norm(label) === norm(BUSINESS_SCHEDULE_LABELS.purchaseBasis);
}
export function businessPurchaseBasisRequired(fields: Field[] | undefined): boolean {
  return (fields || []).some(field => [BUSINESS_SCHEDULE_LABELS.purchases, ...(aliases.purchases || [])]
    .some(label => norm(label) === norm(field.label)) && field.value !== null && field.value !== undefined &&
    String(field.value).trim() !== "" && Number(String(field.value).replace(/,/g, "")) > 0);
}
/** The model must return an explicit purchase-specific quotation, not an inference. */
export function readBusinessPurchaseBasisEvidence(raw: unknown): { value: boolean; evidence: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as { value?: unknown; evidence?: unknown };
  const value = parseBusinessPurchaseBasis(p.value);
  const evidence = typeof p.evidence === "string" ? p.evidence.trim() : "";
  const tokens = [...evidence.matchAll(/Purchases\s+Exclude\s+Sales\s+Tax\s+and\s+FED\s*:\s*(true|false|yes|no)\b/gi)]
    .map(match => parseBusinessPurchaseBasis(match[1]));
  if (value === null || tokens.length !== 1 || tokens[0] !== value) return null;
  return { value, evidence: evidence.slice(0, 600) };
}
export function applyBusinessPurchaseBasisEvidence(raw: unknown, evidence: { value: boolean; evidence: string }) {
  const review = ensureBusinessScheduleReviewFields(raw) as { fields: Field[]; [key: string]: unknown };
  const matches = review.fields.filter(field => isBusinessPurchaseBasisField(field.label));
  if (matches.length !== 1 || parseBusinessPurchaseBasis(matches[0].value) !== null)
    throw new Error("Purchase basis is duplicated or already reviewed; no existing fact was overwritten.");
  return { ...review, fields: review.fields.map(field => isBusinessPurchaseBasisField(field.label)
    ? { ...field, value: evidence.value, confidence: 0.95 } : field),
    purchaseBasisSourceEvidence: evidence.evidence };
}
export function ensureBusinessScheduleReviewFields(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const p = raw as Record<string, unknown>;
  const fields: Field[] = Array.isArray(p.fields) ? p.fields.filter(f => f && typeof f === "object").map(f => ({ ...f })) : [];
  for (const [key, label] of Object.entries(BUSINESS_SCHEDULE_LABELS)) {
    const names = [label, ...(aliases[key as Key] ?? [])].map(norm);
    if (!fields.some(f => names.includes(norm(f.label)))) fields.push({ label, value: null, confidence: 0 });
  }
  return { ...p, fields };
}
function number(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value === "boolean") throw new Error("A boolean is not a business schedule amount.");
  const n = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("Business schedule amounts must be finite, non-negative; leave unknown amounts blank.");
  return Math.round(n * 100) / 100;
}
const close = (a: number, b: number) => Math.abs(a - b) <= 0.01;
export function buildReviewedBusinessSchedules(input: {
  taxYear: number; approvedInputs: Record<string, number | null>; salesExcludeIndirectTax: boolean;
  document: { id: string; extractedData: string | null; extractionStatus: string };
}) {
  if (input.document.extractionStatus !== "MAPPED") throw new Error("Review and map Business Books before forwarding their schedules.");
  const p = JSON.parse(input.document.extractedData ?? "null");
  if (!p || !Array.isArray(p.fields)) throw new Error("Business Books have no reviewed schedule fields.");
  const fields: Field[] = p.fields;
  const raw = (labels: string[]) => {
    const names = labels.map(norm), matches = fields.filter(f => names.includes(norm(f.label)) && f.value !== null && f.value !== undefined && String(f.value).trim() !== "");
    if (matches.length > 1) throw new Error(`Duplicate business source field: ${labels[0]}. Review before forwarding.`);
    return matches[0]?.value;
  };
  const get = (key: Key) => number(raw([BUSINESS_SCHEDULE_LABELS[key], ...(aliases[key] ?? [])]));
  if (Number(raw(["Tax Year"])) !== input.taxYear || String(raw(["Currency"]) ?? "").trim().toUpperCase() !== "PKR" ||
      !String(raw(["Business Name"]) ?? "").trim() || raw(["Reporting Period Start"]) !== `${input.taxYear-1}-07-01` || raw(["Reporting Period End"]) !== `${input.taxYear}-06-30`) {
    throw new Error("Business Books must have reviewed business identity, PKR and the matching full TY period.");
  }
  const annual = { businessGrossSales: "Sales for the year", businessOtherRevenue: "Other business receipts", businessCostOfSales: "Cost of sales", businessOperatingExpenses: "Business expenses", businessDepreciation: "Depreciation", businessInadmissibleExpenses: "Expenses that are not allowed", businessLossBroughtForward: "Business loss brought forward", businessWithholdingDeducted: "Tax already deducted on business receipts" };
  for (const [key,label] of Object.entries(annual)) {
    const value = number(raw([label]));
    if (value !== null && (input.approvedInputs[key] === null || !close(value,input.approvedInputs[key]!))) throw new Error(`Business Books and saved Business Profit disagree for ${label}. Review/save the form and recalculate before generating the packet.`);
  }
  const queued: PortalFieldMapEntry[] = [], completed: string[] = [], notes: string[] = [];
  const add = (section: keyof typeof contract, code: string, value: number, source: string) => {
    const spec = contract[section], row = (spec.rows as Record<string,{label:string;disabled:boolean[]}>)[code];
    if (!row || row.disabled[0]) throw new Error(`No captured editable business field for ${code}.`);
    queued.push({ ourCategory: source, ourDescription: source, ourAmount: value, irisCode: code, irisDescription: row.label, portalArea: "Business", section: spec.tab, column: "Total Amount", isTaxField: false, sourceEntryCount: 1 });
  };
  const direct: [Key,string][] = [["fuel","3072"],["wages","3071"],["power","3073"],["gas","3074"],["repairs","3077"],["stores","3076"],["otherDirect","3083"]];
  const opening=get("openingStock"), purchases=get("purchases"), closing=get("closingStock");
  const directTotal=direct.reduce((s,[k])=>s+(get(k)??0),0), unallocated=get("unallocatedDirect");
  const cost=input.approvedInputs.businessCostOfSales;
  if (opening!==null && purchases!==null && closing!==null && cost!==null && input.salesExcludeIndirectTax && parseBusinessPurchaseBasis(raw([BUSINESS_SCHEDULE_LABELS.purchaseBasis])) === true) {
    const represented=opening+purchases+directTotal-closing;
    if (represented > cost+0.01 || (unallocated!==null && !close(represented+unallocated,cost))) throw new Error("Reviewed stock/purchase/direct-cost breakdown does not match the saved cost of sales.");
    add("business_trading","3039",opening,"BUSINESS_OPENING_STOCK");add("business_trading","3059",purchases,"BUSINESS_NET_PURCHASES");add("business_trading","3099",closing,"BUSINESS_CLOSING_STOCK");
    for(const [key,code]of direct){const v=get(key);if(v!==null)add("business_trading",code,v,`BUSINESS_DIRECT_${key.toUpperCase()}`);}
    if(close(represented,cost))completed.push("businessCostOfSales");else notes.push(`Cost of sales still needs explicit direct-expense heads for PKR ${(cost-represented).toLocaleString()}; generic direct manufacturing expenses are not guessed into Others.`);
  }
  const selling=get("selling");if(selling!==null){if(selling!==0)throw new Error("Non-zero selling deductions need a reviewed net-sales basis; do not change the saved tax base silently.");add("business_trading","3019",selling,"BUSINESS_SELLING_DEDUCTIONS");}
  const admin:[Key,string][]=[["rent","3151"],["rates","3152"],["salaries","3154"],["transport","3155"],["utilities","3158"],["communication","3162"],["adminRepairs","3165"],["stationery","3166"],["marketing","3168"]];
  const adminTotal=admin.reduce((s,[k])=>s+(get(k)??0),0)+(get("bankCharges")??0)+(get("otherIndirect")??0), expenses=input.approvedInputs.businessOperatingExpenses;
  if(expenses!==null && adminTotal>expenses+0.01)throw new Error("Operating expense breakdown exceeds the saved business expenses; check duplicate heads.");
  if(expenses!==null && close(adminTotal,expenses)){
    for(const[key,code]of admin){const v=get(key);if(v!==null)add("business_admin",code,v,`BUSINESS_ADMIN_${key.toUpperCase()}`);}
    const bank=get("bankCharges"), other=get("otherIndirect");if(bank!==null||other!==null)add("business_admin","3180",(bank??0)+(other??0),"BUSINESS_OTHER_INDIRECT_WITH_BANK_CHARGES");
    completed.push("businessOperatingExpenses");
  }
  const revenues:[Key,string][]=[["technicalFees","3101"],["assetGain","3116"],["intangibleGain","3115"]];
  const revenueTotal=revenues.reduce((s,[k])=>s+(get(k)??0),0)+(get("scrap")??0)+(get("otherRevenue")??0), revenue=input.approvedInputs.businessOtherRevenue;
  if(revenue!==null && revenueTotal>revenue+0.01)throw new Error("Other-revenue breakdown exceeds the saved revenue.");
  if(revenue!==null && close(revenueTotal,revenue)){
    for(const[key,code]of revenues){const v=get(key);if(v!==null)add("business_other_revenues",code,v,`BUSINESS_REVENUE_${key.toUpperCase()}`);}
    const scrap=get("scrap"),other=get("otherRevenue");if(scrap!==null||other!==null)add("business_other_revenues","3128",(scrap??0)+(other??0),"BUSINESS_OTHER_REVENUE_SPECIFIED");
    completed.push("businessOtherRevenue");
  }
  const personal=get("personalAddback");
  if(personal!==null){if(input.approvedInputs.businessInadmissibleExpenses===null||!close(personal,input.approvedInputs.businessInadmissibleExpenses))throw new Error("The personal-expenditure add-back does not match the approved aggregate; review the remaining reason-wise add-backs.");if(personal>0)add("business_deductions","3212",personal,"BUSINESS_PERSONAL_EXPENDITURE_ADD_BACK");completed.push("businessInadmissibleExpenses");}
  const dep=get("accountingDepreciation");if(dep!==null){if(input.approvedInputs.businessDepreciation===null||!close(dep,input.approvedInputs.businessDepreciation))throw new Error("Reviewed accounting depreciation differs from the saved depreciation.");add("business_trading","3088",dep,"BUSINESS_ACCOUNTING_DEPRECIATION");notes.push("Accounting depreciation is queued, but tax depreciation / initial allowance 3248 is computed from an asset schedule and still needs manual verification. App taxable profit is not a certified FBR readback.");}
  const year=get("lossYear"),loss=get("ordinaryLoss");if(year!==null&&loss!==null){if(!Number.isInteger(year)||year<input.taxYear-5||year>=input.taxYear)throw new Error("Loss origin must be one of the captured prior tax years.");if(input.approvedInputs.businessLossBroughtForward===null||!close(loss,input.approvedInputs.businessLossBroughtForward))throw new Error("The reviewed ordinary prior-year loss differs from the saved loss.");add("business_adjustments",String(327000+year-2000),loss,"BUSINESS_DECLARED_PRIOR_YEAR_LOSS");completed.push("businessLossBroughtForward");notes.push("Prior-year loss is the taxpayer's declared ordinary loss for the reviewed origin year; eligibility and set-off remain subject to final FBR review.");}
  return { documentId: input.document.id, businessName: String(raw(["Business Name"])).trim(), fields: queued, completed, notes, coverage: "reviewed_component_fields" };
}
