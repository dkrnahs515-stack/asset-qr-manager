# QR Asset Label Print Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved `라벨출력` workflow: select assets in Google Sheets, preview exact Formtec LS3106 A4 pages in groups of 24, print/save as PDF at the physically confirmed coordinates, and record only explicitly confirmed physical output in `QR발급관리`.

**Architecture:** `라벨출력` is a derived work sheet, never an authority. Pure logic lives in `LabelPrintCore.js`; Apps Script I/O, selection, preview snapshots, and completion live in `LabelPrint.gs`; `LabelPrintPanel.html` controls the work sheet; `LabelPrintPreview.html` renders exact A4 geometry and local SVG QR codes. A preview is immutable: the batch ID, QR key/URL, label text, managers, inspection date, label version, and calibrated geometry are snapshotted at preview creation. Completion revalidates only current runtime/asset/active-QR identity, then records the exact snapshot that was physically printed. Writes are locked, idempotent by batch ID, and retry-safe after partial failures.

**Tech Stack:** Google Apps Script V8, SpreadsheetApp, HtmlService, CacheService, PropertiesService, vanilla HTML/CSS/JavaScript, vendored `qrcode-generator` 1.4.4 (MIT), Node.js 20 `node:test`, browser print CSS.

**Spec:** `docs/superpowers/specs/2026-08-26-asset-label-print-design.md`

## Global Constraints

- The 2026-08-26 spec is authoritative; older label plans are historical only.
- Formtec LS3106: A4, label `64 × 33.9mm`, `3 × 8`, 24/page.
- Final calibration: global X `-1.8mm`, global Y `+2.7mm`, third-column X `+0.3mm`.
- Derived X positions: `4.7mm`, `71.2mm`, `138.0mm`; first-row top `9.8mm`; row pitch `33.9mm`.
- QR size `20mm`; outer black border removed; light internal divider retained.
- New asset number and item name start at `9.3pt`; only long item names shrink, minimum `7.2pt`.
- Show `관리책임자`, then `정 김은영 · 부 김정훈` about `9pt` bold.
- `조사 일자` is centered under QR and is `비품현재상태.최근판정일시` formatted `yyyy.MM.dd`; absent history => `미조사`.
- TEST shows `TEST PILOT`; PRODUCTION does not.
- Label printing never issues a QR key. Do not call `ensureActiveQrIssueForAsset_()` or `issueQrAccessKeys()` from label-print code.
- A printable asset has exactly one active QR row (`QR접근키상태=사용`), valid 32-char URL-safe key, exact lookup URL, matching master QR URL, `사용여부=사용`, nonblank New asset number, and nonblank name.
- Any invalid selected asset aborts the whole preview; never silently omit it.
- Opening preview or print dialog writes nothing. Only `출력 완료 반영` writes print history.
- The same preview keeps one batch ID; repeated completion is idempotent.
- `라벨출력` must not be added to `ASSET_RUNTIME_REQUIRED_SHEETS`; runtime validation must succeed before the derived sheet exists.
- No new OAuth scopes and no external QR API/UrlFetch.
- TEST verification precedes every PRODUCTION change.

## Target Files

Create:
- `apps-script/LabelPrintCore.js`
- `apps-script/LabelPrint.gs`
- `apps-script/LabelPrintPanel.html`
- `apps-script/LabelPrintPreview.html`
- `apps-script/QrVendor.html`
- `THIRD_PARTY_NOTICES.md`
- `tests/label-print-core.test.js`
- `tests/label-print-source.test.js`

Modify:
- `apps-script/Code.gs`
- `apps-script/SchemaSetup.gs`
- `tests/schema-setup.test.js`
- `tests/syntax.test.js`
- `apps-script/README.md`

Do not modify `QrCore.js`, `QrAdmin.gs`, runtime files, or `apps-script-detail/*` unless a failing test proves it is necessary.

---

### Task 1: Pure rules, validation, ordering, pagination, and geometry

**Files:** Create `apps-script/LabelPrintCore.js`, `tests/label-print-core.test.js`.

**Interfaces:**

```javascript
normalizeLabelPrintSettings(raw)
classifyLabelPrintType(issue)
validateLabelPrintCandidate(asset, currentState, issueRows, settings)
sortLabelPrintItems(items)
paginateLabelPrintItems(items, pageSize)
calculateLabelSlotPosition(settings, slotIndex)
makeLabelPrintBatchId(dateKey, sequence)
buildLabelPrintCompletionPatch(issue, context)
```

