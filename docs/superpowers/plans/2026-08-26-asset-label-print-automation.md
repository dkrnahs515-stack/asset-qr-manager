# QR Asset Label Print Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved `라벨출력` workflow so an operator can select assets in Google Sheets, generate Formtec LS3106 A4 previews in batches of 24, print or save to PDF at the physically calibrated coordinates, and explicitly record only confirmed physical output in `QR발급관리`.

**Architecture:** Keep `라벨출력` as a derived work sheet, not a source of truth. Apps Script server code re-reads `비품마스터`, `비품현재상태`, `QR발급관리`, `위치마스터`, and `라벨설정` before preview and again before completion. Pure label logic lives in `LabelPrintCore.js`; spreadsheet I/O and cache-backed preview sessions live in `LabelPrint.gs`; a sidebar/web panel controls the work sheet; a separate HTML preview renders exact A4 millimeter geometry and creates SVG QR codes locally from a vendored MIT QR encoder. Print completion is explicit, locked, idempotent by batch ID, and recoverable after partial row-write failures.

**Tech Stack:** Google Apps Script V8, SpreadsheetApp, HtmlService, CacheService, PropertiesService, vanilla HTML/CSS/JavaScript, local vendored `qrcode-generator` 1.4.4 (MIT), Node.js 20 `node:test`, browser print CSS.

**Spec:** `docs/superpowers/specs/2026-08-26-asset-label-print-design.md`

## Global Constraints

- The approved 2026-08-26 spec is the source of truth. Older 2026-08-21 label plans are historical and must not override it.
- Physical label profile is Formtec LS3106: A4, 64 × 33.9mm, 3 columns × 8 rows, 24 labels/page.
- Confirmed print calibration is global X `-1.8mm`, global Y `+2.7mm`, and third-column-only X `+0.3mm`.
- Derived first-row X positions must be `4.7mm`, `71.2mm`, `138.0mm`; first-row top must be `9.8mm`; row pitch is `33.9mm`.
- QR visual size is `20mm`.
- Outer black label borders must not be printed. Keep only the approved light internal separator.
- Item name starts at the same nominal `9.3pt` as New asset number and shrinks only when required to fit.
- Label text includes `관리책임자` and `정 김은영 · 부 김정훈`; manager line is about `9pt` bold.
- `조사 일자` is centered below the QR. The date comes from `비품현재상태.최근판정일시`; when absent, print `미조사`. It is not the print-batch date.
- TEST previews show `TEST PILOT`; PRODUCTION previews do not.
- Printing never creates a new QR key. It may only use exactly one already-active `QR발급관리` row.
- Do not call `ensureActiveQrIssueForAsset_()` from label-print code because that helper creates an active QR when none exists.
- Do not add `라벨출력` to `ASSET_RUNTIME_REQUIRED_SHEETS`; it is a derived sheet that must be creatable after runtime validation.
- Do not add OAuth scopes. Existing Sheets/Drive scopes are sufficient; the QR renderer must not use UrlFetch or an external QR API.
- Preview/opening the browser print dialog does not count as physical output. Only the explicit `출력 완료 반영` action writes print history.
- The same preview retains one batch ID. Repeated completion for that batch is idempotent.
- A selected set containing any invalid item aborts the whole preview; never silently omit an item.
- TEST verification happens before any PRODUCTION changes.

---

## Target File Structure

Create:

- `apps-script/LabelPrintCore.js` — pure settings normalization, validation, sorting, pagination, slot geometry, print-type classification, batch IDs, completion patches.
- `apps-script/LabelPrint.gs` — sheet readers/writers, work-sheet refresh/filter/selection, preview snapshot cache, preview model, completion writes, menu/sidebar integration.
- `apps-script/LabelPrintPanel.html` — work controls for search/filter/select/preview.
- `apps-script/LabelPrintPreview.html` — A4 preview, local QR rendering, print/PDF button, completion button.
- `apps-script/QrVendor.html` — pinned local `qrcode-generator` 1.4.4 browser source.
- `THIRD_PARTY_NOTICES.md` — QR library name/version/source/license notice.
- `tests/label-print-core.test.js` — pure behavior tests.
- `tests/label-print-source.test.js` — Apps Script, route, UI, print CSS, QR-vendor, security contracts.

Modify:

- `apps-script/Code.gs` — `LABEL_PRINT` sheet constant, routed `doGet(e)`, shared HTML include helper.
- `apps-script/SchemaSetup.gs` — label work-sheet headers and calibrated label settings.
- `tests/schema-setup.test.js` — exact work-sheet/settings contract.
- `tests/syntax.test.js` — parse new server/client files.
- `apps-script/README.md` — Apps Script file mapping, TEST setup, print workflow, rollout instructions.

Do not modify unless a failing test demonstrates necessity:

- `apps-script/QrCore.js`
- `apps-script/QrAdmin.gs`
- `apps-script/RuntimeConfigCore.js`
- `apps-script/RuntimeConfig.gs`
- `apps-script-detail/*`

---

### Task 1: Implement pure label-print rules and exact geometry

