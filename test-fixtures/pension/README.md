# Pension review update + PKR 12,000,000 QA statement

- **Date:** 19 October 2026
- **Base repository commit:** `92adebbc1283de828229164414615efb7f901ce8`
- **Status:** Local code implemented and tested. No push, deployment, migration or live FBR submission performed.

> Yeh tamam figures fictional hain. PDF sirf isolated QA/staging ke liye hai — real return, identity verification, loan application ya FBR/IRIS submission ke liye nahin.

## 1. Review Note ka final decision

**Pension Tax Base Review Note routine statement ke liye mandatory nahin hai.** Is ko normal printed-facts grid se nikaal kar conditional reviewer panel mein rakha gaya hai.

| Stage | Required / conditional policy |
|---|---|
| Statement facts ki approval | Matching **Tax Year** aur positive **Gross Pension (Annual PKR)** always required. Monthly/net amount annual gross ka substitute nahin. |
| Standard gross-only statement | Approved pension amount dobara type karna, review note aur artificial ledger-overlap entry zaroori nahin. Reviewed annual gross basis use hoti hai. |
| Missing actual withholding | Facts approve ho sakte hain, lekin final tax, payable/refund aur packet hold rehte hain. Missing withholding **zero nahin** banti. Verified 0 ya verified actual deduction enter karni hogi. |
| Manual tax-base override | Gross se different approved basis par reason required hai: at least five characters; actual treatment ko meaningfully explain karein. |
| Non-zero medical / material source mismatch | Tax base automatically decide nahin hoti. Explicit reviewed basis aur reason chahiye, including when reviewer chooses gross. Neither automatic medical exemption nor automatic inclusion. |
| Pension withholding overlap | Confirmed actual deduction 0 ho, ya positive deduction ke saath checked current tax ledger total 0 ho, to overlap safely 0 resolve hota hai. Positive deduction + existing/unknown tax ledger par reviewed allocation chahiye. Aggregate TAX_PAYMENT entries ko pension withholding samajh kar allocate nahin kiya jata. |
| Optional printed details | Name, PPO, net, medical, DOB/CNIC and currency may remain optional. Provided recognised values still validate: invalid amounts, duplicate facts, invalid identity dates, mismatches and non-PKR currency are rejected. |

Aapke original screenshot mein **medical allowance 504,000** non-zero tha. Us case mein allowance treatment ka genuine review ab bhi chahiye; sirf routine note ki condition hatayi gayi hai. Gross + medical = net hone se legal pension tax base automatically prove nahin hoti.

Frontend markers, textarea attributes, Save & Approve Map validation and server-side readers ab isi staged policy ko follow karte hain. Draft saves incomplete data retain kar sakti hain; approval/tax readiness gates alag hain. Non-finite supplied numbers save se pehle reject hote hain, taake JSON unhein null bana kar invalid override erase na kare. Missing fact par confidence badge nahin dikhaya jata. Optional reviewer fields absent hon to UI unhein add/edit kar sakti hai; human edits quoted-model evidence ko reuse nahin kartin.

## 2. Uploadable pension PDF

**File:** `SYNTHETIC-Pension-12M-TY2026.pdf`

| Printed fact | Amount / value |
|---|---:|
| Tax Year | 2026 |
| Reporting period | 1 July 2025 – 30 June 2026 |
| Monthly gross pension | PKR 1,000,000 |
| Annual gross pension | **PKR 12,000,000** |
| Medical allowance, annual | Explicit **PKR 0** |
| Actual pension tax deducted, annual | Explicit **PKR 0** |
| Annual net pension paid | PKR 12,000,000 |
| Payment schedule | All twelve months printed |

Fictional pensioner/issuer/PPO hain. No government emblem, real signature, CNIC or DOB is printed. PDF mein app-only Approved Pension Amount, Ledger Overlap aur Review Note print nahin kiye gaye — validator pass karwane ke liye artificial review fields add nahin kiye.

