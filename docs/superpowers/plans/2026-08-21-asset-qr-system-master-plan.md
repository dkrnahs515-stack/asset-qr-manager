# Asset QR System Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coordinate the approved asset current-state, QR detail, and A4 label subplans into a safe sequence that ends with 842 verified permanent QR labels.

**Architecture:** Three implementation plans execute in dependency order: derived current-state foundation, QR issuance/read-only detail app, then A4 label printing and rollout. Each stage has a hard evidence gate; no downstream stage begins on assumed success. This master plan also supplies security and compatibility rules that override illustrative snippets in a subplan when they differ.

**Tech Stack:** Google Apps Script V8, Google Sheets, HtmlService, vanilla JavaScript, Node.js 20 `node:test`, browser print CSS

**Spec:** `docs/superpowers/specs/2026-08-21-asset-qr-detail-label-design.md`

## Global Constraints

- Execute subplans in the order listed below.
- Use a dedicated implementation branch/worktree created from the latest `feature/inventory-mobile-mvp` state; do not implement directly on `main`.
- Run `npm test` after every task and before every completion claim.
- Keep the existing inspection `/exec` URL stable by editing its current deployment to a new version.
- Create one separate detail-app deployment and keep that `/exec` URL stable before issuing permanent QR keys.
- Never issue all 842 QR keys before the five-asset detail pilot and one-sheet label pilot pass.
- Never record physical output merely because `window.print()` opened; explicit completion confirmation is required.
- Do not template-inject unvalidated URL query text into executable JavaScript. The detail client reads `k` with `new URLSearchParams(window.location.search).get('k') || ''`, and the server validates it before lookup.
- Do not expose sheet-derived values through `innerHTML`; use `textContent`. The only permitted `innerHTML` use is insertion of SVG returned by the pinned local QR encoder.
- Node-only globals such as `Buffer` must be guarded behind `typeof module !== 'undefined'`; Apps Script production paths use `Utilities.base64EncodeWebSafe`.
- Label filter floors and spaces come from `위치마스터` plus distinct locations in `비품현재상태`; they must not depend on `getBootstrapData()` or the presence of an active inspection session.
- The current-state, QR issue, and label APIs use exact system-ID/key matching and reject duplicate active rows rather than selecting one arbitrarily.

---

## Subplan Dependency Order

1. `docs/superpowers/plans/2026-08-21-asset-current-state-foundation.md`
2. `docs/superpowers/plans/2026-08-21-asset-qr-detail-app.md`
3. `docs/superpowers/plans/2026-08-21-asset-a4-label-printing.md`

---

### Task 1: Complete the current-state foundation gate

**Files:**
- Execute: `docs/superpowers/plans/2026-08-21-asset-current-state-foundation.md`

**Interfaces:**
- Produces: three new sheets, 842 valid current-state rows, current-state sync on judgments/revisions/Undo, and repeat-session baselines.

- [ ] Execute every task in the current-state plan in order.
- [ ] Run `npm test`; require zero failures.
- [ ] Run `installAssetQrSchema()`, `rebuildAllCurrentStates()`, and `auditCurrentState()` in the test deployment.
- [ ] Require `registeredCount=842`, `stateCount=842`, no duplicates, no missing IDs, and no sync-error IDs.
- [ ] Verify normal, location change, issue, missing, revision, and Undo examples against the sheet.
- [ ] Update the existing inspection deployment to a new version only after the test deployment passes.

**Gate:** Do not start Task 2 until all current-state evidence is recorded.

---

### Task 2: Complete the QR detail pilot gate

**Files:**
- Execute: `docs/superpowers/plans/2026-08-21-asset-qr-detail-app.md`

**Interfaces:**
- Consumes: valid current-state foundation.
- Produces: stable read-only detail `/exec` URL and five verified pilot QR keys.

- [ ] Implement QR issuance and the separate detail project task-by-task.
- [ ] In the detail client, read the query key exactly as follows:

```javascript
var initialKey = new URLSearchParams(window.location.search).get('k') || '';
```

- [ ] Keep `doGet()` free of raw query-value injection; it returns the static HTML shell.
- [ ] Run `npm test`; require zero failures and readonly-source checks.
- [ ] Deploy the detail project as deployer, accessible to signed-in Google users.
- [ ] Save the stable detail `/exec` URL in `라벨설정.상세조회배포URL`.
- [ ] Issue keys to exactly five pilot assets covering normal, location change, issue, missing, and partial basic information.
- [ ] Verify signed-out denial/login, five correct assets, invalid key, inactive key, and history pagination.
- [ ] Require `auditQrIssues()` to report five active valid unique keys and no master URL mismatches.

**Gate:** Do not start Task 3 until all five QR pages resolve correctly on smartphones.

---

### Task 3: Complete the one-sheet label pilot gate

**Files:**
- Execute Tasks 1–7 of `docs/superpowers/plans/2026-08-21-asset-a4-label-printing.md`.

**Interfaces:**
- Consumes: stable detail URL and pilot QR keys.
- Produces: calibrated Formtec settings and a 10–20 asset attached-label pilot.

- [ ] Implement label core, administrator APIs/UI, local QR vendor, and exact print CSS.
- [ ] Build label filter floors/spaces from `위치마스터` and `비품현재상태`, including operation when no inspection session is active.
- [ ] Verify the vendored QR code package version/license and preserve its notice.
- [ ] Run `npm test`; require zero failures.
- [ ] Print a plain-A4 alignment page and record X/Y/gap corrections.
- [ ] Print one actual LS-3106 sheet at 100%, with browser headers/footers disabled and fit-to-page off.
- [ ] Scan every printed pilot QR on at least two smartphones.
- [ ] Attach 10–20 labels in one room and rescan after attachment.
- [ ] Record one completed print batch and one same-key damaged-label reprint.

**Gate:** Do not issue all QR keys until alignment, readability, scan, linkage, and reprint tests pass.

---

### Task 4: Complete the 842-asset production rollout

**Files:**
- Execute Task 8 of `docs/superpowers/plans/2026-08-21-asset-a4-label-printing.md`.

**Interfaces:**
- Consumes: passed current-state, detail, and label pilots.
- Produces: 842 active QR URLs and recorded permanent labels.

- [ ] Freeze the stable detail deployment URL and final label settings.
- [ ] Run current-state and QR pre-issue audits.
- [ ] Generate/reuse active keys for all remaining unissued assets.
- [ ] Print in controlled batches and explicitly record each completed batch.
- [ ] Sample-scan the first, middle, and last label on every A4 sheet before attachment.
- [ ] Require 842 active keys, 842 populated master URLs, 842 completed issue rows, zero duplicate/invalid keys, and no unexpected reprint flags.
- [ ] Record total printed sheets, batch IDs, replacements, scan sample count, and final audit outputs.

---

## Final Verification Checklist

- [ ] `npm test` reports zero failures at final branch head.
- [ ] Inspection web app remains functional at its original `/exec` URL.
- [ ] Detail web app remains functional at its single stable `/exec` URL.
- [ ] Signed-out users cannot directly view detail data.
- [ ] Every active QR key resolves to exactly one active asset.
- [ ] Current location follows judgment, revision, and Undo rules.
- [ ] Label selection works when an inspection session is active, completed, or absent.
- [ ] Formtec and free-cut profiles both print 64×34mm labels.
- [ ] Every label shows `정: 김은영`, `부: 김정훈`, New asset number, item name, inspection date, and QR.
- [ ] Print completion and reprint history are present in `QR발급관리`.
- [ ] Final evidence is attached to the implementation PR before merge.