**Files:**
- Create: `apps-script/LabelPrintCore.js`
- Create: `tests/label-print-core.test.js`

**Public pure interfaces:**

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

#### Steps

- [ ] **Step 1: Write failing settings/geometry tests.**

Add tests that require `LabelPrintCore.js` and assert the approved profile exactly:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLabelPrintSettings,
  calculateLabelSlotPosition,
  paginateLabelPrintItems
} = require('../apps-script/LabelPrintCore.js');

const SETTINGS = {
  '기본 라벨규격': 'FORMTEC_LS3106',
  '라벨버전': 'LABEL-2026-01',
  '라벨가로mm': '64',
  '라벨세로mm': '33.9',
  '페이지열수': '3',
  '페이지행수': '8',
  '페이지왼쪽여백mm': '6.5',
  '페이지위쪽여백mm': '12.5',
  '열간격mm': '2.5',
  '행간격mm': '0',
  'QR크기mm': '20',
  '가로보정mm': '-1.8',
  '세로보정mm': '2.7',
  '3열가로보정mm': '0.3',
  '인쇄배율': '100',
  '관리책임자 정': '김은영',
  '관리책임자 부': '김정훈',
  '책임자버전': 'RESP-2026-01',
  '상세조회배포URL': 'https://script.google.com/macros/s/DEPLOYMENT123/exec'
};

test('approved LS3106 calibration resolves exact first-row positions', () => {
  const settings = normalizeLabelPrintSettings(SETTINGS);
  assert.deepEqual(calculateLabelSlotPosition(settings, 0), { row: 0, column: 0, xMm: 4.7, topMm: 9.8 });
  assert.deepEqual(calculateLabelSlotPosition(settings, 1), { row: 0, column: 1, xMm: 71.2, topMm: 9.8 });
  assert.deepEqual(calculateLabelSlotPosition(settings, 2), { row: 0, column: 2, xMm: 138, topMm: 9.8 });
  assert.deepEqual(calculateLabelSlotPosition(settings, 23), { row: 7, column: 2, xMm: 138, topMm: 247.1 });
});

test('24, 25, and 49 labels paginate to 1, 2, and 3 pages', () => {
  assert.equal(paginateLabelPrintItems(Array(24).fill({}), 24).length, 1);
  assert.equal(paginateLabelPrintItems(Array(25).fill({}), 24).length, 2);
  assert.equal(paginateLabelPrintItems(Array(49).fill({}), 24).length, 3);
});
```

- [ ] **Step 2: Run RED.**

Run:

```bash
node --test tests/label-print-core.test.js
```

Expected: FAIL because `apps-script/LabelPrintCore.js` does not exist.

- [ ] **Step 3: Implement settings normalization and slot math only.**

The normalized object must contain:

```javascript
{
  labelType, labelVersion,
  labelWidthMm, labelHeightMm,
  columns, rows, pageSize,
  leftMarginMm, topMarginMm,
  columnGapMm, rowGapMm,
  qrSizeMm,
  xCorrectionMm, yCorrectionMm, thirdColumnXCorrectionMm,
  printScale,
  primaryManager, secondaryManager, managerVersion,
  labelTitle, detailDeploymentUrl
}
```

Slot formula is zero-based:

```javascript
var row = Math.floor(slotIndex / settings.columns);
var column = slotIndex % settings.columns;
var xMm = settings.leftMarginMm + settings.xCorrectionMm +
  column * (settings.labelWidthMm + settings.columnGapMm) +
  (column === 2 ? settings.thirdColumnXCorrectionMm : 0);
var topMm = settings.topMarginMm - settings.yCorrectionMm +
  row * (settings.labelHeightMm + settings.rowGapMm);