`above-10m-ty2026.json` mein expected extraction, setup and current-engine results hain. AI extra optional fields la sakta hai; important annual values ko original PDF se verify karein. Annual amount **12M**, monthly amount **1M** hai — inhein swap na karein.

## 3. Staging UI test — reproducible main scenario

1. **Isolated QA account / staging database** use karein. Real taxpayer profile ko test DOB ya test assets se replace na karein.
2. TY **2026**, resident / myself filing, **pension only** select karein. No salary, rent, bank profit, unrelated tax credit or other route in this reference scenario.
3. Former employer / associate employment question ka answer **No** rakhein. Yeh PDF se infer nahin hota; intake mein alag decision hai.
4. Test profile DOB **1962-03-15** rakhein, with separately approved QA identity/profile prerequisites. PDF se DOB/profile overwrite nahin hota. Above-10M scenario mein age confirmation important hai; unknown age ya 70+ profile ka result reference case se different ho sakta hai.
5. Upload `SYNTHETIC-Pension-12M-TY2026.pdf`, extract, original ko dekh kar annual facts verify karein. Printed tax deducted **0** hai — calculated liability ko deduction field mein enter na karein.
6. Standard case mein advanced Approved Amount / Ledger Overlap / Review Note blank rehne dein. Tax Year aur Gross Pension required markers hon; Save & Approve Map artificial note ki wajah se disabled na ho.
7. **Save & Approve Map** press karein. Approval facts ko confirm karti hai; final tax readiness phir independently check hoti hai. Pension mapping koi duplicate cash-income row nahin banati.
8. Cash/bank/wealth prerequisites bhi separately complete karein. If every payment is retained: opening wealth/bank **0**, pension cash inflow **12M**, annual expenses **0**, closing bank/wealth **12M**. Existing bank imports ki pension entries dobara manually add na karein.
9. Actual TAX_PAYMENT ledger total is **0** in this reference case. Recalculate Tax, verify the results below, then try packet generation.
10. Above-10M standard pension ka default automatic portal packet **hold/block** expected hai. App ka explicit manual-coverage option use karne par partial/manual packet aur review PDF mil sakte hain. Woh complete auto-entry packet ya submission approval nahin hai.

**Ek pension statement poore filing data ka substitute nahin:** CNIC/profile, bank statements/import, classification, expenses, wealth and reconciliation apni supporting QA inputs maangte hain. Is pack mein pension document hai, matching bank statement ya CNIC nahin. Offline test harness in dependencies ko doubles/seed data se provide karta hai; real bank/profile workflow live verify nahin hua.

## 4. Expected current-engine result

For this specific **No + below-70 confirmed profile + pension-only + nil withholding** scenario:

| Result | PKR |
|---|---:|
| Reviewed pension tax source | **12,000,000** |
| Excess used by current rule | 2,000,000 |
| Base tax: 5% × 2,000,000 | 100,000 |
| Current-engine surcharge: 10% × base tax | 10,000 |
| Total estimated liability | **110,000** |
| Actual tax withheld | **0** |
| Tax payable | **110,000** |
| Refund | **0** |

These are the repository's **existing TY2026 rule expectations**, not independent legal certification. Medical treatment, age-date rules and surcharge law were not re-certified for this change. Tax pricing rules were not changed.

The PDF correctly prints actual withholding **0**, not estimated tax **110,000**. It intentionally tests a payable-tax case.

## 5. Expected safeguards / negative tests