- [ ] **Write failing geometry/pagination tests.**

```javascript
const settings = normalizeLabelPrintSettings({
  '기본 라벨규격':'FORMTEC_LS3106','라벨버전':'LABEL-2026-01',
  '라벨가로mm':'64','라벨세로mm':'33.9','페이지열수':'3','페이지행수':'8',
  '페이지왼쪽여백mm':'6.5','페이지위쪽여백mm':'12.5','열간격mm':'2.5','행간격mm':'0',
  'QR크기mm':'20','가로보정mm':'-1.8','세로보정mm':'2.7','3열가로보정mm':'0.3',
  '인쇄배율':'100','관리책임자 정':'김은영','관리책임자 부':'김정훈',
  '책임자버전':'RESP-2026-01','상세조회배포URL':'https://script.google.com/macros/s/DEPLOYMENT123/exec'
});
assert.deepEqual(calculateLabelSlotPosition(settings,0), {row:0,column:0,xMm:4.7,topMm:9.8});
assert.deepEqual(calculateLabelSlotPosition(settings,1), {row:0,column:1,xMm:71.2,topMm:9.8});
assert.deepEqual(calculateLabelSlotPosition(settings,2), {row:0,column:2,xMm:138,topMm:9.8});
assert.deepEqual(calculateLabelSlotPosition(settings,23), {row:7,column:2,xMm:138,topMm:247.1});
assert.equal(paginateLabelPrintItems(Array(24).fill({}),24).length,1);
assert.equal(paginateLabelPrintItems(Array(25).fill({}),24).length,2);
assert.equal(paginateLabelPrintItems(Array(49).fill({}),24).length,3);
```

- [ ] **Run RED:** `node --test tests/label-print-core.test.js` → FAIL because core file/functions are absent.
- [ ] **Implement settings parsing and zero-based slot math** using `x = left + xCorrection + col*(width+gap) + (col===2 ? thirdColumnCorrection : 0)` and `top = topMargin - yCorrection + row*(height+rowGap)`. Round exposed millimeter values to one decimal.
- [ ] **Add failing validation tests** for: no active QR, duplicate active QR, stopped-only, malformed key, URL/key mismatch, master URL mismatch, inactive asset, blank number/name, first-print classification, reprint classification.
- [ ] **Run RED**, then implement validation locally without mutable QR helpers. Return `{ok, reason, issue, printType}`.
- [ ] **Add failing ordering tests** proving mapped floor/location order follows `위치마스터.모바일정렬순서`, same-space rows sort by New asset number, and unknown locations sort last.
- [ ] **Add failing completion-patch tests** proving first print does not increment reprint count, reprint increments exactly once and preserves reason, and same `lastPrintBatchId` returns duplicate/unchanged.
- [ ] **Add batch-ID tests:** `makeLabelPrintBatchId('20260826',1) === 'LABEL-20260826-001'` and sequence 12 => `...-012`.
- [ ] **Implement minimum code and run GREEN:** `node --test tests/label-print-core.test.js && npm test`.
- [ ] **Commit:**

```bash
git add apps-script/LabelPrintCore.js tests/label-print-core.test.js
git commit -m "feat: add pure asset label print rules"
```

---

### Task 2: Calibrated schema and derived `라벨출력` sheet

**Files:** Modify `Code.gs`, `SchemaSetup.gs`, `tests/schema-setup.test.js`, `tests/syntax.test.js`; create `LabelPrint.gs`, `tests/label-print-source.test.js`.

**Exact row-4 headers:**

```javascript
var LABEL_PRINT_HEADERS = [
  '출력선택','출력구분','New 비품번호','품명','현재층','현재공간명','현재조사결과',
  'QR상태','QR발급상태','재출력필요','최근조사일','출력가능여부',
  '영구 시스템 ID','QR조회URL','위치정렬순서'
];
```

