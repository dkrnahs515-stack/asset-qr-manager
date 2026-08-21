# Asset A4 QR Label Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print regulation-compliant 64×34mm asset labels with QR, common managers, New asset number, item name, and inspection date on Formtec LS-3106 or A4 full-sheet sticker paper, while recording every completed print batch.

**Architecture:** Add an administrator label route to the existing Apps Script deployment. Server APIs filter assets, ensure active QR URLs, provide immutable label view models, and record confirmed output batches in `QR발급관리`; a browser print view renders exact A4 geometry with CSS millimeter units. A vendored, pinned MIT QR encoder generates scalable SVG locally so print output does not depend on a third-party network service.

**Tech Stack:** Google Apps Script V8, HtmlService, vanilla HTML/CSS/JavaScript, vendored `qrcode-generator` 2.0.4, Node.js 20 `node:test`, browser print CSS

**Spec:** `docs/superpowers/specs/2026-08-21-asset-qr-detail-label-design.md`

## Global Constraints

- This plan starts after the current-state plan and the five-asset QR-detail pilot have passed.
- Default sheet profile is Formtec LS-3106: A4, 64×34mm nominal label, 24 labels, 3 columns × 8 rows.
- Default print geometry is left margin 6.5mm, top margin 12.5mm, label width 64mm, label print height/pitch 33.9mm, horizontal pitch 66.5mm, and 2.5mm column gap.
- Print CSS uses `@page { size: A4; margin: 0; }`; operators print at 100%, disable browser headers/footers, and do not use fit-to-page.
- Every physical label displays `강서청소년회관 물품조사`, `정: 김은영`, `부: 김정훈`, item name, New asset number, label inspection date, QR, and `최신 위치·조사이력 확인`.
- Manager names are read-only in the print UI and come from `라벨설정` to prevent typing errors.
- Label inspection date is a print-batch date; later regular or ad-hoc inspections update QR detail history without forcing full label replacement.
- New asset number never wraps. Item name is at most two lines and uses deterministic font-size classes.
- QR visual area is 20mm by default, including quiet zone, and remains configurable.
- Ordinary reprints reuse the active QR key and URL.
- Closing the browser print dialog does not count as a completed print. Only explicit `출력 완료 기록` updates `QR발급관리`.
- The first full issue of 842 labels waits until a one-page Formtec pilot and a 10–20 asset field pilot pass.
- Third-party QR source and MIT license notice are committed to the repository.

---

## File Structure

- Create: `apps-script/LabelCore.js` — pure filters, view models, pagination, type sizing, profile geometry, and batch IDs.
- Create: `apps-script/LabelAdmin.gs` — settings, candidate queries, preview preparation, manager-version mismatch, and print completion writes.
- Create: `apps-script/LabelPrint.html` — administrator print shell.
- Create: `apps-script/LabelStyles.html` — admin screen and exact print CSS.
- Create: `apps-script/LabelClient.html` — filters, preview, QR SVG creation, printing, and completion confirmation.
- Create: `apps-script/QrVendor.html` — vendored `qrcode-generator` 2.0.4 browser build wrapped in `<script>`.
- Create: `THIRD_PARTY_NOTICES.md` — package name, version, source repository, and MIT notice.
- Create: `tests/label-core.test.js` — layout/filter/view-model tests.
- Create: `tests/label-source.test.js` — routing, print safety, and vendor contracts.
- Modify: `apps-script/Code.gs` — route `?page=labels` and add shared HTML include helper.
- Modify: `apps-script/QrAdmin.gs` — expose active-key reuse helper to preview preparation.
- Modify: `apps-script/SchemaSetup.gs` — ensure manager-version change can mark reprint rows and preserve exact print defaults.
- Modify: `tests/syntax.test.js` — parse new files and inline client.
- Modify: `README.md` — label route, file mapping, print settings, pilot, and 842-label rollout.

---

### Task 1: Define exact label profiles, pagination, and view models

**Files:**
- Create: `apps-script/LabelCore.js`
- Create: `tests/label-core.test.js`

