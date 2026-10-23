"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const FIXTURES = path.join(__dirname, "..", "..", "test-fixtures", "iris", "other-sources");
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const CODE = "64040052";
const LABEL = "Profit on Debt u/s 151(1)(b) from Bank Accounts / Deposits";

class FakeIrisBankProfit {
  constructor({
    targetChecked = true,
    targetDisabled = false,
    addDisabled = false,
    extraChecked = [],
    omitTarget = false,
    duplicateTarget = false,
    duplicateAdd = false,
    duplicateDialog = false,
    lateOtherChecked = null,
    lateAddDisabled = false,
    preexistingRow = false,
    malformedPreexistingRow = false,
    existingSources = [],
    targetCode = CODE,
    targetLabel = LABEL,
  } = {}) {
    this.clicks = [];
    this.targetChecked = targetChecked;
    this.targetDisabled = targetDisabled;
    this.addDisabled = addDisabled;
    this.extraChecked = extraChecked;
    this.omitTarget = omitTarget;
    this.duplicateTarget = duplicateTarget;
    this.duplicateAdd = duplicateAdd;
    this.duplicateDialog = duplicateDialog;
    this.lateOtherChecked = lateOtherChecked;
    this.lateAddDisabled = lateAddDisabled;
    this.lateChangeInjected = false;
    this.preexistingRow = preexistingRow;
    this.malformedPreexistingRow = malformedPreexistingRow;
    this.existingSources = existingSources;
    this.code = targetCode;
    this.label = targetLabel;
    this.dom = new JSDOM(`<!doctype html><html><body><main class="iris-data"></main></body></html>`, {
      runScripts: "outside-only",
      pretendToBeVisual: true,
    });
    this.window = this.dom.window;
    this.document = this.window.document;
    this.container = this.document.querySelector("main.iris-data");
    const page = new JSDOM(read("final-tax-row-missing.html")).window.document;
    for (const child of [...page.body.childNodes])
      this.container.appendChild(this.document.importNode(child, true));
    this.modalHtml = read("modal-add-final-tax.html");
    this.investmentModalHtml = read("investment-dialog-empty.html");
    this.document.addEventListener("click", (event) => this.onClick(event), true);
    this.document.addEventListener("change", (event) => this.onChange(event));
    this.document.addEventListener("input", (event) => this.onChange(event));
    if (this.preexistingRow) this.addRows({ malformed: this.malformedPreexistingRow });
    for (const source of this.existingSources) this.addRows(source);
    this.webContents = {
      executeJavaScript: async (script) => {
        const result = this.window.eval(script);
        if (
          !this.lateChangeInjected &&
          script.includes('"op":"dialog_state"')
        ) {
          this.lateChangeInjected = true;
          const dialog = this.dialogs()[0];
          if (dialog && this.lateOtherChecked) {
            const card = this.document.createElement("div");
            card.className = "source-card source-card--checked";
            card.innerHTML = `<mat-checkbox class="mat-mdc-checkbox mat-mdc-checkbox-checked"><input type="checkbox" checked></mat-checkbox><p></p>`;
            card.querySelector("p").textContent = String(this.lateOtherChecked);
            dialog.querySelector(".dialog-body").appendChild(card);
          }
          if (dialog && this.lateAddDisabled) {
            const add = [...dialog.querySelectorAll("button")].find(
              (button) => button.textContent.trim() === "ADD",
            );
            if (add) add.disabled = true;
          }
        }
        return result;
      },
    };
  }

  dialogs() {
    return [...this.document.querySelectorAll("mat-dialog-container")];
  }

  rows() {
    return [...this.container.querySelectorAll(`.tableRows.dataRow[id="${this.code}"]`)];
  }

  inputValues(row) {
    return [...row.querySelectorAll(".columns-parent .data-middle-child-wapper input")].map((input) => input.value);
  }

  insertAfter(row, reference) {
    reference.parentNode.insertBefore(row, reference.nextSibling);
  }