- [ ] **Write failing schema tests** for `LABEL_PRINT:'라벨출력'`, all 15 headers, and settings `라벨버전=LABEL-2026-01`, `가로보정mm=-1.8`, `세로보정mm=2.7`, `3열가로보정mm=0.3`. Assert runtime required-sheet list does not include `라벨출력`.
- [ ] **Run RED:** `node --test tests/schema-setup.test.js`.
- [ ] **Update `LABEL_SETTING_DEFAULTS`** with those values. Preserve `seedLabelSettings_()`'s existing-key behavior so TEST values are never overwritten.
- [ ] **Add `ensureLabelPrintWorkSheet_()`** and invoke it from `installAssetQrSchema()`. Layout: row1 title/runtime/panel link, row2 selection/page/refresh summary, row3 help, row4 headers, row5+ data. Freeze 4 rows; hide M:O.
- [ ] **Write failing source tests** requiring `refreshLabelPrintSheet()` and `getLabelPrintSheetStatus()`, and proving the service reads `비품마스터`, `비품현재상태`, `QR발급관리`, `위치마스터`, `라벨설정` while not calling QR issuance helpers.
- [ ] **Run RED:** `node --test tests/label-print-source.test.js`.
- [ ] **Implement refresh.** Exclude master rows whose `사용여부` is not `사용`; keep active-use assets visible even when not printable. Missing current state falls back to master floor/space and `미조사`. Only printable rows get checkbox validation. `최근조사일` uses `Utilities.formatDate(value,'Asia/Seoul','yyyy.MM.dd')`.
- [ ] **Rewrite only the derived work area**; never clear source sheets. Clear selections on refresh, update summary, sort browse rows consistently, and recreate sheet filter if needed.
- [ ] **Add `LabelPrintCore.js` and `LabelPrint.gs` to syntax tests.**
- [ ] **Run GREEN:** `node --test tests/schema-setup.test.js tests/label-print-source.test.js tests/syntax.test.js && npm test`.
- [ ] **Commit:**

```bash
git add apps-script/Code.gs apps-script/SchemaSetup.gs apps-script/LabelPrint.gs tests/schema-setup.test.js tests/label-print-source.test.js tests/syntax.test.js
git commit -m "feat: add label print work sheet"
```

---

### Task 3: Filters, bulk selection, menu, and panel fallback

**Files:** Modify `LabelPrint.gs`, `Code.gs`, tests; create `LabelPrintPanel.html`.

**Server interfaces:**

```javascript
getLabelPrintPanelBootstrap()
applyLabelPrintSheetFilter(request)
selectVisibleLabelPrintRows()
clearLabelPrintSelection()
selectReprintLabelRows()
getSelectedLabelPrintSystemIds()
showLabelPrintPanel()
installLabelPrintUi()
labelPrintOnOpen_(event)
```

- [ ] **Write failing source tests** for the approved controls: 목록 새로고침, 현재 필터 전체선택, 선택해제, 재출력 대상 선택, 선택 라벨 미리보기. Require an installable spreadsheet onOpen trigger and a direct web-panel hyperlink fallback.
- [ ] **Run RED:** `node --test tests/label-print-source.test.js`.
- [ ] **Implement filters** `{search,floor,spaceName,outputState}`. Search matches New number, name, or system ID. Re-applying filters first shows all data rows, then hides nonmatches.
- [ ] **Implement bulk selection.** Visible-select checks only visible + `출력가능`; reprint-select checks visible + printable + (`재출력필요=Y` or `QR발급상태=재발급필요`). Clear-selection unchecks all.
- [ ] **Create `LabelPrintPanel.html`** with filter fields, five approved actions, selected count, and estimated pages `ceil(N/24)`. Use `google.script.run` with visible error/success messages.
- [ ] **Implement `installLabelPrintUi()`** to remove duplicate label-print open triggers, create one installable spreadsheet onOpen trigger, and write the `?view=label-panel` link in the work sheet. `labelPrintOnOpen_()` adds the `QR 라벨` menu; direct web panel remains the guaranteed fallback if UI/menu is unavailable.
- [ ] **For preview opening**, synchronously open a blank window on the button click, then navigate it to the server-returned preview URL; if blocked, display a clickable URL instead.
- [ ] **Parse panel inline JS in syntax tests**, then run `node --test tests/label-print-source.test.js tests/syntax.test.js && npm test`.
- [ ] **Commit:**

```bash
git add apps-script/LabelPrint.gs apps-script/LabelPrintPanel.html apps-script/Code.gs tests/label-print-source.test.js tests/syntax.test.js
git commit -m "feat: add label print selection controls"
```

---

### Task 4: Immutable preview sessions, routing, and 24-slot models

**Files:** Modify `LabelPrint.gs`, `Code.gs`, tests; create initial `LabelPrintPreview.html`.

**Interfaces:**