**Interfaces:**
- Consumes: master asset, active QR issue, label settings, inspection date, filter input, and start slot.
- Produces: `LABEL_PROFILES`, `normalizeLabelSettings(raw)`, `buildLabelViewModel(asset, qrIssue, settings, inspectionDate)`, `paginateLabels(items, startSlot)`, `classifyItemName(name)`, `filterLabelAssets(items, filter)`, and `makePrintBatchId(now, suffix)`.

- [ ] **Step 1: Write failing profile and pagination tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LABEL_PROFILES,
  paginateLabels,
  classifyItemName,
  makePrintBatchId
} = require('../apps-script/LabelCore.js');

test('Formtec LS-3106 profile uses exact 24-slot A4 geometry', () => {
  const p = LABEL_PROFILES.FORMTEC_LS3106;
  assert.deepEqual({
    columns: p.columns, rows: p.rows, slots: p.slots,
    labelWidthMm: p.labelWidthMm, labelHeightMm: p.labelHeightMm,
    leftMarginMm: p.leftMarginMm, topMarginMm: p.topMarginMm,
    columnGapMm: p.columnGapMm, rowGapMm: p.rowGapMm
  }, {
    columns: 3, rows: 8, slots: 24,
    labelWidthMm: 64, labelHeightMm: 33.9,
    leftMarginMm: 6.5, topMarginMm: 12.5,
    columnGapMm: 2.5, rowGapMm: 0
  });
});

test('842 labels paginate to 36 pages from the first slot', () => {
  const pages = paginateLabels(Array.from({ length: 842 }, (_, i) => ({ id: i + 1 })), 1);
  assert.equal(pages.length, 36);
  assert.equal(pages[35].filter(Boolean).length, 2);
});

test('start slot leaves exact empty positions only on the first page', () => {
  const pages = paginateLabels(Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })), 6);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].slice(0, 5).every(v => v === null), true);
  assert.equal(pages[0].filter(Boolean).length, 19);
  assert.equal(pages[1].filter(Boolean).length, 1);
});

test('item names use deterministic two-line sizing classes', () => {
  assert.equal(classifyItemName('컴퓨터 모니터'), 'name-normal');
  assert.equal(classifyItemName('이동식 대형 컴퓨터 모니터 거치대'), 'name-small');
  assert.equal(classifyItemName('청소년활동실 이동형 멀티미디어 컴퓨터 모니터 전용 거치대'), 'name-xsmall');
});