```

Round reported test values to one decimal place to avoid floating-point noise.

- [ ] **Step 4: Run GREEN for settings/geometry.**

```bash
node --test tests/label-print-core.test.js
```

Expected: geometry/pagination tests PASS.

- [ ] **Step 5: Add failing QR validation and print-type tests.**

Test all required cases:

```javascript
// exactly one active row + valid key + exact URL => printable
// no active row => 활성 QR 없음
// two active rows => 활성 QR 중복
// stopped-only rows => 활성 QR 없음
// malformed key => QR 접근키 형식 오류
// active lookupUrl != baseUrl?k=key => QR URL 불일치
// master QR조회URL != active lookupUrl => 마스터 QR URL 불일치
// asset 사용여부 != 사용 => 사용 중지 비품
// blank New 비품번호 => 비품번호 없음
// blank 품명 => 품명 없음
// issueStatus=미발급 and reprintRequired!=Y => 최초발급
// any already-printed/reissue state => 재출력 when explicitly selected
```

The returned shape is:

```javascript
{
  ok: true|false,
  reason: '',
  issue: activeIssueOrNull,
  printType: '최초발급'|'재출력'
}
```

- [ ] **Step 6: Run RED, then implement validation without QR creation.**

Run:

```bash
node --test tests/label-print-core.test.js
```

Expected: FAIL on the new validation assertions.

Implementation may duplicate the 32-character URL-safe regex locally. It must not call mutable QR issuance code.

- [ ] **Step 7: Add failing sort, batch-ID, and completion-patch tests.**

Sorting test input must prove:

```text
지하1층/창고1 order 1 before 지하1층/사진관 order 10
same location ordered by New asset number
unknown location sorted after mapped locations
```

Completion tests must prove:

```javascript
// first print: issueStatus -> 발급완료; reprintCount unchanged
// reprint: reprintCount +1; reprintRequired -> N; reprintReason preserved
// same lastPrintBatchId: duplicate=true and no field/count changes
```

Batch ID test:

```javascript
assert.equal(makeLabelPrintBatchId('20260826', 1), 'LABEL-20260826-001');
assert.equal(makeLabelPrintBatchId('20260826', 12), 'LABEL-20260826-012');
```

- [ ] **Step 8: Implement the minimum sort/batch/completion logic and run GREEN.**

```bash
node --test tests/label-print-core.test.js
npm test
```

Expected: all tests PASS.

- [ ] **Step 9: Commit.**

```bash
git add apps-script/LabelPrintCore.js tests/label-print-core.test.js
git commit -m "feat: add pure asset label print rules"
```

---

### Task 2: Add calibrated schema and the derived `라벨출력` work sheet

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `apps-script/SchemaSetup.gs`
- Modify: `tests/schema-setup.test.js`
- Create: `apps-script/LabelPrint.gs`
- Create: `tests/label-print-source.test.js`
- Modify: `tests/syntax.test.js`

**New sheet constant:**

```javascript
LABEL_PRINT: '라벨출력'
```

**Exact work-sheet columns, in row 4:**

```javascript
var LABEL_PRINT_HEADERS = [
  '출력선택', '출력구분', 'New 비품번호', '품명', '현재층', '현재공간명',
  '현재조사결과', 'QR상태', 'QR발급상태', '재출력필요', '최근조사일',
  '출력가능여부', '영구 시스템 ID', 'QR조회URL', '위치정렬순서'
];
```

#### Steps

- [ ] **Step 1: Extend failing schema tests first.**

Add assertions for:

```text
라벨버전 = LABEL-2026-01
가로보정mm = -1.8
세로보정mm = 2.7
3열가로보정mm = 0.3
LABEL_PRINT constant = 라벨출력
all 15 LABEL_PRINT_HEADERS
```

Also assert `RuntimeConfig.gs` does not add `라벨출력` to `ASSET_RUNTIME_REQUIRED_SHEETS`.

- [ ] **Step 2: Run RED.**

```bash
node --test tests/schema-setup.test.js
```

Expected: FAIL because the new setting/header/constant contracts are absent.

- [ ] **Step 3: Update schema defaults without overwriting live values.**

Change only missing-key defaults. `seedLabelSettings_()` already preserves existing keys, so the TEST sheet's calibrated values remain untouched.

Required defaults:

```javascript
['라벨버전', 'LABEL-2026-01'],
['가로보정mm', '-1.8'],
['세로보정mm', '2.7'],
['3열가로보정mm', '0.3']
```

Keep `열간격보정mm`, `행간격보정mm`, and `인쇄배율` as existing settings.

- [ ] **Step 4: Add `ensureLabelPrintWorkSheet_()` and call it from `installAssetQrSchema()`.**

The sheet layout is fixed:

```text
Row 1: title + TEST/PRODUCTION marker + web-panel link
Row 2: selected count / estimated page count / last refresh time
Row 3: short usage help
Row 4: A:O headers
Row 5+: derived rows
```

Implementation requirements:

```javascript
sheet.setFrozenRows(4);
sheet.hideColumns(13, 3); // M:O
```

Apply a checkbox validation only to column A rows whose `출력가능여부` is `출력가능`. Non-printable rows must have no selectable checkbox.

- [ ] **Step 5: Write failing source tests for `refreshLabelPrintSheet()`.**

Assert `LabelPrint.gs` exposes:

```javascript
refreshLabelPrintSheet()
getLabelPrintSheetStatus()
```

And reads all five authoritative sources:

```text
비품마스터
비품현재상태
QR발급관리
위치마스터
라벨설정
```

The source test must reject use of `ensureActiveQrIssueForAsset_` or `issueQrAccessKeys` inside `LabelPrint.gs`.

- [ ] **Step 6: Run RED.**

```bash
node --test tests/label-print-source.test.js
```

Expected: FAIL until `LabelPrint.gs` implements the required entry points.

- [ ] **Step 7: Implement work-sheet refresh.**

Use dedicated readers, not values copied from the previous work sheet.

Rules:

```text
비품마스터.사용여부 != 사용 => omit from default work list
current state missing => fall back to master floor/space and treat latest inspection as 미조사
exactly one active QR => expose its status/URL
no or duplicate active QR => row remains visible but 출력가능여부 contains the failure reason
```

For mapped current locations, derive `위치정렬순서` from `위치마스터.모바일정렬순서`. Unknown locations get a large sentinel sort order and stay last.

`최근조사일` must use `Utilities.formatDate(date, 'Asia/Seoul', 'yyyy.MM.dd')`; empty latest judgment prints `미조사`.

- [ ] **Step 8: Refresh safely.**

`refreshLabelPrintSheet()` may clear/rewrite only the derived work area (row 4 onward plus work-sheet summary cells). It must never clear or rewrite source sheets.

After writing rows:

```text
sort by location/floor/space/New asset number for browse convenience
recreate work-sheet filter if necessary
clear all selection checkboxes
update selected/page summary to 0 / 0
```

- [ ] **Step 9: Add new files to syntax verification and run GREEN.**

Update `tests/syntax.test.js` to parse:

```text
apps-script/LabelPrintCore.js
apps-script/LabelPrint.gs
```

Run:

```bash
node --test tests/schema-setup.test.js tests/label-print-source.test.js tests/syntax.test.js
npm test
```

Expected: all PASS.

- [ ] **Step 10: Commit.**

```bash
git add apps-script/Code.gs apps-script/SchemaSetup.gs apps-script/LabelPrint.gs tests/schema-setup.test.js tests/label-print-source.test.js tests/syntax.test.js
git commit -m "feat: add label print work sheet"
```

---

### Task 3: Add sheet controls, filters, menu, and sidebar/web-panel fallback

**Files:**
- Modify: `apps-script/LabelPrint.gs`
- Create: `apps-script/LabelPrintPanel.html`
- Modify: `apps-script/Code.gs`
- Modify: `tests/label-print-source.test.js`
- Modify: `tests/syntax.test.js`

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

#### Steps

- [ ] **Step 1: Write failing control/menu tests.**

Assert source contains the five approved operations:

```text
목록 새로고침
현재 필터 전체선택
선택해제
재출력 대상 선택
선택 라벨 미리보기
```

Assert `installLabelPrintUi()` creates an installable open trigger for the configured spreadsheet rather than assuming the script is container-bound.

Assert the work sheet also receives a direct web-panel hyperlink as a fallback.

- [ ] **Step 2: Run RED.**

```bash
node --test tests/label-print-source.test.js
```

Expected: FAIL on missing panel/menu behavior.

- [ ] **Step 3: Implement filter semantics.**

Panel filter request shape:

```javascript
{
  search: '',
  floor: '',
  spaceName: '',
  outputState: ''
}
```

Search matches `New 비품번호`, `품명`, or `영구 시스템 ID`. Filter application may use row hiding. Before applying a new filter, show all data rows, then hide nonmatches.

`selectVisibleLabelPrintRows()` selects only rows that are both visible and `출력가능`.

`selectReprintLabelRows()` selects only visible rows where `출력구분=재출력`, `재출력필요=Y` or `QR발급상태=재발급필요`, and `출력가능여부=출력가능`.

- [ ] **Step 4: Implement `LabelPrintPanel.html`.**

Panel controls:

```text
검색
층
공간
출력상태
필터 적용
목록 새로고침
현재 필터 전체선택
선택해제
재출력 대상 선택
선택 라벨 미리보기
```

Display `선택 N개 · 예상 M페이지`, where pages are `Math.ceil(N / 24)`.

All calls use `google.script.run` with visible success/failure messages; never trust panel row data for preview generation.

- [ ] **Step 5: Implement menu/installable trigger plus web-panel route fallback.**

`installLabelPrintUi()` must:

```text
remove duplicate installable triggers for labelPrintOnOpen_
create one spreadsheet onOpen trigger targeting getSpreadsheet_().getId()
write the panel URL into the 라벨출력 top area
```

`labelPrintOnOpen_()` adds a `QR 라벨` menu whose primary item opens the sidebar. The direct `?view=label-panel` URL remains usable even if custom menu/UI behavior is unavailable.

- [ ] **Step 6: Parse panel client JavaScript in syntax tests.**

Extend `tests/syntax.test.js` to extract and parse inline scripts from `LabelPrintPanel.html`.

- [ ] **Step 7: Run GREEN and regression.**

```bash
node --test tests/label-print-source.test.js tests/syntax.test.js
npm test
```

Expected: all PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps-script/LabelPrint.gs apps-script/LabelPrintPanel.html apps-script/Code.gs tests/label-print-source.test.js tests/syntax.test.js
git commit -m "feat: add label print selection controls"
```