```javascript
createSelectedLabelPrintPreview()
prepareLabelPrintPreview(request)
getLabelPrintPreviewModel(token)
makeNextLabelPrintBatchId_()
makeLabelPrintPreviewToken_()
storeLabelPrintPreviewSnapshot_(snapshot)
loadLabelPrintPreviewSnapshot_(token)
validateLabelPrintPreviewSnapshot_(snapshot)
```

- [ ] **Write failing tests** requiring CacheService, ScriptProperties daily sequence, strict opaque token, TTL `21600`, and whole-preview failure if one item is invalid. Assert no mutable QR issuance call.
- [ ] **Run RED:** `node --test tests/label-print-source.test.js`.
- [ ] **Implement authoritative preparation.** Read only selected system IDs from `라벨출력`, then re-read all source sheets. Validate every ID; collect all failures; if any failure exists, throw one aggregate error with requested/invalid counts, system ID, New number when known, and reason. Create no snapshot on failure.
- [ ] **After successful validation only**, under Script Lock increment `ASSET_LABEL_BATCH_SEQUENCE_<yyyyMMdd>` and create `LABEL-yyyyMMdd-NNN`. Create a compact URL-safe token.
- [ ] **Snapshot all printed facts immutably.** Manifest must contain:

```javascript
{
  token, batchId, environment, createdAt, pageCount, itemCount,
  printSettings: {
    labelType, labelVersion, labelTitle,
    labelWidthMm, labelHeightMm, columns, rows, pageSize,
    leftMarginMm, topMarginMm, columnGapMm, rowGapMm, qrSizeMm,
    xCorrectionMm, yCorrectionMm, thirdColumnXCorrectionMm, printScale,
    primaryManager, secondaryManager, managerVersion
  }
}
```

Each item snapshot contains:

```javascript
{
  systemId, accessKey, qrUrl, newAssetNo, name,
  currentFloor, currentSpaceName, currentResult,
  inspectionDate, printType, locationSortOrder
}
```

The immutable snapshot is the audit record of what is about to be printed. Later `라벨설정` changes must not change an existing preview.

- [ ] **Chunk CacheService entries by page** to stay safe for up to 842 assets: `LPV:<token>:manifest`, `LPV:<token>:page:1`, etc., max 24 items/chunk, TTL 21600.
- [ ] **Revalidate on preview load** that runtime environment matches and each current active QR key/URL still equals the cached key/URL. If reissued/stopped, invalidate the preview. Do not replace cached text/date/managers/geometry with newer values.
- [ ] **Build pages from cached `printSettings`** using `sortLabelPrintItems()`, `paginateLabelPrintItems()`, and `calculateLabelSlotPosition()`.
- [ ] **Route `doGet(e)` safely:** `view=label-panel` -> panel, `view=label-print&token=...` -> preview, otherwise unchanged survey `Index`. Add `includeHtml_(filename)`.
- [ ] **Run GREEN:** `node --test tests/label-print-core.test.js tests/label-print-source.test.js tests/syntax.test.js && npm test`.
- [ ] **Commit:**

```bash
git add apps-script/LabelPrint.gs apps-script/Code.gs apps-script/LabelPrintPreview.html tests/label-print-source.test.js tests/syntax.test.js
git commit -m "feat: add immutable label print previews"
```

---

### Task 5: Local SVG QR and exact approved browser print layout

**Files:** Create `QrVendor.html`, `THIRD_PARTY_NOTICES.md`; complete `LabelPrintPreview.html`; modify tests.

- [ ] **Write failing source tests** requiring `@page { size: A4; margin: 0; }`, a `210mm × 297mm` page, `window.print()`, print-hidden controls, no outer label border, 20mm QR, `조사 일자`, `관리책임자`, nominal 9.3pt number/name, TEST-only marker, local QR include, and no external QR endpoint/UrlFetch.
- [ ] **Run RED:** `node --test tests/label-print-source.test.js`.
- [ ] **Vendor `qrcode-generator` 1.4.4 locally** in `QrVendor.html` from `kazuhikoarase/qrcode-generator`, MIT. `THIRD_PARTY_NOTICES.md` records package/version/source and full MIT license. Runtime must not load this library from a CDN.
- [ ] **Load preview model** via `google.script.run.getLabelPrintPreviewModel(PREVIEW_TOKEN)` and render local SVG from each cached `qrUrl`.
- [ ] **Render exact positions.** `.print-page` is relative `210mm × 297mm`; every label is absolute with `left=<slot.xMm>mm`, `top=<slot.topMm>mm`, dimensions from cached `printSettings`. No outer border.
- [ ] **Render approved internal layout:** QR left; survey date centered below; title/number/name right; light divider; manager title + names; TEST marker only when snapshot environment is TEST.
- [ ] **Fit long item names deterministically:** start 9.3pt, subtract 0.1pt until text fits or 7.2pt. Normal names such as 문서 세단기/하비체어/사각테이블 remain 9.3pt.
- [ ] **Top bar** shows `선택 N개 · M페이지 · Formtec LS3106` and `배율 100% · 실제 크기 · 여백 없음 · 머리글/바닥글 끄기`. Buttons: `인쇄 / PDF 저장`, `출력 완료 반영`, `닫기`. Print button only calls `window.print()`.
- [ ] **Parse preview application JS in syntax tests**, then run `node --test tests/label-print-source.test.js tests/syntax.test.js && npm test`.
- [ ] **Commit:**