- Clear tax deducted in staging review: document facts can still be approved; calculation becomes `NEEDS_RULES`, with tax/payable/refund **null**, and packet generation stays blocked. Unknown is not zero.
- Manual approved amount different from gross without reason: UI and backend refuse approval. Same ordinary gross amount re-entered is not an override.
- Non-zero medical or net receipts above the stated components: facts can be reviewed; final tax needs an explicit basis and reason. No annual net-to-gross substitution.
- Positive pension deduction with current tax ledger 0: no overlap retyping required. With positive existing ledger: no blind allocation; resolve actual overlap first.
- Invalid amount, duplicate recognised field, wrong TY, foreign currency or identity mismatch: reject; do not silently repair the source.
- A monthly-only slip does not become an annual amount through ×12 or by copying net.
- Editing an approved pension source makes local approval pending; saving/reapproval invalidates downstream calculation/packet/jobs. Recalculate and generate a fresh packet.
- Pension-review policy is included in the source fingerprint (`pension-review-v2-conditional-note`), so pre-update pension packets must be refreshed rather than trusted under changed semantics.
- **Manual IRIS hold remains enabled.** Above-10M full-pension-versus-excess mapping and surcharge remain manually reviewed. Desktop must not auto-fill/submit unsupported pension fields or deduct 10M twice.

## 6. Verification performed

| Verification | Result |
|---|---|
| `npm run verify:pension-review` | **216 / 216 tests passed** |
| `tsc --noEmit --incremental false` | Pass, no errors |
| `npm run lint` | Pass, **19 pre-existing React-hook warnings** |
| `node scripts/sanity-pension-yes-no.cjs` | Pass, 19 assertions |
| `node scripts/verify-ty2026-tax-calculation.cjs` | Pass |
| Salary-certificate field/gross-source checks | Pass |
| Document extraction lease/recovery checks | Pass |
| PDF inspection | 1 page; annual values/explicit zeroes/months readable; fictional marking present; no internal review fields; visually inspected |

The targeted suite includes the actual PDF-byte read and provider-request payload with **mocked model response**, real server approval, parser/source resolver, calculation, manual packet, review-PDF generation and desktop hold. It also tests optional-field additions through a real React hook/JSDOM harness.

**Not performed:** live Google/Gemini extraction, real database writes, real bank reconciliation, production browser session, native Electron execution or any FBR/IRIS portal submission. Session/database/provider/reconciliation dependencies in action tests are mocked. No claim of full live end-to-end completion. `verify:all` was not used; unrelated pre-existing integration/stale-harness findings are outside this change.

## 7. Developer commands

From the repository root, after normal dependency setup:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npx prisma generate
npm run fixture:pension-12m
npm run verify:pension-review
npx tsc --noEmit --incremental false
npm run lint
```

No schema migration or dependency version changes were needed. `fixture:pension-12m` uses the existing `pdfkit` dependency. `verify:pension-review` runs the new policy regressions plus pension statement, pension prefill and shared document-review tests.

**Local code vs live app:** workspace changes do not automatically update a deployed website or desktop build. Apply/review the included patch (or use the modified workspace source), run tests, then deploy through your normal process. For the patch's exact base commit:

```bash
git apply --check pension-review.patch
git apply pension-review.patch
npm run verify:pension-review
```

If `--check` fails on another revision, do not force it; review/merge the changes against that revision. Recalculate affected pensions and regenerate/reapprove old packets after deployment.

## 8. Implementation map

- `lib/tax/pension-statement-fields.ts`: facts vs tax-ready readers; conditional reason; unknown withholding preservation; no routine app-field injection; material mismatch/currency validation.
- `lib/tax/document-review-required.ts`: passes actual fields into conditional Required-marker policy.
- `app/actions/extraction.ts`: printed-facts-only extraction prompt; transaction-safe facts approval; identity/ledger bounds retained.
- `lib/tax/pension-source.ts`: strict readiness with current ledger context; policy-aware fingerprint.
- `components/tax/filing/pension-tax-review-panel.tsx`: separate conditional reviewer controls and readiness guidance.
- Document hook, wizard and document step: adds absent optional decisions, clears stale evidence, resets approval/downstream state and removes hardcoded required note.
- `app/actions/packet.ts`: meaningful gross-basis description when no override note; manual portal warning retained.
- Regression scripts, fixture JSON/PDF/generator and npm verification commands.
- Shared source-wiring test: made one whitespace-sensitive assertion tolerant of existing multiline code; no unrelated business-rule test was removed.