---

### Task 4: Build immutable preview sessions, routing, and 24-slot page models

**Files:**
- Modify: `apps-script/LabelPrint.gs`
- Modify: `apps-script/Code.gs`
- Create: `apps-script/LabelPrintPreview.html` (initial shell)
- Modify: `tests/label-print-source.test.js`
- Modify: `tests/syntax.test.js`

**Server interfaces:**

```javascript
createSelectedLabelPrintPreview()
prepareLabelPrintPreview(request)
getLabelPrintPreviewModel(token)
makeLabelPrintPreviewToken_()
makeNextLabelPrintBatchId_()
storeLabelPrintPreviewSnapshot_(snapshot)
loadLabelPrintPreviewSnapshot_(token)
validateLabelPrintPreviewSnapshot_(snapshot)
```

#### Steps

- [ ] **Step 1: Write failing preview-session tests first.**

Source tests must require:

```text
CacheService.getScriptCache()
PropertiesService.getScriptProperties()
LABEL-YYYYMMDD-NNN batch IDs
6-hour preview TTL (21600 seconds)
opaque preview token
whole-preview validation failure when any selected item is invalid
```

Also assert the preview code does not issue QR keys.

- [ ] **Step 2: Run RED.**

```bash
node --test tests/label-print-source.test.js
```

