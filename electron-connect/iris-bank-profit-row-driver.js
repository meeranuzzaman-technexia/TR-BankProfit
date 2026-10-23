"use strict";

/**
 * Create Bank Profit's one verified Other Sources > Tax Deductions > Final Tax
 * detail row when it is genuinely absent. This is deliberately narrower than
 * a general IRIS row picker: it can open only the Final Tax chooser, select only
 * one exact approved profit category, and press only that dialog's ADD or
 * Cancel. It never saves, calculates, submits, or touches payment controls.
 */
const BUILD_TAG = "fix63-bank-profit-calculate-derived-20261023";
const BANK_PROFIT_TARGETS = Object.freeze({
  "64040052": "Profit on Debt u/s 151(1)(b) from Bank Accounts / Deposits",
  "64040053": "Profit on Debt u/s 151(1)(c) from Government Securities",
  "64040054": "151(1) (d) - Profit on Debt u/s 151 from Others",
  "64330056": "Return on Investment in Sukuks u/s 151(1A) @ 25%",
  "64330055": "Return on Investment in Sukuks u/s 151(1A) @ 12.5%",
  "64330054": "Return on Investment in Sukuks u/s 151(1A) @ 10%",
});
const BANK_PROFIT_CODES = Object.freeze(Object.keys(BANK_PROFIT_TARGETS));
const SUKUK_CODES = Object.freeze(["64330054", "64330055", "64330056"]);
const BANK_PROFIT_CODE = "64040052";
const BANK_PROFIT_LABEL = BANK_PROFIT_TARGETS[BANK_PROFIT_CODE];
const GRID_TITLE = "Final Tax";
const DIALOG_TITLE = "Add Final Tax";
const INVESTMENT_DIALOG_TITLE = "Investment";
const FINAL_TAX_COLUMNS = Object.freeze([
  "Taxable Amount",
  "Tax Deducted",
  "Tax Chargeable",
]);

const PAGE_CFG = Object.freeze({
  code: BANK_PROFIT_CODE,
  label: BANK_PROFIT_LABEL,
  targets: BANK_PROFIT_TARGETS,
  directCodes: SUKUK_CODES,
  gridTitle: GRID_TITLE,
  dialogTitle: DIALOG_TITLE,
  investmentDialogTitle: INVESTMENT_DIALOG_TITLE,
  columns: FINAL_TAX_COLUMNS,
  rowSelector: ".tableRows.dataRow[id]",
  panelSelector: "mat-expansion-panel",
  panelHeaderSelector: "mat-expansion-panel-header",
  addSectionSelector: "button.btn-section-add",
  dialogSelector: "mat-dialog-container",
  cardSelector: ".source-card",
  detailAddSelector:
    '#add-adjustable-tax-generic[title="Add"][fonticon="add"]',
  investmentSelector: 'input[placeholder="Investment"]',
  contentsSelector:
    'textarea[placeholder*="Account, Bond or Certificates"][placeholder*="Current or Savings"][placeholder*="Name of Institution"]',
  calculateSelector: "app-nitr-wf-body .body.interface_21.active button.calbtn, .body.interface_21.active button.calbtn",
});

const PAGE_OPS = Object.freeze([
  "inspect",
  "open_final_tax_add",
  "dialog_state",
  "dialog_tick",
  "dialog_click",
  "open_investment_detail",
  "investment_dialog_state",
  "investment_dialog_fill",
  "investment_dialog_click",
  "calculate",
]);