  makeRow(detail, codeValue = this.code, labelValue = this.label) {
    const row = this.document.createElement("div");
    row.className = `tableRows dataRow${detail ? " section-detail-child-row" : ""}`;
    row.id = codeValue;
    const label = this.document.createElement("div");
    label.className = "row-description-text";
    label.textContent = `${labelValue}${detail ? " --" : ""}`;
    row.appendChild(label);
    const code = this.document.createElement("div");
    code.className = "data-first-child";
    code.textContent = codeValue;
    row.appendChild(code);
    const cells = this.document.createElement("div");
    cells.className = "columns-parent";
    for (let i = 0; i < 3; i += 1) {
      const wrapper = this.document.createElement("div");
      wrapper.className = "data-middle-child-wapper";
      const input = this.document.createElement("input");
      input.type = "text";
      input.dataset.column = String(i);
      input.disabled = !detail;
      wrapper.appendChild(input);
      cells.appendChild(wrapper);
    }
    row.appendChild(cells);
    if (!detail) {
      const actions = this.document.createElement("div");
      actions.className = "actions";
      actions.innerHTML = '<mat-icon tabindex="0" id="add-adjustable-tax-generic" title="Add" fonticon="add">add</mat-icon>';
      row.appendChild(actions);
    }
    return row;
  }

  rowBody() {
    const panel = [...this.container.querySelectorAll("mat-expansion-panel")].find((candidate) =>
      candidate.querySelector("mat-panel-title")?.textContent.trim() === "Final Tax",
    );
    return panel?.querySelector(".mat-expansion-panel-body") || null;
  }

  addParentRow() {
    const body = this.rowBody();
    const anchor = body?.querySelector('.dataRow[id="999919"]') || body?.querySelector(".dataRow");
    if (!body || this.rows().length) return;
    const parent = this.makeRow(false);
    this.insertAfter(parent, anchor || body.firstElementChild || body);
  }

  addDetailRow(investment = "existing investment", contents = "existing contents") {
    const parent = this.rows().find((row) => !row.classList.contains("section-detail-child-row"));
    if (!parent || this.rows().some((row) => row.classList.contains("section-detail-child-row"))) return;
    const detail = this.makeRow(true);
    detail.querySelector(".row-description-text").textContent = `${this.label} - ${investment} - ${contents}`;
    this.insertAfter(detail, parent);
  }

  addRows({ malformed = false, code = this.code, label = this.label, detail: includeDetail = true } = {}) {
    if (code !== this.code) {
      const body = this.rowBody();
      const anchor = body?.querySelector('.dataRow[id="999919"]') || body?.querySelector(".dataRow");
      const parent = this.makeRow(false, code, label);
      this.insertAfter(parent, anchor || body.firstElementChild || body);
      if (includeDetail) {
        const detail = this.makeRow(true, code, label);
        detail.querySelector(".row-description-text").textContent = `${label} - existing investment - existing contents`;
        this.insertAfter(detail, parent);
      }
      return;
    }
    this.addParentRow();
    if (malformed) {
      this.rows()[0]?.querySelector(".data-middle-child-wapper:last-child")?.remove();
    } else {
      this.addDetailRow();
    }
  }

  openDialog() {
    const src = new JSDOM(this.modalHtml).window.document.querySelector("mat-dialog-container");
    const dialog = this.document.importNode(src, true);
    const capturedTarget = [...dialog.querySelectorAll(".source-card")].find((item) =>
      item.querySelector("p")?.textContent.trim() === LABEL,
    );
    if (capturedTarget) capturedTarget.querySelector("p").textContent = this.label;
    this.container.appendChild(dialog);
    if (this.omitTarget) {
      const card = [...dialog.querySelectorAll(".source-card")].find((item) =>
        item.querySelector("p")?.textContent.trim() === this.label,
      );
      card?.remove();
    }
    const target = [...dialog.querySelectorAll(".source-card")].find((item) =>
      item.querySelector("p")?.textContent.trim() === this.label,
    );
    if (target) {
      const checkbox = target.querySelector('input[type="checkbox"]');
      if (checkbox) {
        checkbox.checked = Boolean(this.targetChecked);
        checkbox.disabled = Boolean(this.targetDisabled);
        checkbox.classList.toggle(
          "mdc-checkbox--selected",
          Boolean(this.targetChecked),
        );
      }
      target.classList.toggle("source-card--checked", Boolean(this.targetChecked));
      target.querySelector("mat-checkbox")?.classList.toggle(
        "mat-mdc-checkbox-checked",
        Boolean(this.targetChecked),
      );
    }
    for (const label of this.extraChecked) {
      const card = this.document.createElement("div");
      card.className = "source-card source-card--checked";
      card.innerHTML = `<mat-checkbox class="mat-mdc-checkbox mat-mdc-checkbox-checked"><input type="checkbox" checked></mat-checkbox><p></p>`;
      card.querySelector("p").textContent = String(label);
      dialog.querySelector(".dialog-body").appendChild(card);
    }
    if (this.duplicateTarget && target)
      dialog.querySelector(".dialog-body").appendChild(target.cloneNode(true));
    if (this.duplicateAdd) {
      const add = [...dialog.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "ADD",
      );
      if (add) dialog.querySelector(".dialog-footer").appendChild(add.cloneNode(true));
    }
    if (this.duplicateDialog) this.container.appendChild(dialog.cloneNode(true));
    this.refreshButtons(dialog);
    return dialog;
  }