Expected: FAIL on preview-session contracts.

- [ ] **Step 3: Implement authoritative preview preparation.**

`createSelectedLabelPrintPreview()` reads only checked system IDs from `라벨출력`, then calls `prepareLabelPrintPreview({systemIds})`.

`prepareLabelPrintPreview()` must re-read source sheets and, for every requested ID:

```text
find exactly one master row
confirm 사용여부=사용
read current state, falling back to master location only when state is absent
find exactly one active QR issue
validate key and exact lookup URL
validate master QR URL matches the active issue URL
derive current location sort order
format latest judgment date or 미조사
classify 최초발급/재출력
```

Collect every error. If any exist, throw one aggregated message containing requested count, invalid count, system ID, New asset number when known, and reason. Do not create a snapshot.

- [ ] **Step 4: Generate one batch ID and opaque token after successful validation only.**

Use a Script Lock for the daily sequence property:

```text
ASSET_LABEL_BATCH_SEQUENCE_20260826 = 1, 2, 3...
```

Batch ID:

```text
LABEL-20260826-001
```

Token format must use compact UUID material and be validated against a strict URL-safe regex before cache lookup.

- [ ] **Step 5: Store preview snapshots in cache chunks.**

Do not put the full 842-item snapshot into one CacheService item. Store:

```text
LPV:<token>:manifest
LPV:<token>:page:1
LPV:<token>:page:2
...
```

Manifest contains:

```javascript
{
  token,
  batchId,
  environment,
  createdAt,
  pageCount,
  itemCount,
  labelVersion
}
```

Each page cache entry contains at most 24 immutable item snapshots:

```javascript
{
  systemId,
  accessKey,
  qrUrl,
  newAssetNo,
  name,
  currentFloor,
  currentSpaceName,
  currentResult,
  inspectionDate,
  printType,
  locationSortOrder
}
```

TTL: `21600` seconds. The snapshot records exactly what the operator is about to print.

- [ ] **Step 6: Revalidate active QR identity when loading a snapshot.**

`getLabelPrintPreviewModel(token)` reassembles cached pages, then checks that each current active QR access key and URL still match the cached snapshot. If a key was stopped/reissued after preview creation, abort and require a new preview.

Do not replace the cached label text/date with newer values during reload; the snapshot remains immutable for audit consistency.

- [ ] **Step 7: Return a complete 24-slot model.**

Sort before snapshot creation using `sortLabelPrintItems()`. Paginate to 24 slots. For every non-empty slot, attach the result of `calculateLabelSlotPosition(settings, slotIndex)`.

Response includes:

```javascript
{
  batchId,
  itemCount,
  pageCount,
  labelType,
  labelVersion,
  environment,
  isProduction,
  settings,
  pages
}
```

- [ ] **Step 8: Route web app views without breaking the survey app.**

Change `doGet()` to `doGet(e)` with exact routing:

```text
?view=label-panel -> LabelPrintPanel
?view=label-print&token=<token> -> LabelPrintPreview
anything else -> existing Index survey app
```

Add `includeHtml_(filename)` for local vendor/template includes. Preserve the existing survey app title/meta behavior on the default route.

- [ ] **Step 9: Run GREEN.**

```bash
node --test tests/label-print-core.test.js tests/label-print-source.test.js tests/syntax.test.js
npm test
```

Expected: all PASS and existing survey route tests remain green.

- [ ] **Step 10: Commit.**

```bash
git add apps-script/LabelPrint.gs apps-script/Code.gs apps-script/LabelPrintPreview.html tests/label-print-source.test.js tests/syntax.test.js
git commit -m "feat: add immutable label print previews"
```

---

### Task 5: Render local SVG QR codes and the exact approved Formtec print layout

**Files:**
- Create: `apps-script/QrVendor.html`
- Complete: `apps-script/LabelPrintPreview.html`
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `tests/label-print-source.test.js`
- Modify: `tests/syntax.test.js`

#### Steps

- [ ] **Step 1: Write failing print-layout/security tests.**

Require all of the following:

```text
@page { size: A4; margin: 0; }
210mm × 297mm page surface
window.print()
control bar hidden under @media print
no outer black label border
QR size supplied as 20mm setting
조사 일자 below QR
관리책임자 above 정 김은영 · 부 김정훈
TEST PILOT rendered only when !isProduction
nominal asset number and item name font size 9.3pt
local QR vendor included through HtmlService include
no external QR HTTP endpoint
no UrlFetchApp in label-print source
```