/** Runs inside the IRIS page. Keep this function self-contained for Electron. */
function bankProfitPageOp(step) {
  const CFG = step.cfg;
  const checkedCard = (card) => {
    const input = card.querySelector('input[type="checkbox"]');
    if (!input) return false;
    const control = input.closest("mat-checkbox, .mat-mdc-checkbox");
    const visualSignals = [
      card.classList.contains("source-card--checked"),
      Boolean(control && control.classList.contains("mat-mdc-checkbox-checked")),
      input.classList.contains("mdc-checkbox--selected"),
    ].filter(Boolean).length;
    // IRIS's captured DOM serializes the Angular checked classes but not the
    // native input's live `checked` property. Accept that state only when at
    // least two independent visual markers agree; a live checked property is
    // authoritative by itself.
    return Boolean(input.checked || visualSignals >= 2);
  };
  const norm = (value) =>
    String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    for (
      let node = element;
      node && node.nodeType === 1;
      node = node.parentElement
    ) {
      if (node.hidden) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden")
        return false;
    }
    return true;
  };
  const panels = () =>
    Array.from(document.querySelectorAll(CFG.panelSelector)).filter((panel) => {
      const header = panel.querySelector(CFG.panelHeaderSelector);
      const title = header?.querySelector("mat-panel-title") || header;
      return visible(panel) && title && norm(title.textContent) === norm(CFG.gridTitle);
    });
  const panelExpanded = (panel) => {
    const header = panel.querySelector(CFG.panelHeaderSelector);
    const content = panel.querySelector(".mat-expansion-panel-content");
    return Boolean(
      (header && header.getAttribute("aria-expanded") === "true") ||
        panel.classList.contains("mat-expanded") ||
        (content && visible(content)),
    );
  };
  const columnsOf = (panel) => {
    const headings = Array.from(panel.querySelectorAll(".heading-bar strong"))
      .map((heading) => String(heading.textContent || "").replace(/\s+/g, " ").trim())
      .filter((heading) => heading && !["description", "code"].includes(norm(heading)));
    return headings;
  };
  const dialogs = () =>
    Array.from(document.querySelectorAll(CFG.dialogSelector)).filter(visible);
  const dialogTitle = (dialog) => {
    const title = dialog.querySelector(
      "[mat-dialog-title] .left, .mat-mdc-dialog-title .left, h6 .left",
    );
    if (title) return String(title.textContent || "").replace(/\s+/g, " ").trim();
    const heading = dialog.querySelector("[mat-dialog-title], h6");
    return heading
      ? String(heading.textContent || "")
          .replace(/\s*close\s*$/i, "")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  };
  const findDialog = (title) => {
    const matches = dialogs().filter((dialog) => norm(dialogTitle(dialog)) === norm(title));
    return matches.length === 1 ? matches[0] : null;
  };
  const buttonsOf = (dialog) => Array.from(dialog.querySelectorAll("button")).filter(visible);
  const buttonLabel = (button) => norm(button.textContent);
  const disabled = (element) => Boolean(
    element &&
      (element.disabled ||
        element.getAttribute("aria-disabled") === "true" ||
        element.classList.contains("mat-mdc-button-disabled") ||
        element.classList.contains("mat-button-disabled") ||
        element.classList.contains("mat-mdc-checkbox-disabled") ||
        element.classList.contains("mat-checkbox-disabled")),
  );
  const addEnabled = (dialog) => {
    const matches = buttonsOf(dialog).filter((item) => buttonLabel(item) === "add");
    return matches.length === 1 && !disabled(matches[0]);
  };
  const rows = () => {
    const matches = panels();
    return matches.length === 1
      ? Array.from(matches[0].querySelectorAll(CFG.rowSelector)).filter(visible)
      : [];
  };
  const targetRows = () =>
    rows().filter((row) => row.id === String(CFG.code)).map((row) => {
      const description = row.querySelector(".row-description-text");
      const rawLabel = description
        ? String(description.textContent || "").replace(/\s+/g, " ").trim()
        : "";
      const detail = row.classList.contains("section-detail-child-row");
      const codeCell = row.querySelector(".data-first-child");
      const cellInputs = Array.from(
        row.querySelectorAll(
          ".columns-parent .data-middle-child-wapper input:not([type=\"hidden\"])",
        ),
      );
      return {
        detail,
        codeMatched: Boolean(
          codeCell && String(codeCell.textContent || "").replace(/\s+/g, " ").trim() === String(CFG.code),
        ),
        description: rawLabel,
        labelMatched: detail
          ? norm(rawLabel).startsWith(`${norm(CFG.label)} -`)
          : norm(rawLabel) === norm(CFG.label),
        cells: cellInputs.map((input) => ({
          disabled: Boolean(input.disabled),
          readOnly: Boolean(input.readOnly),
          value: String(input.value || ""),
        })),
      };
    });
  const existingSourceLabels = () => {
    const allRows = rows();
    return allRows
      .filter((row) => !row.classList.contains("section-detail-child-row"))
      .map((row) => {
        const code = String(row.id || "").trim();
        const expectedLabel = CFG.targets?.[code];
        const description = row.querySelector(".row-description-text");
        const codeCell = row.querySelector(".data-first-child");
        const inputs = Array.from(
          row.querySelectorAll(
            ".columns-parent .data-middle-child-wapper input:not([type=\"hidden\"])",
          ),
        );
        const detailRows = allRows.filter(
          (candidate) =>
            candidate.id === code &&
            candidate.classList.contains("section-detail-child-row"),
        );
        const detailDescription = detailRows[0]?.querySelector(".row-description-text");
        const detailInputs = detailRows[0]
          ? Array.from(
              detailRows[0].querySelectorAll(
                ".columns-parent .data-middle-child-wapper input:not([type=\"hidden\"])",
              ),
            )
          : [];
        const directSukuk =
          CFG.directCodes.includes(code) &&
          inputs.length === CFG.columns.length &&
          inputs.slice(0, 2).every((input) => !input.disabled && !input.readOnly) &&
          inputs[2].disabled;
        return expectedLabel &&
          description &&
          norm(description.textContent) === norm(expectedLabel) &&
          codeCell &&
          String(codeCell.textContent || "").trim() === code &&
          (directSukuk ||
            (inputs.length === CFG.columns.length &&
              inputs.every((input) => input.disabled) &&
              detailRows.length === 1 &&
              detailDescription &&
              norm(detailDescription.textContent).startsWith(`${norm(expectedLabel)} -`) &&
              detailInputs.length === CFG.columns.length &&
              detailInputs.every((input) => !input.disabled && !input.readOnly)))
          ? expectedLabel
          : null;
      })
      .filter(Boolean);
  };
  const checkedOptions = (dialog) =>
    Array.from(dialog.querySelectorAll(CFG.cardSelector))
      .filter(checkedCard)
      .map((card) => {
        const label = card.querySelector("p");
        const text = label ? String(label.textContent || "").replace(/\s+/g, " ").trim() : "";
        return text || "<unlabeled checked option>";
      });

  if (step.op === "inspect") {
    const matches = panels();
    const panel = matches.length === 1 ? matches[0] : null;
    return {
      status: "ok",
      dialogs: dialogs().map(dialogTitle),
      finalTaxPanelCount: matches.length,
      finalTaxExpanded: Boolean(panel && panelExpanded(panel)),
      columns: panel ? columnsOf(panel) : [],
      rows: targetRows(),
      existingSourceLabels: existingSourceLabels(),
    };
  }

  if (step.op === "open_final_tax_add") {
    if (dialogs().length) return { status: "dialog_already_open" };
    const matches = panels();
    if (!matches.length) return { status: "final_tax_panel_not_found" };
    if (matches.length !== 1) return { status: "final_tax_panel_ambiguous" };
    const panel = matches[0];
    if (!panelExpanded(panel)) return { status: "final_tax_panel_collapsed" };
    const buttons = Array.from(panel.querySelectorAll(CFG.addSectionSelector)).filter(
      (button) => visible(button) && norm(button.textContent) === "+ section",
    );
    if (!buttons.length) return { status: "add_section_button_not_found" };
    if (buttons.length !== 1) return { status: "add_section_button_ambiguous" };
    if (disabled(buttons[0])) return { status: "add_section_button_disabled" };
    buttons[0].click();
    return { status: "clicked" };
  }

  if (step.op === "dialog_state") {
    const dialog = findDialog(step.title);
    if (!dialog) return { status: "dialog_not_open" };
    const cards = Array.from(dialog.querySelectorAll(CFG.cardSelector));
    const targets = cards.filter((card) => {
      const label = card.querySelector("p");
      return label && norm(label.textContent) === norm(CFG.label);
    });
    const target = targets.length === 1 ? targets[0] : null;
    const checkbox = target?.querySelector('input[type="checkbox"]') || null;
    const checkboxControl = checkbox?.closest("mat-checkbox, .mat-mdc-checkbox") || null;
    const selected = checkedOptions(dialog);
    return {
      status: "ok",
      targetCount: targets.length,
      targetChecked: Boolean(target && checkedCard(target)),
      targetDisabled: Boolean(
        checkbox &&
          (disabled(checkbox) || disabled(checkboxControl) || disabled(target)),
      ),
      checkedCount: selected.length,
      checkedLabels: selected,
      addEnabled: addEnabled(dialog),
    };
  }

  if (step.op === "dialog_tick") {
    const dialog = findDialog(step.title);
    if (!dialog) return { status: "dialog_not_open" };
    const cards = Array.from(dialog.querySelectorAll(CFG.cardSelector)).filter((card) => {
      const label = card.querySelector("p");
      return label && norm(label.textContent) === norm(step.label);
    });
    if (cards.length !== 1)
      return { status: cards.length ? "ambiguous_label" : "label_not_found" };
    const checkbox = cards[0].querySelector('input[type="checkbox"]');
    if (!checkbox) return { status: "checkbox_not_found" };
    const checkboxControl = checkbox.closest("mat-checkbox, .mat-mdc-checkbox");
    if (disabled(checkbox) || disabled(checkboxControl) || disabled(cards[0]))
      return { status: checkedCard(cards[0]) ? "already_present" : "disabled" };
    if (checkedCard(cards[0])) return { status: "already_checked" };
    checkbox.click();
    return { status: checkedCard(cards[0]) ? "ticked" : "tick_failed" };
  }

  if (step.op === "dialog_click") {
    const dialog = findDialog(step.title);
    if (!dialog) return { status: "dialog_not_open" };
    const buttons = buttonsOf(dialog).filter(
      (button) => buttonLabel(button) === norm(step.button),
    );
    if (!buttons.length) return { status: "button_not_found" };
    if (buttons.length !== 1) return { status: "button_ambiguous" };
    if (disabled(buttons[0])) return { status: "button_disabled" };
    buttons[0].click();
    return { status: "clicked" };
  }

  if (step.op === "calculate") {
    if (dialogs().length) return { status: "dialog_open" };
    const buttons = Array.from(document.querySelectorAll(CFG.calculateSelector)).filter(
      (button) => visible(button) && norm(button.textContent) === "calculate",
    );
    if (buttons.length !== 1)
      return { status: buttons.length ? "button_ambiguous" : "button_not_found" };
    if (disabled(buttons[0])) return { status: "button_disabled" };
    buttons[0].click();
    return { status: "clicked" };
  }

  if (step.op === "open_investment_detail") {
    if (dialogs().length) return { status: "dialog_already_open" };
    const targets = rows().filter(
      (row) =>
        row.id === String(CFG.code) &&
        !row.classList.contains("section-detail-child-row"),
    );
    if (targets.length !== 1)
      return { status: targets.length ? "parent_row_ambiguous" : "parent_row_missing" };
    const controls = Array.from(targets[0].querySelectorAll(CFG.detailAddSelector)).filter(visible);
    if (controls.length !== 1)
      return { status: controls.length ? "detail_add_ambiguous" : "detail_add_missing" };
    controls[0].click();
    return { status: "clicked" };
  }

  if (step.op === "investment_dialog_state") {
    const dialog = findDialog(CFG.investmentDialogTitle);
    if (!dialog) return { status: "dialog_not_open" };
    const investments = Array.from(dialog.querySelectorAll(CFG.investmentSelector)).filter(visible);
    const contents = Array.from(dialog.querySelectorAll(CFG.contentsSelector)).filter(visible);
    return {
      status: "ok",
      investmentCount: investments.length,
      contentsCount: contents.length,
      investment: investments.length === 1 ? String(investments[0].value || "") : "",
      contents: contents.length === 1 ? String(contents[0].value || "") : "",
      investmentMaxLength:
        investments.length === 1 ? Number(investments[0].maxLength) : null,
      addEnabled: addEnabled(dialog),
    };
  }

  if (step.op === "investment_dialog_fill") {
    const dialog = findDialog(CFG.investmentDialogTitle);
    if (!dialog) return { status: "dialog_not_open" };
    const investments = Array.from(dialog.querySelectorAll(CFG.investmentSelector)).filter(visible);
    const contents = Array.from(dialog.querySelectorAll(CFG.contentsSelector)).filter(visible);
    if (investments.length !== 1 || contents.length !== 1)
      return { status: "fields_unverified" };
    const setValue = (element, value) => {
      const prototype = element.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) return false;
      setter.call(element, value);
      element.dispatchEvent(new window.Event("input", { bubbles: true }));
      element.dispatchEvent(new window.Event("change", { bubbles: true }));
      return true;
    };
    if (
      !setValue(investments[0], step.investment) ||
      !setValue(contents[0], step.contents)
    )
      return { status: "fill_failed" };
    return { status: "filled" };
  }

  if (step.op === "investment_dialog_click") {
    const dialog = findDialog(CFG.investmentDialogTitle);
    if (!dialog) return { status: "dialog_not_open" };
    const buttons = buttonsOf(dialog).filter(
      (button) => buttonLabel(button) === norm(step.button),
    );
    if (buttons.length !== 1)
      return { status: buttons.length ? "button_ambiguous" : "button_not_found" };
    if (disabled(buttons[0])) return { status: "button_disabled" };
    buttons[0].click();
    return { status: "clicked" };
  }

  return { status: "unsupported_operation" };
}