test('print batch ID is sortable and unique-suffix based', () => {
  assert.equal(makePrintBatchId(new Date('2026-08-21T01:02:03Z'), 'A7F2'), 'LBL-20260821-100203-A7F2');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/label-core.test.js`

Expected: FAIL because `LabelCore.js` does not exist.

- [ ] **Step 3: Implement the two print profiles**

```javascript
var LABEL_PROFILES = {
  FORMTEC_LS3106: {
    code: 'FORMTEC_LS3106', columns: 3, rows: 8, slots: 24,
    pageWidthMm: 210, pageHeightMm: 297,
    labelWidthMm: 64, labelHeightMm: 33.9,
    leftMarginMm: 6.5, topMarginMm: 12.5,
    columnGapMm: 2.5, rowGapMm: 0,
    cutLines: false
  },
  A4_FREECUT_64X34: {
    code: 'A4_FREECUT_64X34', columns: 3, rows: 8, slots: 24,
    pageWidthMm: 210, pageHeightMm: 297,
    labelWidthMm: 64, labelHeightMm: 33.9,
    leftMarginMm: 6.5, topMarginMm: 12.5,
    columnGapMm: 2.5, rowGapMm: 0,
    cutLines: true
  }
};
```

- [ ] **Step 4: Implement exact pagination and view models**

```javascript
function paginateLabels(items, startSlot) {
  var normalizedStart = Math.min(24, Math.max(1, Number(startSlot || 1)));
  var stream = Array(normalizedStart - 1).fill(null).concat(items || []);
  var pages = [];
  for (var i = 0; i < stream.length; i += 24) {
    var page = stream.slice(i, i + 24);
    while (page.length < 24) page.push(null);
    pages.push(page);
  }
  return pages.length ? pages : [Array(24).fill(null)];
}

function buildLabelViewModel(asset, qrIssue, settings, inspectionDate) {
  if (!qrIssue || qrIssue.accessKeyStatus !== '사용' || !qrIssue.lookupUrl) {
    throw new Error('사용 중인 QR 조회URL이 없습니다: ' + asset.systemId);
  }
  return {
    systemId: asset.systemId,
    title: settings.labelTitle,
    primaryManager: settings.primaryManager,
    secondaryManager: settings.secondaryManager,
    itemName: asset.name || '품명 미등록',
    itemNameClass: classifyItemName(asset.name || ''),
    newAssetNo: asset.newAssetNo || '번호 미등록',
    inspectionDate: inspectionDate,
    qrUrl: qrIssue.lookupUrl,
    qrCaption: settings.qrCaption
  };
}
```

- [ ] **Step 5: Implement candidate filters**

Support exact fields:

```javascript
{
  floor: '',
  locationCode: '',
  search: '',
  onlyUnissued: false,
  onlyReprintRequired: false,
  onlyManagerVersionMismatch: false,
  selectedSystemIds: []
}
```

Search matches New asset number, item name, or system ID. Selected IDs override floor/location but still require registered master assets.

- [ ] **Step 6: Export and run tests**

Run: `node --test tests/label-core.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps-script/LabelCore.js tests/label-core.test.js
git commit -m "feat: define exact A4 asset label layout"
```

---

### Task 2: Add label administrator APIs and manager-version reprint rules

**Files:**
- Create: `apps-script/LabelAdmin.gs`
- Create: `tests/label-source.test.js`
- Modify: `apps-script/QrAdmin.gs`
- Modify: `apps-script/SchemaSetup.gs`
- Modify: `tests/syntax.test.js`

**Interfaces:**
- Consumes: master assets, active QR issue rows, label settings, QR active-key helper, and filter input.
- Produces: `getLabelPrintBootstrap()`, `searchLabelAssets(filter)`, `prepareLabelPreview(request)`, `recordLabelPrintBatch(request)`, and `markManagerVersionMismatchForReprint()`.

- [ ] **Step 1: Write failing API/source tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('apps-script/LabelAdmin.gs', 'utf8');

test('label admin exposes preview, completion, and manager mismatch APIs', () => {
  assert.match(source, /function getLabelPrintBootstrap\(\)/);
  assert.match(source, /function prepareLabelPreview\(request\)/);
  assert.match(source, /function recordLabelPrintBatch\(request\)/);
  assert.match(source, /function markManagerVersionMismatchForReprint\(\)/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/label-source.test.js`

Expected: FAIL because `LabelAdmin.gs` does not exist.

- [ ] **Step 3: Implement bootstrap and candidate lookup**

```javascript
function getLabelPrintBootstrap() {
  var settings = readAllLabelSettings_();
  return {
    settings: settings,
    profiles: LABEL_PROFILES,
    floors: getBootstrapData().floors,
    defaults: {
      profile: settings.defaultProfile,
      inspectionDate: settings.defaultInspectionDate,
      startSlot: 1,
      qrSizeMm: Number(settings.qrSizeMm || 20)
    }
  };
}
```

`searchLabelAssets(filter)` reads master assets and active QR issue rows, applies `filterLabelAssets`, and returns lightweight rows with system ID, New number, name, floor, space, issue status, reprint status, and manager version.

- [ ] **Step 4: Implement preview preparation with active-key reuse**

```javascript
function prepareLabelPreview(request) {
  request = request || {};
  var systemIds = Array.from(new Set((request.systemIds || []).map(String)));
  if (!systemIds.length) throw new Error('출력할 비품을 선택하세요.');
  var settings = readAllLabelSettings_();
  if (!settings.detailDeploymentUrl) throw new Error('라벨설정의 상세조회배포URL을 먼저 입력하세요.');
  var inspectionDate = normalizeLabelInspectionDate_(request.inspectionDate || settings.defaultInspectionDate);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var items = systemIds.map(function (systemId) {
      var asset = readMasterAssetBySystemId_(getSpreadsheet_(), systemId);
      if (!asset) throw new Error('비품마스터 누락: ' + systemId);
      var issue = ensureActiveQrIssueForAsset_(asset, settings.detailDeploymentUrl);
      updateMasterQrUrl_(systemId, issue.lookupUrl);
      return buildLabelViewModel(asset, issue, settings, inspectionDate);
    });
    return {
      items: items,
      pages: paginateLabels(items, request.startSlot),
      profile: resolveLabelProfile_(request.profile || settings.defaultProfile),
      inspectionDate: inspectionDate,
      settings: settings
    };
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 5: Implement manager-version mismatch marking**

Read current `책임자버전`, `관리책임자 정`, and `관리책임자 부`. For every active issue row where printed manager version/names differ and `최종출력일시` exists, set:

```text
재출력필요여부=Y
재출력사유=관리책임자 변경
```

Do not alter QR keys or URLs.

- [ ] **Step 6: Implement completed print recording**

```javascript
function recordLabelPrintBatch(request) {
  request = request || {};
  assertText_(request.batchId, '출력 배치ID');
  var systemIds = Array.from(new Set((request.systemIds || []).map(String)));
  if (!systemIds.length) throw new Error('출력 완료를 기록할 비품이 없습니다.');
  var settings = readAllLabelSettings_();
  var printedAt = new Date();

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    systemIds.forEach(function (systemId) {
      var row = findActiveQrIssueRowBySystemId_(systemId);
      if (!row) throw new Error('사용 중인 QR 발급행이 없습니다: ' + systemId);
      updateQrIssuePrintFields_(row, {
        issueStatus: '발급완료',
        labelType: request.profile,
        labelVersion: request.labelVersion,
        primaryManager: settings.primaryManager,
        secondaryManager: settings.secondaryManager,
        managerVersion: settings.managerVersion,
        labelInspectionDate: request.inspectionDate,
        printedAt: printedAt,
        reprintRequired: 'N',
        reprintReason: '',
        batchId: request.batchId
      });
    });
    return { batchId: request.batchId, printedAt: printedAt.toISOString(), recorded: systemIds.length };
  } finally {
    lock.releaseLock();
  }
}
```

Increment `재출력횟수` only when `최종출력일시` was already populated before this batch.

- [ ] **Step 7: Run tests**

Run: `node --test tests/label-core.test.js tests/label-source.test.js tests/syntax.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps-script/LabelAdmin.gs apps-script/QrAdmin.gs apps-script/SchemaSetup.gs tests/label-source.test.js tests/syntax.test.js
git commit -m "feat: prepare and record asset label batches"
```

---

### Task 3: Add the administrator label route and selection UI

**Files:**
- Modify: `apps-script/Code.gs`
- Create: `apps-script/LabelPrint.html`
- Create: `apps-script/LabelClient.html`
- Modify: `tests/label-source.test.js`
- Modify: `tests/syntax.test.js`

**Interfaces:**
- Consumes: label admin APIs.
- Produces: `/exec?page=labels` administrator screen with filters, selection, print settings, preview, and explicit completion recording.

- [ ] **Step 1: Write failing routing and UI tests**

```javascript
test('main web app routes label administration without replacing mobile inspection', () => {
  const code = fs.readFileSync('apps-script/Code.gs', 'utf8');
  const html = fs.readFileSync('apps-script/LabelPrint.html', 'utf8');
  assert.match(code, /page === 'labels'/);
  assert.match(code, /createTemplateFromFile\('LabelPrint'\)/);
  for (const text of ['Formtec LS-3106', 'A4 통스티커', '출력 시작 칸', '시험인쇄', '출력 완료 기록']) {
    assert.match(html, new RegExp(text));
  }
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/label-source.test.js`

Expected: FAIL because route/UI are missing.

- [ ] **Step 3: Add routing while preserving the existing app**

```javascript
function doGet(e) {
  var page = String(e && e.parameter && e.parameter.page || 'inventory');
  var file = page === 'labels' ? 'LabelPrint' : 'Index';
  var title = page === 'labels' ? '강서청소년회관 QR 라벨 출력' : '강서청소년회관 비품 전수조사';
  return HtmlService.createTemplateFromFile(file)
    .evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function includeHtml_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
```

Ensure existing `doGet()` tests are updated rather than duplicated.

- [ ] **Step 4: Build selection and settings UI**

Include:

```html
<select id="profile">
  <option value="FORMTEC_LS3106">Formtec LS-3106</option>
  <option value="A4_FREECUT_64X34">A4 통스티커 64×34</option>
</select>
<input id="inspection-date" type="date">
<select id="start-slot"></select>
<input id="qr-size" type="number" min="18" max="23" step="0.5">
<input id="offset-x" type="number" step="0.1">
<input id="offset-y" type="number" step="0.1">
```

Filters: all, floor, space, search, unissued only, reprint required only, manager-version mismatch only, and selected assets. Show the common managers as read-only text.

- [ ] **Step 5: Implement preview flow**

Client steps:

1. Load `getLabelPrintBootstrap()`.
2. Query `searchLabelAssets(filter)`.
3. Maintain a selected-system-ID set.
4. Call `prepareLabelPreview` with profile, date, start slot, and selected IDs.
5. Render returned pages but do not mark output complete.

- [ ] **Step 6: Add explicit print and completion controls**

```html
<button id="test-print">일반 A4 시험인쇄</button>
<button id="print-labels">라벨 인쇄</button>
<button id="record-complete" disabled>출력 완료 기록</button>
```

Enable `출력 완료 기록` only after the user presses a print button. It submits the exact preview system IDs, batch ID, profile, label version, and inspection date. A confirmation dialog states that it records physical output and cannot infer printer success automatically.

- [ ] **Step 7: Run tests**

Run: `node --test tests/label-source.test.js tests/syntax.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps-script/Code.gs apps-script/LabelPrint.html apps-script/LabelClient.html tests/label-source.test.js tests/syntax.test.js
git commit -m "feat: add administrator A4 label workflow"
```

---

### Task 4: Vendor the QR encoder and render deterministic scalable SVG

**Files:**
- Create: `apps-script/QrVendor.html`
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `apps-script/LabelPrint.html`
- Modify: `apps-script/LabelClient.html`
- Modify: `tests/label-source.test.js`

**Interfaces:**
- Consumes: label QR URLs.
- Produces: `renderQrSvg(container, url, sizeMm)` using vendored `qrcode-generator` 2.0.4, error correction `M`, automatic type number, scalable SVG, and four-module quiet zone.

- [ ] **Step 1: Write failing vendor/license/render tests**

```javascript
test('QR encoder is vendored, pinned, licensed, and used without a network URL', () => {
  const vendor = fs.readFileSync('apps-script/QrVendor.html', 'utf8');
  const client = fs.readFileSync('apps-script/LabelClient.html', 'utf8');
  const notices = fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
  assert.match(vendor, /qrcode-generator/);
  assert.match(notices, /2\.0\.4/);
  assert.match(notices, /MIT/);
  assert.match(client, /qrcode\(0, 'M'\)/);
  assert.doesNotMatch(vendor + client, /cdnjs|jsdelivr|unpkg/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/label-source.test.js`

Expected: FAIL because vendor and notice files are missing.

- [ ] **Step 3: Vendor the pinned browser build**

Copy the official `qrcode-generator` 2.0.4 `dist/qrcode.js` content into:

```html
<script>
/* qrcode-generator 2.0.4 — MIT — Copyright (c) 2009 Kazuhiko Arase */
// exact upstream browser distribution follows
</script>
```

Preserve the upstream copyright/license notice. Do not minify or modify algorithm code during initial import.

- [ ] **Step 4: Add the third-party notice**

```markdown
## qrcode-generator 2.0.4

- Author: Kazuhiko Arase
- Source: https://github.com/kazuhikoarase/qrcode-generator
- License: MIT
- Use: local browser-side scalable SVG generation for A4 asset labels
```

Include the complete MIT license text below this notice.

- [ ] **Step 5: Implement deterministic SVG rendering**

```javascript
function renderQrSvg(container, url, sizeMm) {
  container.textContent = '';
  var qr = qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  container.innerHTML = qr.createSvgTag({ cellSize: 1, margin: 4, scalable: true });
  var svg = container.querySelector('svg');
  svg.setAttribute('width', sizeMm + 'mm');
  svg.setAttribute('height', sizeMm + 'mm');
  svg.setAttribute('aria-label', '비품 QR 코드');
}
```

The only intentional `innerHTML` use in the print client is the SVG returned by the pinned local QR library. All sheet-derived text continues through `textContent`.

- [ ] **Step 6: Include the vendor before the client**

```html
<?!= includeHtml_('QrVendor'); ?>
<?!= includeHtml_('LabelClient'); ?>
```

- [ ] **Step 7: Run tests**

Run: `node --test tests/label-source.test.js tests/syntax.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps-script/QrVendor.html apps-script/LabelPrint.html apps-script/LabelClient.html THIRD_PARTY_NOTICES.md tests/label-source.test.js
git commit -m "feat: vendor scalable QR label renderer"
```

---

### Task 5: Implement exact Formtec and free-cut print CSS

**Files:**
- Create: `apps-script/LabelStyles.html`
- Modify: `apps-script/LabelPrint.html`
- Modify: `apps-script/LabelClient.html`
- Modify: `tests/label-source.test.js`

**Interfaces:**
- Consumes: selected profile and configurable X/Y/gap corrections.
- Produces: exact A4 pages, 24 slots each, no cut lines for Formtec, visible cut lines for free-cut, and a 64×34mm regulation label.

- [ ] **Step 1: Write failing geometry and required-copy tests**

```javascript
test('print CSS has A4 zero-margin geometry and required label copy', () => {
  const css = fs.readFileSync('apps-script/LabelStyles.html', 'utf8');
  const html = fs.readFileSync('apps-script/LabelPrint.html', 'utf8');
  assert.match(css, /@page\s*\{[^}]*size:\s*A4[^}]*margin:\s*0/s);
  assert.match(css, /--sheet-left:\s*6\.5mm/);
  assert.match(css, /--sheet-top:\s*12\.5mm/);
  assert.match(css, /--label-width:\s*64mm/);
  assert.match(css, /--label-height:\s*33\.9mm/);
  for (const text of ['강서청소년회관 물품조사', '정:', '부:', '조사', '최신 위치·조사이력 확인']) {
    assert.match(html, new RegExp(text));
  }
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/label-source.test.js`

Expected: FAIL because print CSS is missing.

- [ ] **Step 3: Implement A4 page geometry**

```css
:root {
  --sheet-left: 6.5mm;
  --sheet-top: 12.5mm;
  --label-width: 64mm;
  --label-height: 33.9mm;
  --column-gap: 2.5mm;
  --row-gap: 0mm;
  --offset-x: 0mm;
  --offset-y: 0mm;
  --qr-size: 20mm;
}

@page { size: A4; margin: 0; }

.label-page {
  width: 210mm;
  height: 297mm;
  box-sizing: border-box;
  padding-left: calc(var(--sheet-left) + var(--offset-x));
  padding-top: calc(var(--sheet-top) + var(--offset-y));
  display: grid;
  grid-template-columns: repeat(3, var(--label-width));
  grid-template-rows: repeat(8, var(--label-height));
  column-gap: var(--column-gap);
  row-gap: var(--row-gap);
  break-after: page;
}
```

- [ ] **Step 4: Implement the 64×34mm label body**

Use a left information region and right 20mm QR region. Required copy:

```html
<article class="asset-label">
  <div class="label-title">강서청소년회관 물품조사</div>
  <div class="label-info">
    <div class="manager-line">정: 김은영&nbsp;&nbsp;부: 김정훈</div>
    <div class="item-line"><span>품명</span><strong class="item-name"></strong></div>
    <div class="number-line"><span>번호</span><strong class="asset-number"></strong></div>
    <div class="date-line"><span>조사</span><strong class="inspection-date"></strong></div>
  </div>
  <div class="qr-region"><div class="qr-svg"></div><small>최신 위치·조사이력 확인</small></div>
</article>
```

Apply `line-clamp:2` to item names and `white-space:nowrap` to New asset numbers.

- [ ] **Step 5: Implement profile-specific cut lines**

`FORMTEC_LS3106` uses no visible outer border except the designed internal table. `A4_FREECUT_64X34` adds a light dashed `outline` around each slot that prints as a cutting guide. Empty start slots remain completely blank for Formtec and retain only cut guides for free-cut.

- [ ] **Step 6: Apply runtime correction variables**

Client sets:

```javascript
root.style.setProperty('--offset-x', Number(settings.offsetX || 0) + 'mm');
root.style.setProperty('--offset-y', Number(settings.offsetY || 0) + 'mm');
root.style.setProperty('--column-gap', (2.5 + Number(settings.columnGapCorrection || 0)) + 'mm');
root.style.setProperty('--row-gap', Number(settings.rowGapCorrection || 0) + 'mm');
root.style.setProperty('--qr-size', Number(settings.qrSizeMm || 20) + 'mm');
```

- [ ] **Step 7: Run tests**

Run: `node --test tests/label-source.test.js tests/syntax.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps-script/LabelStyles.html apps-script/LabelPrint.html apps-script/LabelClient.html tests/label-source.test.js
git commit -m "feat: print exact Formtec and free-cut labels"
```

---

### Task 6: Add calibration, operator warnings, and print-batch verification

**Files:**
- Modify: `apps-script/LabelPrint.html`
- Modify: `apps-script/LabelClient.html`
- Modify: `README.md`
- Modify: `tests/label-source.test.js`

**Interfaces:**
- Consumes: profile, settings, selected labels, printer output confirmation.
- Produces: safe calibration workflow and auditable print completion.

- [ ] **Step 1: Write failing operator-safety tests**

```javascript
test('label UI warns about 100 percent scale and partial-sheet laser risk', () => {
  const html = fs.readFileSync('apps-script/LabelPrint.html', 'utf8');
  assert.match(html, /출력 배율 100%/);
  assert.match(html, /페이지 맞춤 사용 금지/);
  assert.match(html, /일부 라벨을 떼어낸 용지.*걸림|박리/s);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/label-source.test.js`

Expected: FAIL because warnings are missing.

- [ ] **Step 3: Add calibration instructions**

UI and README must instruct:

```text
1. 일반 A4 용지에 시험인쇄
2. 출력물을 Formtec LS-3106 뒤에 겹쳐 빛에 비춰 위치 확인
3. 가로·세로 보정값 조절
4. 첫 행과 마지막 행의 누적 오차 확인
5. 실제 라벨지 한 장만 시험인쇄
6. QR 스캔과 글자 잘림 확인
7. 출력 완료 기록
```

- [ ] **Step 4: Add print settings warnings**

Display before print:

```text
A4 / 세로
출력 배율 100%
머리글·바닥글 해제
페이지 맞춤 사용 금지
```

For start slot greater than 1, display the laser/inkjet partial-sheet caution and require a checkbox acknowledgement.

- [ ] **Step 5: Verify batch completion cannot drift from preview**

Generate a client preview fingerprint from ordered system IDs, profile, date, start slot, and label version. Send it to `recordLabelPrintBatch`; server recomputes and rejects a mismatch so changed selection cannot be recorded against an earlier print.

```javascript
function makePreviewFingerprint(input) {
  return [input.systemIds.join(','), input.profile, input.inspectionDate, input.startSlot, input.labelVersion].join('|');
}
```

Use a SHA-256 digest server-side for the stored confirmation token.

- [ ] **Step 6: Run tests**

Run: `node --test tests/label-core.test.js tests/label-source.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps-script/LabelPrint.html apps-script/LabelClient.html README.md tests/label-source.test.js
git commit -m "feat: harden label calibration and completion records"
```

---

### Task 7: Run one-page and 10–20-asset field pilots

**Files:**
- No source changes expected unless a measured reproducible defect is found.
- Evidence: PR comment or `docs/operations/asset-label-pilot-2026-08.md`.

**Interfaces:**
- Consumes: deployed label route, five valid pilot QR keys, Formtec LS-3106, A4 paper, and smartphone scanners.
- Produces: calibrated print settings and field evidence before full issue.

- [ ] **Step 1: Deploy the existing Apps Script app with the new label files**

Copy mappings:

```text
apps-script/LabelCore.js   → LabelCore.gs
apps-script/LabelAdmin.gs  → LabelAdmin.gs
apps-script/LabelPrint.html → LabelPrint.html
apps-script/LabelStyles.html → LabelStyles.html
apps-script/LabelClient.html → LabelClient.html
apps-script/QrVendor.html  → QrVendor.html
```

Update the existing deployment to a new version so the current `/exec` URL remains unchanged.

- [ ] **Step 2: Open the administrator route**

Use the existing web-app URL with `?page=labels` and confirm the mobile inspection route without that parameter still works.

- [ ] **Step 3: Print a plain-A4 alignment page**

Select the five QR-detail pilot assets, Formtec profile, start slot 1, and the agreed label inspection date. Print at 100% with headers/footers disabled.

- [ ] **Step 4: Measure and store corrections**

Overlay the page on LS-3106. Record X, Y, column-gap, and row-gap corrections in `라벨설정`. Reprint until first and last rows align.

- [ ] **Step 5: Print one actual LS-3106 sheet**

Fill no more than 24 pilot/test labels. Confirm manager names, New number, item-name wrapping, inspection date, QR caption, and no clipping.

- [ ] **Step 6: Scan every printed QR**

Use at least two smartphones. Confirm all QR codes resolve to the correct signed-in detail page under normal office light and one dimmer location.

- [ ] **Step 7: Record the print batch**

Press `출력 완료 기록`. Verify active `QR발급관리` rows contain the exact managers, manager version, inspection date, profile, print time, batch ID, and `재출력필요여부=N`.

- [ ] **Step 8: Attach 10–20 labels in one space**

Choose a single room, attach labels to clean flat surfaces, rescan after attachment, and verify the latest location in the QR page matches `비품현재상태`.

- [ ] **Step 9: Test one ordinary reprint**

Mark one label as damaged, select reprint-required only, reprint it, and confirm the QR access key and URL are unchanged while `재출력횟수` increments.

- [ ] **Step 10: Record pilot evidence**

Record printer model, final correction values, QR size, selected system IDs, scan success count, label adhesion observations, and reprint result. Do not begin 842 issuance unless every pilot QR resolves correctly.

---

### Task 8: Issue and print all 842 permanent labels

**Files:**
- Operational evidence and final audit report.

**Interfaces:**
- Consumes: stable detail `/exec` URL, calibrated Formtec profile, passed field pilot, and 842 valid master assets.
- Produces: 842 active QR URLs and physically recorded label batches.

- [ ] **Step 1: Freeze the production detail URL and label settings**

Confirm `라벨설정` contains the final detail `/exec` URL, `정=김은영`, `부=김정훈`, manager version, label inspection date, profile, and calibration values.

- [ ] **Step 2: Run pre-issue audits**

Run:

```text
auditCurrentState()
auditQrIssues()
```

Expected: 842 registered/current-state rows, zero sync errors, zero duplicate keys, and no active-key duplicates.

- [ ] **Step 3: Prepare all unissued assets**

Use the `QR 미발급 비품` filter. Preview in batches sized for printer handling; do not create a replacement detail deployment URL after this point.

- [ ] **Step 4: Print and confirm batches**

A minimum of 36 LS-3106 sheets is required for 842 labels at 24 per sheet. Use 38–40 sheets operationally to allow test, alignment, and damaged-label replacements. Confirm each completed batch explicitly.

- [ ] **Step 5: Verify all issue rows**

Expected:

```text
active QR keys: 842
QR발급상태=발급완료: 842
비품마스터 QR조회URL populated: 842
invalid keys: 0
duplicate keys: 0
reprint-required unexpectedly Y: 0
```

- [ ] **Step 6: Sample-scan every batch**

Scan at least the first, middle, and last label from every printed A4 sheet before distribution. Any wrong linkage stops that batch from attachment.

- [ ] **Step 7: Record final evidence**

Record total sheets, total labels, batch IDs, failed/reprinted labels, scan sample count, stable detail deployment ID, and final audit output in the PR or operations document.