Test that `QrVendor.html` contains no `<script src="http...">` dependency.

- [ ] **Step 2: Run RED.**

```bash
node --test tests/label-print-source.test.js
```

Expected: FAIL until vendor and completed preview exist.

- [ ] **Step 3: Vendor `qrcode-generator` 1.4.4 locally.**

Use the browser distribution from package/repository `kazuhikoarase/qrcode-generator`, version `1.4.4`, MIT license. Copy the browser QR encoder source into `apps-script/QrVendor.html`; do not load it from a CDN at runtime.

Create `THIRD_PARTY_NOTICES.md` with:

```text
qrcode-generator 1.4.4
Copyright (c) Kazuhiko Arase
License: MIT
Source: https://github.com/kazuhikoarase/qrcode-generator
Used locally for browser-side SVG QR generation.
```

Include the full upstream MIT license text in the notice file.

- [ ] **Step 4: Implement preview loading and SVG QR rendering.**

On page load:

```javascript
google.script.run
  .withSuccessHandler(renderPreview)
  .withFailureHandler(showError)
  .getLabelPrintPreviewModel(PREVIEW_TOKEN);
```

For each item, create a QR object locally, add only `item.qrUrl`, make it, and insert its SVG into the QR container. No QR payload is sent to a third party.

- [ ] **Step 5: Implement exact A4/label positioning from the server model.**

Each page:

```css
.print-page {
  position: relative;
  width: 210mm;
  height: 297mm;
  page-break-after: always;
  overflow: hidden;
}
```

Each label gets inline millimeter position values from `slot.xMm` and `slot.topMm`; dimensions come from normalized settings. Do not apply an outer border.

Use the approved internal layout:

```text
left: QR 20mm
below QR: 조사 일자 + yyyy.MM.dd or 미조사, centered
right top: 강서청소년회관 물품조사
right: New asset number 9.3pt bold
right: item name 9.3pt bold nominal
light separator
관리책임자
정 김은영 · 부 김정훈 ~9pt bold
bottom-right TEST PILOT only in TEST
```

- [ ] **Step 6: Add deterministic long-name fitting.**

After DOM render, measure the item-name element. Start at `9.3pt` and decrement by `0.1pt` until it fits the approved text box or reaches `7.2pt`. Do not shrink normal names such as `문서 세단기`, `하비체어`, or `사각테이블`.

- [ ] **Step 7: Implement print controls.**

Top control bar displays:

```text
선택 N개 · M페이지 · Formtec LS3106
배율 100% · 실제 크기 · 여백 없음 · 머리글/바닥글 끄기
```

Buttons:

```text
인쇄 / PDF 저장
출력 완료 반영
닫기
```

`인쇄 / PDF 저장` only calls `window.print()`.

- [ ] **Step 8: Parse preview inline JavaScript and run GREEN.**

Extend `tests/syntax.test.js` to parse inline scripts from both new HTML files, excluding the vendored library from application-script style assertions but still ensuring the final HTML file exists and contains local QR code.

Run:

```bash
node --test tests/label-print-source.test.js tests/syntax.test.js
npm test
```

Expected: all PASS.

- [ ] **Step 9: Commit.**

```bash
git add apps-script/QrVendor.html apps-script/LabelPrintPreview.html THIRD_PARTY_NOTICES.md tests/label-print-source.test.js tests/syntax.test.js
git commit -m "feat: render calibrated Formtec label previews"
```

---

### Task 6: Record confirmed output idempotently and recover from partial writes

**Files:**
- Modify: `apps-script/LabelPrint.gs`
- Modify: `tests/label-print-source.test.js`
- Extend: `tests/label-print-core.test.js`

**Server interface:**

```javascript
completeLabelPrintBatch(request)
```

Client request shape:

```javascript
{ token: '<opaque preview token>' }
```

The client does not send system IDs, QR URLs, inspection dates, managers, or batch ID; the server loads those from the cached immutable snapshot.

#### Steps

- [ ] **Step 1: Write failing completion integration/source tests.**

Require:

```text
Script Lock around completion
snapshot loaded from token
current runtime environment equals snapshot environment
current active key/URL equals cached accessKey/qrUrl before each write
same lastPrintBatchId => skip without count increment
row-by-row try/catch with successes/failures returned
cache retained long enough to retry failed rows
```

- [ ] **Step 2: Run RED.**

```bash
node --test tests/label-print-core.test.js tests/label-print-source.test.js
```

Expected: FAIL on missing completion behavior.

- [ ] **Step 3: Implement completion using cached print facts.**

For each cached item, locate the current active issue row. If it no longer matches cached `accessKey` and `qrUrl`, report that asset as failed and do not alter it.

Otherwise call `buildLabelPrintCompletionPatch(issue, context)` with:

```javascript
{
  batchId: snapshot.batchId,
  printType: item.printType,
  labelType: settings.labelType,
  labelVersion: snapshot.labelVersion,
  primaryManager: settings.primaryManager,
  secondaryManager: settings.secondaryManager,
  managerVersion: settings.managerVersion,
  inspectionDate: item.inspectionDate,
  printedAt: new Date()
}
```