function assertAllowedStep(step, targetCode = step?.code || BANK_PROFIT_CODE) {
  const targetLabel = BANK_PROFIT_TARGETS[String(targetCode)];
  if (!targetLabel)
    throw new Error("Blocked by Bank Profit row driver: unsupported profit category code.");
  if (!step || !PAGE_OPS.includes(step.op))
    throw new Error("Blocked by Bank Profit row driver: unsupported operation.");
  if (step.code !== undefined && String(step.code) !== String(targetCode))
    throw new Error("Blocked by Bank Profit row driver: step code does not match its approved target.");
  if (step.op === "dialog_state" && step.title !== DIALOG_TITLE)
    throw new Error("Blocked by Bank Profit row driver: only Add Final Tax may be inspected.");
  if (
    step.op === "dialog_tick" &&
    (step.title !== DIALOG_TITLE || step.label !== targetLabel)
  )
    throw new Error("Blocked by Bank Profit row driver: only the verified Bank Profit option may be selected.");
  if (
    step.op === "dialog_click" &&
    (step.title !== DIALOG_TITLE || !["ADD", "Cancel"].includes(step.button))
  )
    throw new Error("Blocked by Bank Profit row driver: only Add Final Tax ADD or Cancel may be clicked.");
  if (step.op === "open_final_tax_add" && Object.keys(step).some((key) => key !== "op"))
    throw new Error("Blocked by Bank Profit row driver: opening accepts no dynamic target.");
  if (step.op === "open_investment_detail" && Object.keys(step).some((key) => key !== "op"))
    throw new Error("Blocked by Bank Profit row driver: detail opening accepts no dynamic target.");
  if (step.op === "investment_dialog_state" && Object.keys(step).some((key) => key !== "op"))
    throw new Error("Blocked by Bank Profit row driver: Investment inspection accepts no dynamic target.");
  if (
    step.op === "investment_dialog_fill" &&
    (typeof step.investment !== "string" ||
      !step.investment.trim() ||
      step.investment.length > 50 ||
      typeof step.contents !== "string" ||
      !step.contents.trim())
  )
    throw new Error("Blocked by Bank Profit row driver: invalid Investment detail values.");
  if (
    step.op === "investment_dialog_click" &&
    step.button !== "ADD"
  )
    throw new Error("Blocked by Bank Profit row driver: only Investment ADD may be clicked.");
}