```bash
git add apps-script/QrVendor.html apps-script/LabelPrintPreview.html THIRD_PARTY_NOTICES.md tests/label-print-source.test.js tests/syntax.test.js
git commit -m "feat: render calibrated Formtec label previews"
```

---

### Task 6: Explicit, immutable, idempotent completion

**Files:** Modify `LabelPrint.gs`, `LabelPrintPreview.html`, core/source tests.

**Client request:**

```javascript
{ token: '<opaque preview token>' }
```

The client never submits system IDs, managers, inspection date, label version, geometry, batch ID, or QR URL for completion.

- [ ] **Write failing completion tests** requiring Script Lock, cached snapshot load, environment match, active-key/URL revalidation, same-batch skip, per-row error capture, and retry-safe result summary.
- [ ] **Run RED:** `node --test tests/label-print-core.test.js tests/label-print-source.test.js`.
- [ ] **Implement `completeLabelPrintBatch({token})`.** Load the immutable cached snapshot. For each item, revalidate the current active QR still equals cached `accessKey` + `qrUrl`; if not, fail only that item and do not alter it.
- [ ] **Record the exact cached printed settings, never current settings:**

```javascript
var p = snapshot.printSettings;
buildLabelPrintCompletionPatch(issue, {
  batchId: snapshot.batchId,
  printType: item.printType,
  labelType: p.labelType,
  labelVersion: p.labelVersion,
  primaryManager: p.primaryManager,
  secondaryManager: p.secondaryManager,
  managerVersion: p.managerVersion,
  inspectionDate: item.inspectionDate,
  printedAt: new Date()
});
```

Persist `QR발급상태=발급완료`, exact cached label type/version/managers/manager version/inspection date, current completion timestamp, and cached batch ID. Reprint adds 1, sets `재출력필요여부=N`, and preserves `재출력사유`.
- [ ] **Idempotency:** if `최종출력배치ID === snapshot.batchId`, return skipped and change nothing, especially reprint count.
- [ ] **Partial recovery:** catch writes per asset. Return `{batchId,requested,updated,skipped,failed,results}`. Keep cache so the same token retries only failed rows while already-successful rows skip.
- [ ] **Wire completion UI.** Confirm physical output first; disable while running; show batch ID and result counts; on failures list exact assets and keep retry available.
- [ ] **Run GREEN/full regression:** `node --test tests/label-print-core.test.js tests/label-print-source.test.js && npm test`.
- [ ] **Commit:**

```bash
git add apps-script/LabelPrint.gs apps-script/LabelPrintPreview.html tests/label-print-core.test.js tests/label-print-source.test.js
git commit -m "feat: record label print batches idempotently"
```

---

### Task 7: Deployment/operator documentation and full regression

**Files:** Modify `apps-script/README.md`, source tests.

- [ ] **Write failing README contract tests** for Apps Script mappings:

```text
LabelPrintCore.js -> LabelPrintCore.gs
LabelPrint.gs -> LabelPrint.gs
LabelPrintPanel.html -> LabelPrintPanel.html
LabelPrintPreview.html -> LabelPrintPreview.html
QrVendor.html -> QrVendor.html
```

And TEST order: runtime check -> `installAssetQrSchema()` -> `refreshLabelPrintSheet()` -> `installLabelPrintUi()` -> update existing web-app deployment -> five pilot -> print -> completion -> `auditQrIssues()`.
- [ ] **Run RED:** `node --test tests/label-print-source.test.js`.
- [ ] **Document** that the work sheet is derived; printing never issues QR; latest judgment date/`미조사` is printed; preview snapshot expires after 6 hours; actual size 100%; completion is explicit/idempotent; TEST and PRODUCTION stay separated.
- [ ] **State deployment rule:** update the existing mutable Apps Script deployment to a new version; do not create a different permanent deployment URL just for this feature.
- [ ] **Run GREEN/full suite:** `node --test tests/label-print-source.test.js && npm test`.
- [ ] **Commit:**