Persist these fields:

```text
QR발급상태 = 발급완료
라벨유형 = FORMTEC_LS3106
라벨버전 = LABEL-2026-01
인쇄책임자 정 = 김은영
인쇄책임자 부 = 김정훈
책임자버전 = RESP-2026-01
라벨기준조사일 = exact date/text printed in this snapshot
최종출력일시 = current completion time
최종출력배치ID = snapshot batch ID
```

For `재출력` only:

```text
재출력횟수 += 1
재출력필요여부 = N
재출력사유 = preserve existing string
```

- [ ] **Step 4: Preserve idempotency and partial recovery.**

If current issue already has `최종출력배치ID === snapshot.batchId`:

```text
result = skipped
no timestamp rewrite required
no reprint count increment
```

Catch errors per asset so earlier successful rows remain recoverable. A second call with the same token must skip successful rows and retry only failed rows.

Return:

```javascript
{
  batchId,
  requested,
  updated,
  skipped,
  failed,
  results: [{ systemId, status: 'updated'|'skipped'|'failed', error: '' }]
}
```

- [ ] **Step 5: Wire `출력 완료 반영` in preview UI.**

Before calling server, show a confirmation that says the operator should click only after physical output is correct. Disable the button while running. After full success, display the batch ID and updated/skipped counts. If failures exist, keep the token/page open and show exactly which assets can be retried.

- [ ] **Step 6: Run GREEN and full regression.**

```bash
node --test tests/label-print-core.test.js tests/label-print-source.test.js
npm test
```

Expected: all PASS, including existing QR issuance/current-state/survey tests.

- [ ] **Step 7: Commit.**

```bash
git add apps-script/LabelPrint.gs apps-script/LabelPrintPreview.html tests/label-print-core.test.js tests/label-print-source.test.js
git commit -m "feat: record label print batches idempotently"
```

---

### Task 7: Document deployment, TEST mapping, and operator workflow

**Files:**
- Modify: `apps-script/README.md`
- Modify: `tests/label-print-source.test.js`

#### Steps

- [ ] **Step 1: Write failing documentation-contract tests.**

Require README to contain exact Apps Script mappings:

```text
apps-script/LabelPrintCore.js -> LabelPrintCore.gs
apps-script/LabelPrint.gs -> LabelPrint.gs
apps-script/LabelPrintPanel.html -> LabelPrintPanel.html
apps-script/LabelPrintPreview.html -> LabelPrintPreview.html
apps-script/QrVendor.html -> QrVendor.html
```

Require TEST setup order markers:

```text
TEST 프로젝트인지 확인
installAssetQrSchema()
refreshLabelPrintSheet()
installLabelPrintUi()
기존 웹 앱 배포를 새 버전으로 업데이트
5개 파일럿 선택
인쇄 / PDF 저장
출력 완료 반영
auditQrIssues()
```

- [ ] **Step 2: Run RED.**

```bash
node --test tests/label-print-source.test.js
```

Expected: FAIL until README has the new operator/deployment instructions.

- [ ] **Step 3: Update README.**

Document:

```text
라벨출력 is derived and safe to refresh
only exactly-one-active-QR assets are printable
printing does not issue QR keys
latest judgment date is printed; no history means 미조사
TEST PILOT vs PRODUCTION behavior
100% / actual size / no margins / headers-footers off
completion is explicit and idempotent
preview tokens expire after six hours
```

State that code changes update the existing mutable Apps Script deployment; do not create a new deployment URL solely for this feature.

- [ ] **Step 4: Run GREEN and full suite.**