function buildPageScript(step, targetCode = step?.code || BANK_PROFIT_CODE) {
  const code = String(targetCode);
  assertAllowedStep(step, code);
  return `(${bankProfitPageOp.toString()})(${JSON.stringify({
    ...step,
    cfg: {
      ...PAGE_CFG,
      code,
      label: BANK_PROFIT_TARGETS[code],
      targets: BANK_PROFIT_TARGETS,
    },
  })})`;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sameLabels = (actual, expected) =>
  JSON.stringify(actual) === JSON.stringify(expected);

function verifiedDetailRow(snapshot) {
  if (
    !snapshot ||
    snapshot.status !== "ok" ||
    snapshot.finalTaxPanelCount !== 1 ||
    !snapshot.finalTaxExpanded ||
    !sameLabels(snapshot.columns, FINAL_TAX_COLUMNS)
  )
    return false;
  const rows = snapshot.rows || [];
  const summaries = rows.filter((row) => !row.detail);
  const details = rows.filter((row) => row.detail);
  return Boolean(
    rows.length === 2 &&
      rows[0].detail === false &&
      rows[1].detail === true &&
      summaries.length === 1 &&
      details.length === 1 &&
      summaries[0].codeMatched &&
      details[0].codeMatched &&
      summaries[0].labelMatched &&
      summaries[0].cells.length === FINAL_TAX_COLUMNS.length &&
      summaries[0].cells.every((cell) => cell.disabled) &&
      details[0].labelMatched &&
      details[0].cells.length === FINAL_TAX_COLUMNS.length &&
      details[0].cells.every((cell) => !cell.disabled && !cell.readOnly),
  );
}

function verifiedParentOnlyRow(snapshot) {
  if (
    !snapshot ||
    snapshot.status !== "ok" ||
    snapshot.finalTaxPanelCount !== 1 ||
    !snapshot.finalTaxExpanded ||
    !sameLabels(snapshot.columns, FINAL_TAX_COLUMNS)
  )
    return false;
  const rows = snapshot.rows || [];
  return Boolean(
    rows.length === 1 &&
      !rows[0].detail &&
      rows[0].codeMatched &&
      rows[0].labelMatched &&
      rows[0].cells.length === FINAL_TAX_COLUMNS.length &&
      rows[0].cells.every((cell) => cell.disabled),
  );
}

function verifiedDirectSukukRow(snapshot, code) {
  if (!SUKUK_CODES.includes(String(code)) || !snapshot || snapshot.status !== "ok") return false;
  const rows = snapshot.rows || [];
  const cells = rows[0]?.cells || [];
  return Boolean(
    snapshot.finalTaxPanelCount === 1 &&
      snapshot.finalTaxExpanded &&
      sameLabels(snapshot.columns, FINAL_TAX_COLUMNS) &&
      rows.length === 1 &&
      !rows[0].detail &&
      rows[0].codeMatched &&
      rows[0].labelMatched &&
      cells.length === FINAL_TAX_COLUMNS.length &&
      cells.slice(0, 2).every((cell) => !cell.disabled && !cell.readOnly) &&
      cells[2].disabled,
  );
}

/**
 * Ensure the approved profit category's writable detail row exists. In LIVE mode it may press
 * ADD only when the target and any already-present verified source cards are checked. In dry
 * or verify-only mode it is read-only. Returns a verified row contract or a
 * specific, safely-held reason.
 */
async function ensureBankProfitFinalTaxRow(windowInstance, options = {}) {
  const {
    code = BANK_PROFIT_CODE,
    mode = "dry",
    addIfMissing = true,
    investment = "",
    contents = "",
    beforeStep = async () => {},
    onStep = () => {},
    sleep = defaultSleep,
    timeoutMs = 8000,
  } = options;
  const target = {
    code: String(code),
    label: BANK_PROFIT_TARGETS[String(code)] || null,
  };
  const readOnly = mode !== "live" || !addIfMissing;
  const setup = [];
  const note = (step, detail) => {
    setup.push({ step, detail });
    onStep(`bank_profit_${step}`, detail);
  };
  const run = async (step) => {
    await beforeStep();
    return windowInstance.webContents.executeJavaScript(
      buildPageScript(step, target.code),
    );
  };
  const waitFor = async (producer, accept) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    do {
      last = await producer();
      if (accept(last)) return { ok: true, value: last };
      await sleep(250);
    } while (Date.now() < deadline);
    return { ok: false, value: last };
  };
  if (!target.label) {
    const detail = `Unsupported Bank Profit Final Tax code ${target.code}; nothing was clicked.`;
    note("row_setup_held", detail);
    return { ok: false, status: "unsupported_profit_category", message: detail, setup };
  }
  const inspect = () => run({ op: "inspect" });
  const closeChooser = async () => {
    try {
      const clicked = await run({
        op: "dialog_click",
        title: DIALOG_TITLE,
        button: "Cancel",
      });
      if (clicked.status !== "clicked") return false;
      const closed = await waitFor(
        inspect,
        (state) => !state.dialogs?.includes(DIALOG_TITLE),
      );
      return closed.ok;
    } catch {
      return false;
    }
  };
  const fail = async (status, detail, { cancel = false } = {}) => {
    if (cancel) await closeChooser();
    note("row_setup_held", detail);
    return { ok: false, status, message: detail, setup };
  };
  const addInvestmentDetail = async (sourceAdded) => {
    let current = await inspect();
    const titles = current.dialogs || [];
    if (titles.some((title) => title !== INVESTMENT_DIALOG_TITLE))
      return fail(
        "unexpected_dialog",
        `An unexpected IRIS dialog is open (${titles.join(", ")}); no Investment detail was entered.`,
      );
    if (titles.filter((title) => title === INVESTMENT_DIALOG_TITLE).length > 1)
      return fail(
        "ambiguous_investment_dialog",
        "More than one Investment dialog is open; nothing was entered.",
      );
    if (!titles.includes(INVESTMENT_DIALOG_TITLE)) {
      const opened = await run({ op: "open_investment_detail" });
      if (opened.status !== "clicked")
        return fail(
          `investment_${opened.status}`,
          `The exact Add control on the ${target.code} parent row could not be opened (${opened.status}); no detail or amount was entered.`,
        );
      const appeared = await waitFor(
        inspect,
        (value) =>
          value.status === "ok" &&
          value.dialogs?.length === 1 &&
          value.dialogs[0] === INVESTMENT_DIALOG_TITLE,
      );
      if (!appeared.ok)
        return fail(
          "investment_dialog_missing",
          `The ${target.code} Add control was clicked, but the verified Investment dialog did not appear; no detail or amount was entered.`,
        );
    }

    let detail = await run({ op: "investment_dialog_state" });
    if (
      detail.status !== "ok" ||
      detail.investmentCount !== 1 ||
      detail.contentsCount !== 1 ||
      detail.investmentMaxLength !== 50
    )
      return fail(
        "investment_dialog_unverified",
        `The Investment popup did not match the captured ${target.code} two-field layout; nothing was entered.`,
      );
    if (
      (detail.investment && detail.investment !== investment) ||
      (detail.contents && detail.contents !== contents)
    )
      return fail(
        "investment_dialog_has_other_values",
        "The Investment popup already contains different text; the agent will not overwrite it.",
      );
    if (detail.investment !== investment || detail.contents !== contents) {
      const filled = await run({
        op: "investment_dialog_fill",
        investment,
        contents,
      });
      if (filled.status !== "filled")
        return fail(
          `investment_${filled.status}`,
          `The verified Investment fields could not be filled (${filled.status}); ADD was not clicked.`,
        );
    }
    const readback = await waitFor(
      () => run({ op: "investment_dialog_state" }),
      (value) =>
        value.status === "ok" &&
        value.investment === investment &&
        value.contents === contents &&
        value.addEnabled,
    );
    detail = readback.value;
    if (!readback.ok)
      return fail(
        "investment_values_unverified",
        "The certificate-derived Investment values did not read back exactly or ADD stayed disabled; no detail row was created.",
      );
    current = await inspect();
    if (
      !verifiedParentOnlyRow(current) ||
      current.dialogs?.length !== 1 ||
      current.dialogs[0] !== INVESTMENT_DIALOG_TITLE
    )
      return fail(
        "investment_state_changed_before_add",
        `The ${target.code} parent row or Investment dialog changed before ADD; nothing further was clicked.`,
      );
    const added = await run({ op: "investment_dialog_click", button: "ADD" });
    if (added.status !== "clicked")
      return fail(
        `investment_add_${added.status}`,
        `The Investment popup did not accept ADD (${added.status}); no amount was typed.`,
      );
    const created = await waitFor(
      inspect,
      (value) => value.status === "ok" && !value.dialogs?.length && verifiedDetailRow(value),
    );
    if (!created.ok)
      return fail(
        "detail_row_not_created_after_add",
        `Investment ADD was clicked, but the verified writable ${target.code} child row did not appear. No amount, return Save, Calculate, or Submit was used.`,
      );
    note(
      "row_added",
      `Created the verified ${target.code} Investment detail row from approved certificate data. The return was not saved, calculated, or submitted.`,
    );
    return {
      ok: true,
      status: sourceAdded ? "row_added" : "row_detail_added",
      added: true,
      setup,
    };
  };

  let state;
  try {
    state = await inspect();
  } catch (error) {
    return fail(
      "inspection_failed",
      `The Final Tax grid could not be inspected (${error?.message || error}). No dialog action was taken.`,
    );
  }
  if (state.status !== "ok")
    return fail("inspection_failed", `IRIS inspection returned ${state.status}. No dialog action was taken.`);
  const verifiedExistingLabels = new Set(state.existingSourceLabels || []);
  if (state.dialogs.some((title) => ![DIALOG_TITLE, INVESTMENT_DIALOG_TITLE].includes(title)))
    return fail(
      "unexpected_dialog",
      `An unexpected IRIS dialog is open (${state.dialogs.join(", ")}); nothing was clicked.`,
    );
  if (state.dialogs.filter((title) => title === DIALOG_TITLE).length > 1)
    return fail(
      "ambiguous_dialog",
      "More than one Add Final Tax dialog is open; nothing was clicked.",
    );
  if (
    state.finalTaxPanelCount !== 1 ||
    !state.finalTaxExpanded ||
    !sameLabels(state.columns, FINAL_TAX_COLUMNS)
  )
    return fail(
      "final_tax_grid_unverified",
      "The active Final Tax grid/header did not match the verified three-column layout; no row was added.",
      { cancel: !readOnly && state.dialogs.includes(DIALOG_TITLE) },
    );
  if (verifiedDetailRow(state) || verifiedDirectSukukRow(state, target.code)) {
    if (state.dialogs.includes(INVESTMENT_DIALOG_TITLE))
      return fail(
        "unexpected_investment_dialog",
        `A writable ${target.code} detail row already exists while an Investment dialog is open; nothing was clicked.`,
      );
    if (!readOnly && state.dialogs.includes(DIALOG_TITLE) && !(await closeChooser()))
      return fail(
        "chooser_close_failed",
        `The existing ${target.code} row is valid, but its Add Final Tax dialog could not be safely cancelled; filling was held.`,
      );
    note("row_present", `The existing ${target.code} writable row contract was verified; no ADD was needed.`);
    return { ok: true, status: "row_present", added: false, setup };
  }
  const parentOnly = verifiedParentOnlyRow(state);
  if ((state.rows || []).length && !parentOnly) {
    return fail(
      "row_layout_unverified",
      `IRIS shows code ${target.code}, but its parent/detail row shape is not the verified contract. No ADD was clicked.`,
      { cancel: !readOnly && state.dialogs.includes(DIALOG_TITLE) },
    );
  }
  if (readOnly && parentOnly)
    return fail(
      mode === "dry" ? "row_detail_missing_dry" : "row_detail_missing_verify_only",
      `Code ${target.code} has only its read-only parent row. This run is read-only, so the Investment detail popup was not used.`,
    );
  if (readOnly)
    return fail(
      mode === "dry" ? "row_missing_dry" : "row_missing_verify_only",
      `Code ${target.code} is absent. This run is read-only for this item, so the Add Final Tax dialog was not used.`,
    );
  if (
    typeof investment !== "string" ||
    !investment.trim() ||
    investment.length > 50 ||
    typeof contents !== "string" ||
    !contents.trim()
  )
    return fail(
      "investment_details_missing",
      "The approved packet does not contain valid Bank Profit Investment and Contents values. Generate a fresh packet from the approved certificate; nothing was clicked.",
    );
  if (parentOnly) return addInvestmentDetail(false);

  const dialogOpen = state.dialogs.includes(DIALOG_TITLE);
  if (!dialogOpen) {
    const opened = await run({ op: "open_final_tax_add" });
    if (opened.status !== "clicked")
      return fail(
        `open_${opened.status}`,
        `The Final Tax + Section control could not be opened (${opened.status}). No row was added.`,
      );
    const dialog = await waitFor(
      inspect,
      (value) => value.status === "ok" && value.dialogs.includes(DIALOG_TITLE),
    );
    const titles = dialog.value?.dialogs || [];
    if (titles.some((title) => title !== DIALOG_TITLE))
      return fail(
        "unexpected_dialog",
        `An unexpected IRIS dialog appeared (${titles.join(", ")}); nothing was clicked.`,
      );
    if (titles.filter((title) => title === DIALOG_TITLE).length > 1)
      return fail(
        "ambiguous_dialog",
        "More than one Add Final Tax dialog appeared; nothing was clicked.",
      );
    if (!dialog.ok)
      return fail("add_final_tax_dialog_missing", "Add Final Tax did not appear; no row was added.");
  }

  let selection = await run({ op: "dialog_state", title: DIALOG_TITLE });
  if (selection.status !== "ok")
    return fail("add_final_tax_dialog_missing", "Add Final Tax is no longer open; no row was added.");
  if (selection.targetCount !== 1)
    return fail(
      selection.targetCount ? "bank_profit_option_ambiguous" : "bank_profit_option_missing",
      `The exact Bank Profit option appeared ${selection.targetCount} times in Add Final Tax; nothing was added.`,
      { cancel: true },
    );
  const otherChecked = (selection.checkedLabels || []).filter(
    (label) => label !== target.label && !verifiedExistingLabels.has(label),
  );
  if (otherChecked.length)
    return fail(
      "unexpected_sources_selected",
      `Other Final Tax sources are already selected (${otherChecked.join(", ")}); the chooser was cancelled rather than adding unrelated rows.`,
      { cancel: true },
    );
  if (selection.targetDisabled)
    return fail(
      "bank_profit_option_locked",
      "The Bank Profit option is disabled while its row is absent; no ADD was attempted.",
      { cancel: true },
    );
  if (!selection.targetChecked) {
    const ticked = await run({
      op: "dialog_tick",
      title: DIALOG_TITLE,
      label: target.label,
    });
    if (!["ticked", "already_checked"].includes(ticked.status))
      return fail(
        `bank_profit_option_${ticked.status}`,
        `The Bank Profit option could not be selected (${ticked.status}); no ADD was attempted.`,
        { cancel: true },
      );
    selection = await run({ op: "dialog_state", title: DIALOG_TITLE });
    const recheckedOthers = (selection.checkedLabels || []).filter(
      (label) => label !== target.label && !verifiedExistingLabels.has(label),
    );
    if (
      selection.status !== "ok" ||
      selection.targetCount !== 1 ||
      !selection.targetChecked ||
      selection.targetDisabled
    )
      return fail(
        "bank_profit_selection_unverified",
        "After selecting Bank Profit, the popup state changed unexpectedly; no ADD was attempted.",
        { cancel: true },
      );
    if (recheckedOthers.length)
      return fail(
        "unexpected_sources_selected_after_bank_profit",
        `Other Final Tax sources became selected after choosing Bank Profit (${recheckedOthers.join(", ")}); the chooser was cancelled.`,
        { cancel: true },
      );
  }
  if (!selection.addEnabled)
    return fail(
      "add_button_disabled",
      "ADD is disabled in Add Final Tax; no row was added.",
      { cancel: true },
    );

  // Re-read both the grid and the chooser immediately before ADD. A changed
  // selection, disabled control, unexpected dialog, or new row must hold the
  // action rather than turn a second click into a duplicate.
  try {
    state = await inspect();
  } catch (error) {
    return fail(
      "final_check_failed",
      `The Final Tax grid could not be rechecked immediately before ADD (${error?.message || error}); no row was added.`,
      { cancel: true },
    );
  }
  if (verifiedDetailRow(state) || verifiedDirectSukukRow(state, target.code)) {
    if (!(await closeChooser()))
      return fail(
        "chooser_close_failed",
        `The ${target.code} row appeared before ADD, but the chooser could not be safely cancelled; filling was held.`,
      );
    note("row_present_before_add", `The ${target.code} row appeared before ADD; the chooser was cancelled to avoid a duplicate.`);
    return { ok: true, status: "row_present", added: false, setup };
  }
  if (
    state.status !== "ok" ||
    state.finalTaxPanelCount !== 1 ||
    !state.finalTaxExpanded ||
    !sameLabels(state.columns, FINAL_TAX_COLUMNS)
  )
    return fail(
      "final_tax_grid_changed_before_add",
      "The active Final Tax grid/header changed before ADD; no row was added.",
      { cancel: true },
    );
  if ((state.rows || []).length)
    return fail(
      "row_changed_before_add",
      `The ${target.code} row changed while the chooser was open; ADD was cancelled to avoid a duplicate.`,
      { cancel: true },
    );
  if (
    state.dialogs.length !== 1 ||
    state.dialogs[0] !== DIALOG_TITLE
  )
    return fail(
      "dialog_state_changed_before_add",
      "The Add Final Tax chooser was not the only open dialog immediately before ADD; nothing was added.",
      { cancel: state.dialogs.filter((title) => title === DIALOG_TITLE).length === 1 },
    );
  const finalSelection = await run({ op: "dialog_state", title: DIALOG_TITLE });
  if (
    finalSelection.status !== "ok" ||
    finalSelection.targetCount !== 1 ||
    !finalSelection.targetChecked ||
    finalSelection.targetDisabled
  )
    return fail(
      "bank_profit_selection_changed_before_add",
      "The exact Bank Profit option was not uniquely checked and enabled immediately before ADD; nothing was added.",
      { cancel: true },
    );
  const finalOtherChecked = (finalSelection.checkedLabels || []).filter(
    (label) => label !== target.label && !verifiedExistingLabels.has(label),
  );
  if (finalOtherChecked.length)
    return fail(
      "unexpected_sources_selected_before_add",
      `Other Final Tax sources became selected before ADD (${finalOtherChecked.join(", ")}); nothing was added.`,
      { cancel: true },
    );
  if (!finalSelection.addEnabled)
    return fail(
      "add_button_disabled_before_add",
      "ADD is no longer enabled immediately before the action; nothing was added.",
      { cancel: true },
    );

  const added = await run({
    op: "dialog_click",
    title: DIALOG_TITLE,
    button: "ADD",
  });
  if (added.status !== "clicked")
    return fail(
      `add_${added.status}`,
      `Add Final Tax did not accept ADD (${added.status}); no row was confirmed.`,
      { cancel: true },
    );
  const appeared = await waitFor(
    inspect,
    (value) =>
      value.status === "ok" &&
      !value.dialogs.length &&
      (verifiedParentOnlyRow(value) || verifiedDetailRow(value) || verifiedDirectSukukRow(value, target.code)),
  );
  if (!appeared.ok)
    return fail(
      "row_not_created_after_add",
      `ADD was clicked for the sole checked ${target.label} option, but its verified ${target.code} parent row did not appear. No return Save, Calculate, or Submit was used.`,
      { cancel: true },
    );
  if (verifiedDirectSukukRow(appeared.value, target.code)) {
    note("row_added", `Added the verified direct ${target.label} (${target.code}) row. The return was not saved, calculated, or submitted.`);
    return { ok: true, status: "row_added", added: true, setup };
  }
  if (!verifiedDetailRow(appeared.value)) return addInvestmentDetail(true);
  note(
    "row_added",
    `Added the verified ${target.label} (${target.code}) row under Other Sources > Tax Deductions > Final Tax. Any other checked supported sources already had verified rows; the return was not saved, calculated, or submitted.`,
  );
  return { ok: true, status: "row_added", added: true, setup };
}