```bash
git add apps-script/README.md tests/label-print-source.test.js
git commit -m "docs: add label print deployment workflow"
```

---

### Task 8: TEST physical pilot and PR readiness

**TEST sheet:** `1jphVHn1W4DpBkeKwi5mZx5rpuMHkQ9oYE4rEI9au3oQ`

**Five approved assets:** `GSYC-000340`, `GSYC-000820`, `GSYC-000817`, `GSYC-000815`, `GSYC-000003`.

- [ ] **Baseline:** `npm test` must pass; record exact pass count.
- [ ] **Copy to TEST Apps Script:** `LabelPrintCore.js -> LabelPrintCore.gs`, plus `LabelPrint.gs`, both HTML files, `QrVendor.html`, updated `Code.gs`, updated `SchemaSetup.gs`.
- [ ] **Run in TEST editor, in order:**

```javascript
getRuntimeEnvironmentStatus();
installAssetQrSchema();
refreshLabelPrintSheet();
installLabelPrintUi();
```

Expected: environment/projectRole TEST, TEST sheet title, and settings `-1.8 / +2.7 / +0.3 / LABEL-2026-01`.
- [ ] **Update the existing TEST mutable web-app deployment** to a new version. Verify default survey route still loads.
- [ ] **Inspect `라벨출력`:** A:O exact columns, M:O hidden, only printable rows selectable, five pilot assets printable, non-issued assets explicitly show output-unavailable reason.
- [ ] **Select only the five pilot assets** and create preview. Expected 5 items/1 page; TEST marker visible; `GSYC-000003` uses the new active key, never the stopped key.
- [ ] **Scan all five preview QR codes** and confirm each opens its correct read-only detail page.
- [ ] **Physical Formtec print:** A4, 100%/actual size, margins none, headers/footers off, fit-to-page off. Confirm no outer border and third column retains +0.3mm correction.
- [ ] **Press `출력 완료 반영` once**, record batch ID, then press it again. Expected second run updates 0 already-completed rows, skips them, and does not increment counts twice.
- [ ] **Run `auditQrIssues()`**; expected `ok=true` with no duplicate active IDs/keys, invalid keys, missing master IDs, or master URL mismatches.
- [ ] **Final repo verification:**

```bash
npm test
git status --short
git log --oneline --decorate -8
```

Expected full pass, clean tree, task commits in order.
- [ ] **Open draft PR to `feature/asset-current-state`** titled `feat: Google Sheets QR 라벨 자동출력`. Include calibration, five-asset physical/scan/completion/idempotency/audit results, full test count, 100%-print driver risk, and the remaining gate: 24-asset field pilot before 842-wide PRODUCTION output.

## Final Acceptance Checklist

- Exact A:O `라벨출력` work sheet, filters, bulk selection, and reprint selection work.
- Source sheets are authoritative; work-sheet cell contents are never trusted for preview/completion.
- Invalid/missing/stopped/duplicate/mismatched QR data aborts preview and printing never issues keys.
- Visible order is `층 → 공간 → 비품번호`, with mapped spaces driven by `모바일정렬순서` and unknown locations last.
- 24/25/49 items produce 1/2/3 pages.
- Coordinates resolve to `4.7 / 71.2 / 138.0mm`, top `9.8mm`, with third-column +0.3mm.
- 64 × 33.9mm / 3×8 / QR20mm / no outer border / approved typography and manager/date layout are preserved.
- QR generation is local SVG only.
- TEST marker is environment-dependent.
- Browser printing uses A4/100%/no-margin CSS and `window.print()`.
- Preview snapshots preserve the exact QR/text/managers/date/version/geometry printed; later setting changes cannot alter completion history.
- Preview/print-dialog opening writes nothing.
- Explicit completion writes exact snapshot facts, reprint count once, preserves reason, is same-batch idempotent, and can retry partial failures.
- Existing survey/current-state/QR tests remain green.
- Five-asset TEST physical pilot passes before PR readiness.
- No PRODUCTION-wide output happens until the later 24-asset field pilot passes.
