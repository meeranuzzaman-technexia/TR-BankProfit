"use strict";
const navigation = require("./iris-navigation");
const BUILD_TAG = "fix61-bank-profit-existing-category-20261023";

// Captures 30/32: only the explicit Personal Expenditure reason (3212).
// This driver creates a reason row, never writes money, saves or submits.
function pickerProbe(action) {
  const label = "Add Backs u/s 21(h) Personal Expenditure";
  const clean = (node) => {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("mat-icon,script,style").forEach((n) => n.remove());
    return String(clone.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  };
  const visible = (node) =>
    Boolean(
      node &&
      node.getClientRects().length &&
      getComputedStyle(node).display !== "none" &&
      getComputedStyle(node).visibility !== "hidden",
    );
  const bodies = [
    ...document.querySelectorAll("app-nitr-wf-body .body.interface_21.active"),
  ].filter(visible);
  if (bodies.length !== 1)
    return { scope: false, ok: false, reason: "business_body_not_unique" };
  const active = [
    ...bodies[0].querySelectorAll("button.data-tab-left-btn.active"),
  ].filter(visible);
  if (
    active.length !== 1 ||
    clean(active[0]) !== "Inadmissible/Admissible Deductions"
  )
    return { scope: false, ok: false, reason: "wrong_business_tab" };
  const rows = [
    ...bodies[0].querySelectorAll('.tableRows.dataRow[id="3212"]'),
  ].filter(visible);
  const dialogs = [
    ...document.querySelectorAll('mat-dialog-container[role="dialog"]'),
  ].filter(visible);
  if (rows.length > 1)
    return { scope: true, ok: false, reason: "duplicate_personal_addback_row" };
  if (rows.length === 1 && dialogs.length === 0) {
    const description = rows[0].querySelector(".row-description-text"),
      cells = [...rows[0].querySelectorAll(".data-middle-child-wapper input")];
    return {
      scope: true,
      ok:
        description &&
        clean(description) === label &&
        cells.length === 4 &&
        !cells[0].disabled &&
        !cells[0].readOnly,
      reason: "existing_row_checked",
    };
  }
  if (action === "inspect")
    return {
      scope: true,
      ok: false,
      reason: dialogs.length ? "dialog_present" : "row_missing",
    };
  if (action === "open") {
    if (dialogs.length)
      return { scope: true, ok: false, reason: "existing_dialog_not_touched" };
    const buttons = [
      ...bodies[0].querySelectorAll("button.btn-section-add"),
    ].filter((b) => visible(b) && !b.disabled && clean(b) === "+ Inadmissible");
    if (buttons.length !== 1)
      return { scope: true, ok: false, reason: "add_inadmissible_not_unique" };
    buttons[0].click();
    return { scope: true, ok: true, reason: "picker_open_requested" };
  }
  if (
    dialogs.length !== 1 ||
    !dialogs[0].querySelector("app-add-amount-code-row")
  )
    return { scope: true, ok: false, reason: "picker_not_unique" };
  const titles = [...dialogs[0].querySelectorAll("h6")];
  if (titles.length !== 1 || clean(titles[0]) !== "Add Inadmissible Deductions")
    return { scope: true, ok: false, reason: "wrong_picker_title" };
  const cards = [...dialogs[0].querySelectorAll(".source-card")].filter(
    (n) => visible(n) && clean(n) === label,
  );
  if (cards.length !== 1)
    return { scope: true, ok: false, reason: "personal_reason_not_unique" };
  const checkbox = cards[0].querySelector('input[type="checkbox"]');
  if (!checkbox || checkbox.disabled)
    return {
      scope: true,
      ok: false,
      reason: "personal_reason_checkbox_missing",
    };
  const checked = [
    ...dialogs[0].querySelectorAll('input[type="checkbox"]'),
  ].filter((n) => n.checked);
  if (checked.some((n) => n !== checkbox))
    return {
      scope: true,
      ok: false,
      reason: "unrelated_picker_selection_not_touched",
    };
  if (action === "select") {
    if (!checkbox.checked) checkbox.click();
    return { scope: true, ok: true, reason: "personal_reason_selected" };
  }
  if (action === "add") {
    if (!checkbox.checked)
      return { scope: true, ok: false, reason: "personal_reason_not_selected" };
    const buttons = [...dialogs[0].querySelectorAll("button")].filter(
      (b) => visible(b) && !b.disabled && clean(b) === "ADD",
    );
    if (buttons.length !== 1)
      return { scope: true, ok: false, reason: "picker_add_not_ready" };
    buttons[0].click();
    return { scope: true, ok: true, reason: "personal_reason_add_requested" };
  }
  return { scope: true, ok: false, reason: "unsupported_picker_action" };
}
async function ensurePersonalAddbackRow(windowInstance, fields, context = {}) {
  if (context.mode !== "live")
    return { ok: false, reason: "dry_run_no_row_creation" };
  if (
    !fields?.length ||
    fields.some(
      (f) =>
        String(f.irisCode) !== "3212" || f.sourceGroup !== "businessFields",
    )
  )
    return { ok: false, reason: "unsupported_business_reason" };
  const moved = await navigation.navigateToSection(windowInstance, {
    sectionId: "business_deductions",
    taxYear: context.taxYear,
    taxpayerIdentifier: context.taxpayerIdentifier,
  });
  if (!moved.ok)
    return { ok: false, reason: "business_identity_or_structure_not_verified" };
  const structure = await navigation.probeFrames(windowInstance, {
    taxYear: context.taxYear,
  });
  if (
    structure.frames.filter(
      (frame) =>
        frame.section?.id === "business_deductions" &&
        frame.section?.business?.verified === true,
    ).length !== 1
  )
    return { ok: false, reason: "business_structure_not_verified" };
  const wc = windowInstance.webContents,
    frames = wc.mainFrame
      ? [...(wc.mainFrame.framesInSubtree || [wc.mainFrame])]
      : [wc];
  const run = async (frame, action) =>
    frame.executeJavaScript(
      `(${pickerProbe.toString()})(${JSON.stringify(action)})`,
    );
  const allowed = [];
  for (const frame of frames) {
    const url = frame.url || wc.getURL?.();
    if (!navigation.isAllowedPortalUrl(url)) continue;
    const state = await run(frame, "inspect");
    if (state.scope) allowed.push({ frame, state });
  }
  if (allowed.length !== 1)
    return { ok: false, reason: "business_action_frame_not_unique" };
  const { frame, state } = allowed[0];
  if (state.ok) return state;
  if (state.reason !== "row_missing") return state;
  const opened = await run(frame, "open");
  if (!opened.ok) return opened;
  const wait = async (action) => {
    let result;
    for (let i = 0; i < 15; i++) {
      result = await run(frame, action);
      if (result.ok) return result;
      await new Promise((r) => setTimeout(r, 100));
    }
    return result;
  };
  const selected = await wait("select");
  if (!selected.ok) return selected;
  const added = await wait("add");
  if (!added.ok) return added;
  const checked = await wait("inspect");
  if (!checked.ok) return checked;
  const final = await navigation.navigateToSection(windowInstance, {
    sectionId: "business_deductions",
    taxYear: context.taxYear,
    taxpayerIdentifier: context.taxpayerIdentifier,
  });
  if (!final.ok)
    return { ok: false, reason: "added_reason_structure_unverified" };
  const readback = await navigation.probeFrames(windowInstance, {
    taxYear: context.taxYear,
  });
  return readback.frames.filter(
    (frame) =>
      frame.section?.id === "business_deductions" &&
      frame.section?.business?.verified === true,
  ).length === 1
    ? { ok: true, reason: "personal_reason_added_and_structure_verified" }
    : { ok: false, reason: "added_reason_structure_unverified" };
}
module.exports = { BUILD_TAG, ensurePersonalAddbackRow, pickerProbe };