async function calculateBankProfitFinalTax(windowInstance, options = {}) {
  const {
    code,
    mode = "dry",
    expectedChargeable,
    beforeStep = async () => {},
    onStep = () => {},
    sleep = defaultSleep,
    timeoutMs = 8000,
  } = options;
  const targetCode = String(code || "");
  const expected = String(expectedChargeable ?? "").replace(/[\s,]/g, "");
  if (mode !== "live") return { ok: false, status: "calculate_not_live" };
  if (!SUKUK_CODES.includes(targetCode) || !/^\d+$/.test(expected))
    return { ok: false, status: "calculate_target_unverified" };
  const run = async (step) => {
    await beforeStep();
    return windowInstance.webContents.executeJavaScript(buildPageScript(step, targetCode));
  };
  const initial = await run({ op: "inspect" });
  if (!verifiedDirectSukukRow(initial, targetCode))
    return { ok: false, status: "calculate_row_unverified" };
  const current = String(initial.rows[0].cells[2].value || "").replace(/[\s,]/g, "");
  if (current === expected) return { ok: true, status: "already_calculated" };
  if (current) return { ok: false, status: "calculate_existing_mismatch" };
  const clicked = await run({ op: "calculate" });
  if (clicked.status !== "clicked")
    return { ok: false, status: `calculate_${clicked.status}` };
  const deadline = Date.now() + timeoutMs;
  let snapshot;
  do {
    snapshot = await run({ op: "inspect" });
    const value = String(snapshot.rows?.[0]?.cells?.[2]?.value || "").replace(/[\s,]/g, "");
    if (verifiedDirectSukukRow(snapshot, targetCode) && value === expected) {
      onStep("bank_profit_calculated", `${targetCode} Tax Chargeable was recalculated and verified in IRIS. Save and Submit were not used.`);
      return { ok: true, status: "calculated" };
    }
    await sleep(250);
  } while (Date.now() < deadline);
  return { ok: false, status: "calculate_readback_unverified" };
}

module.exports = {
  BANK_PROFIT_CODE,
  BANK_PROFIT_CODES,
  BANK_PROFIT_LABEL,
  BANK_PROFIT_TARGETS,
  SUKUK_CODES,
  BUILD_TAG,
  DIALOG_TITLE,
  FINAL_TAX_COLUMNS,
  GRID_TITLE,
  PAGE_CFG,
  PAGE_OPS,
  assertAllowedStep,
  bankProfitPageOp,
  buildPageScript,
  calculateBankProfitFinalTax,
  ensureBankProfitFinalTaxRow,
  verifiedDetailRow,
  verifiedDirectSukukRow,
  verifiedParentOnlyRow,
};