  openInvestmentDialog() {
    const src = new JSDOM(this.investmentModalHtml).window.document.querySelector("mat-dialog-container");
    const dialog = this.document.importNode(src, true);
    this.container.appendChild(dialog);
    this.refreshInvestmentButton(dialog);
    return dialog;
  }

  refreshInvestmentButton(dialog) {
    const investment = dialog.querySelector('input[placeholder="Investment"]');
    const contents = dialog.querySelector("textarea");
    const add = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "ADD",
    );
    if (add) add.disabled = !investment?.value.trim() || !contents?.value.trim();
  }

  refreshButtons(dialog) {
    const add = [...dialog.querySelectorAll("button")].find((button) => button.textContent.trim() === "ADD");
    if (!add) return;
    const any = [...dialog.querySelectorAll(".source-card")].some((card) => {
      const box = card.querySelector('input[type="checkbox"]');
      return Boolean(box && box.checked && !box.disabled);
    });
    add.disabled = Boolean(this.addDisabled) || !any;
  }

  onChange(event) {
    const dialog = event.target.closest && event.target.closest("mat-dialog-container");
    if (!dialog) return;
    if (dialog.querySelector('input[placeholder="Investment"]')) {
      this.refreshInvestmentButton(dialog);
      return;
    }
    const card = event.target.closest(".source-card");
    const checkbox = card?.querySelector('input[type="checkbox"]');
    if (card && checkbox) {
      card.classList.toggle("source-card--checked", Boolean(checkbox.checked));
      checkbox.classList.toggle("mdc-checkbox--selected", Boolean(checkbox.checked));
      card.querySelector("mat-checkbox")?.classList.toggle(
        "mat-mdc-checkbox-checked",
        Boolean(checkbox.checked),
      );
    }
    this.refreshButtons(dialog);
  }

  onClick(event) {
    const element = event.target;
    const button = element.closest && element.closest("button");
    const dialog = element.closest && element.closest("mat-dialog-container");
    this.clicks.push({
      tag: element.tagName,
      id: element.id || null,
      className: String(element.className || ""),
      text: String(element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
      inDialog: Boolean(dialog),
    });

    if (!dialog && element.closest && element.closest("button.btn-section-add")) {
      this.openDialog();
      return;
    }
    if (!dialog && element.closest && element.closest('#add-adjustable-tax-generic[title="Add"]')) {
      this.openInvestmentDialog();
      return;
    }
    if (!dialog || !button || button.disabled) return;
    const label = button.textContent.trim().toLowerCase();
    if (label === "cancel") {
      dialog.remove();
      return;
    }
    if (label === "add") {
      const investment = dialog.querySelector('input[placeholder="Investment"]');
      const contents = dialog.querySelector("textarea");
      if (investment && contents) {
        this.addDetailRow(investment.value.trim(), contents.value.trim());
        dialog.remove();
        return;
      }
      const selected = [...dialog.querySelectorAll(".source-card")].filter((card) => {
        const input = card.querySelector('input[type="checkbox"]');
        return Boolean(input && input.checked && !input.disabled);
      });
      if (selected.some((card) => card.querySelector("p")?.textContent.trim() === this.label)) {
        this.addParentRow();
        dialog.remove();
      }
    }
  }
}

module.exports = { FakeIrisBankProfit, CODE, LABEL };