```bash
node --test tests/label-print-source.test.js
npm test
```

Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps-script/README.md tests/label-print-source.test.js
git commit -m "docs: add label print deployment workflow"
```

---

### Task 8: Apply to TEST, run the five-asset physical pilot, and prepare the PR

**Repository state:** `feature/asset-label-print-pilot`

**TEST spreadsheet:** `1jphVHn1W4DpBkeKwi5mZx5rpuMHkQ9oYE4rEI9au3oQ`

**Approved five assets:**

```text
GSYC-000340 / 2019-F2-10 / 문서 세단기
GSYC-000820 / 2022-O-54 / 하비체어
GSYC-000817 / 2022-O-51 / 하비체어
GSYC-000815 / 2018-O-130 / 야외용 원목테이블
GSYC-000003 / 2018-B-113 / 사각테이블
```

#### Steps

- [ ] **Step 1: Verify repository baseline before deployment.**

```bash
npm test
```

Expected: all tests PASS. Record the exact pass count in the eventual PR body.

- [ ] **Step 2: Copy the feature files into the TEST Apps Script project.**

Use these mappings:

```text
LabelPrintCore.js -> LabelPrintCore.gs
LabelPrint.gs -> LabelPrint.gs
LabelPrintPanel.html -> LabelPrintPanel.html
LabelPrintPreview.html -> LabelPrintPreview.html
QrVendor.html -> QrVendor.html
Code.gs -> Code.gs
SchemaSetup.gs -> SchemaSetup.gs
```

Keep existing TEST runtime Script Properties unchanged.

- [ ] **Step 3: Run one-time TEST setup.**

In Apps Script editor, execute in this order:

```javascript
getRuntimeEnvironmentStatus();
installAssetQrSchema();
refreshLabelPrintSheet();
installLabelPrintUi();
```

Expected runtime:

```text
environment = TEST
projectRole = TEST
spreadsheet = 강서청소년회관 QR 비품관리 대장_QR개발 테스트 사본
```

Expected label settings after installer:

```text
가로보정mm -1.8
세로보정mm 2.7
3열가로보정mm 0.3
라벨버전 LABEL-2026-01
```

- [ ] **Step 4: Update the existing TEST mutable web-app deployment to a new version.**

Do not create a different permanent deployment URL for this feature. Confirm the default survey route still loads after the update.

- [ ] **Step 5: Validate `라벨출력` work sheet.**

Expected:

```text
A:O exact columns
M:O hidden
only printable rows have checkboxes
five currently-issued pilot assets are printable
unissued assets remain visible with an explicit output-unavailable reason
selection summary and page count work
```

- [ ] **Step 6: Generate the exact five-asset preview.**

Select only the approved five IDs. Expected:

```text
5 selected
1 page
sort order follows location/floor/space/New asset number
all five current active QR URLs are used
GSYC-000003 uses its new active key, never the stopped key
TEST PILOT visible
```

Scan all five QR codes before printing; each must open the correct read-only detail page.

- [ ] **Step 7: Perform one Formtec LS3106 physical print.**

Browser print settings:

```text
A4
100% / actual size
margins none
headers/footers off
fit-to-page off
```

Check first/second/third column positions and verify the third column uses the final +0.3mm correction. No outer black borders should appear.

- [ ] **Step 8: Test explicit completion and idempotency.**

After physical output is confirmed, press `출력 완료 반영` once. Record the returned batch ID.

Press it again with the same preview token. Expected:

```text
updated = 0 for already-completed rows
skipped = previously completed rows
no duplicate reprint-count increment
same batch ID retained
```

- [ ] **Step 9: Audit QR integrity.**

Run:

```javascript
auditQrIssues();
```

Expected:

```text
ok = true
no duplicate active IDs
no duplicate keys
no invalid keys
no missing master IDs
no master URL mismatches
```

- [ ] **Step 10: Final repository verification.**

```bash
npm test
git status --short
git log --oneline --decorate -8
```

Expected:

```text
all tests PASS
working tree clean
feature commits present in task order
```

- [ ] **Step 11: Open a draft PR to `feature/asset-current-state`.**

PR title:

```text
feat: Google Sheets QR 라벨 자동출력
```

PR body must include:

```text
approved LS3106 calibration
new 라벨출력 workflow
exact five-asset TEST results
physical print result
QR scan result
completion/idempotency result
auditQrIssues result
full npm test pass count
remaining risk: browser/printer driver must remain at actual-size 100%
remaining rollout gate: 24-asset field pilot before 842-wide production output
```

Do not merge until TEST physical verification and CI are both green.

---

## Final Acceptance Checklist

Implementation is complete only when every item below is true:

- `라벨출력` exists as a derived work sheet with exact A:O columns.
- Checkbox selection cannot select an output-invalid row.
- Search/floor/space/output-state filtering works.
- Current visible rows and flagged reprint rows can be selected in bulk.
- Selected IDs are re-read from authoritative source sheets before preview.
- Missing, stopped, duplicate, malformed, or mismatched active QR data aborts the whole preview.
- Label printing never creates a QR key.
- Sort order is visibly `층 → 공간 → 비품번호` with `위치마스터.모바일정렬순서` controlling mapped spaces.
- 1–24, 25, and 49 item sets render 1, 2, and 3 pages.
- LS3106 coordinates resolve to X `4.7/71.2/138.0mm` and top `9.8mm`, including third-column +0.3mm.
- All 24 slots use 64 × 33.9mm geometry with no outer black border.
- QR is 20mm and generated locally as SVG.
- Item name and asset number share the nominal 9.3pt size; long item names shrink only as needed.
- `관리책임자` and `정 김은영 · 부 김정훈` print in the approved arrangement.
- `조사 일자` is centered under QR and uses latest judgment date or `미조사`.
- TEST shows `TEST PILOT`; PRODUCTION does not.
- Browser print uses A4/100%/no-margin CSS and supports print or PDF save through `window.print()`.
- Opening preview or print dialog does not alter `QR발급관리`.
- Explicit completion writes the exact printed label version/managers/date/batch.
- Reprint completion increments count once, clears reprint-required, and preserves reason.
- Repeating the same batch is idempotent.
- Partial row-write failures can be retried with the same token without duplicating successful writes.
- Existing survey/current-state/QR-detail tests remain green.
- Five-asset TEST physical pilot and QR scans pass before PR readiness.
- No PRODUCTION rollout occurs until the later 24-asset field pilot passes.
