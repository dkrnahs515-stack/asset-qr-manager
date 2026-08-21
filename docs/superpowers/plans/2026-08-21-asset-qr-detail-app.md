# Asset QR Issuance and Detail App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue non-guessable permanent QR access keys and deploy a separate Google-login-only, read-only mobile web app that shows the correct asset, latest state, and inspection history.

**Architecture:** The existing Apps Script project owns QR-key issuance and updates `QR발급관리` plus `비품마스터.QR조회URL`. A second standalone Apps Script project reads the same spreadsheet using readonly scope, resolves `k=<QR접근키>`, joins `비품마스터` and `비품현재상태`, and returns a mobile detail view with paginated inspection history. Ordinary label reprints reuse the active key; only exposure or mis-linking stops the prior key and appends a new issuance row.

**Tech Stack:** Google Apps Script V8, Google Sheets, HtmlService, vanilla HTML/CSS/JavaScript, Node.js 20 `node:test`

**Spec:** `docs/superpowers/specs/2026-08-21-asset-qr-detail-label-design.md`

## Global Constraints

- This plan starts only after `docs/superpowers/plans/2026-08-21-asset-current-state-foundation.md` has produced valid `비품현재상태`, `QR발급관리`, and `라벨설정` sheets.
- Spreadsheet ID is `1R5WjwpXtsJwQfIvNnQ_D5PLD6TTLXqTlQ7CSjbUa274`.
- QR URLs expose only a URL-safe random access key; they never expose sequential `GSYC-000001` as the external lookup key.
- Active access keys are 32 URL-safe characters produced from a SHA-256 digest seeded by two UUIDs and timestamp input.
- A normal reprint preserves the active access key and URL.
- Key compromise, wrong asset linkage, or asset merge marks the old row `QR접근키상태=중지` and appends a new active row; old rows are not deleted.
- The detail app contains no mutation APIs, no Drive scope, and no sheet writes.
- Google account login is enforced by deployment configuration: execute as deployer; access limited to signed-in Google users.
- The detail app does not claim Workspace-domain employee verification and does not display the viewer's email.
- Missing basic fields display `정보 없음`; invalid, missing, inactive, and broken links use explicit safe error screens.
- Initial production validation issues keys to five pilot assets only; 842-asset issuance waits for the final detail `/exec` URL and label pilot.

---

## File Structure

### Existing Apps Script project

- Create: `apps-script/QrCore.js` — pure key validation, URL construction, and issue-record rules.
- Create: `apps-script/QrAdmin.gs` — key generation, first issue, stop/reissue, master URL update, and issue audits.
- Create: `tests/qr-admin.test.js` — pure QR policy tests.
- Create: `tests/qr-admin-source.test.js` — Apps Script integration contracts.
- Modify: `apps-script/Code.gs` — QR sheet constant already installed; expose safe admin wrappers if needed.
- Modify: `tests/syntax.test.js` — parse new files.
- Modify: `README.md` — project/file mappings and deployment handoff.

### Separate read-only Apps Script project

- Create: `apps-script-detail/Code.gs` — `doGet`, includes, and server API entry points.
- Create: `apps-script-detail/DetailCore.js` — pure validation, money/date/location/history presentation models.
- Create: `apps-script-detail/DetailRepository.gs` — readonly sheet lookup and history queries.
- Create: `apps-script-detail/Index.html` — application shell.
- Create: `apps-script-detail/Styles.html` — mobile styles.
- Create: `apps-script-detail/Client.html` — client rendering and history pagination.
- Create: `apps-script-detail/appsscript.json` — readonly manifest.
- Create: `tests/detail-core.test.js` — presentation and error-model tests.
- Create: `tests/detail-app-source.test.js` — readonly/source/security contracts.

---

### Task 1: Define QR key, URL, and issuance-record rules

**Files:**
- Create: `apps-script/QrCore.js`
- Create: `tests/qr-admin.test.js`

**Interfaces:**
- Consumes: digest bytes, final detail deployment URL, asset system ID, existing issue rows.
- Produces: `base64UrlFromBytes(bytes)`, `isValidQrAccessKey(key)`, `buildQrLookupUrl(baseUrl, key)`, `buildInitialQrIssueRecord(asset, key, url)`, and `findActiveQrIssue(rows, systemId)`.

- [ ] **Step 1: Write failing key and URL tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  base64UrlFromBytes,
  isValidQrAccessKey,
  buildQrLookupUrl,
  findActiveQrIssue
} = require('../apps-script/QrCore.js');

test('QR access key is 32 URL-safe characters', () => {
  const key = base64UrlFromBytes(Array.from({ length: 32 }, (_, i) => i)).slice(0, 32);
  assert.equal(key.length, 32);
  assert.match(key, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(isValidQrAccessKey(key), true);
  assert.equal(isValidQrAccessKey('GSYC-000001'), false);
});

test('lookup URL preserves only the access key query parameter', () => {
  assert.equal(
    buildQrLookupUrl('https://script.google.com/macros/s/DEPLOYMENT123/exec', 'AbcdEFGHijklMNOPqrstUVWXyz01_234'),
    'https://script.google.com/macros/s/DEPLOYMENT123/exec?k=AbcdEFGHijklMNOPqrstUVWXyz01_234'
  );
});

test('active QR lookup ignores stopped historical rows', () => {
  const active = findActiveQrIssue([
    { systemId: 'GSYC-000001', accessKeyStatus: '중지', accessKey: 'old' },
    { systemId: 'GSYC-000001', accessKeyStatus: '사용', accessKey: 'new' }
  ], 'GSYC-000001');
  assert.equal(active.accessKey, 'new');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/qr-admin.test.js`

Expected: FAIL because `QrCore.js` does not exist.

- [ ] **Step 3: Implement pure key and URL rules**

```javascript
function base64UrlFromBytes(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function isValidQrAccessKey(key) {
  return /^[A-Za-z0-9_-]{32}$/.test(String(key || ''));
}

function buildQrLookupUrl(baseUrl, key) {
  var normalizedBase = String(baseUrl || '').trim().replace(/[?&]+$/, '');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(normalizedBase)) {
    throw new Error('정식 QR 상세조회 /exec URL이 필요합니다.');
  }
  if (!isValidQrAccessKey(key)) throw new Error('유효하지 않은 QR 접근키입니다.');
  return normalizedBase + '?k=' + encodeURIComponent(key);
}

function findActiveQrIssue(rows, systemId) {
  var matches = (rows || []).filter(function (row) {
    return row.systemId === systemId && row.accessKeyStatus === '사용';
  });
  if (matches.length > 1) throw new Error('사용 중인 QR 접근키가 중복되었습니다: ' + systemId);
  return matches[0] || null;
}
```

For Apps Script compatibility, guard the Node `Buffer` implementation and provide `base64UrlFromAppsScriptBytes_` in `QrAdmin.gs` using `Utilities.base64EncodeWebSafe`.

- [ ] **Step 4: Add issuance-record construction**

```javascript
function buildInitialQrIssueRecord(asset, key, url) {
  return {
    systemId: asset.systemId,
    accessKey: key,
    accessKeyStatus: '사용',
    lookupUrl: url,
    issueStatus: '미발급',
    labelType: '',
    labelVersion: '',
    printedPrimaryManager: '',
    printedSecondaryManager: '',
    managerVersion: '',
    labelInspectionDate: '',
    firstIssuedAt: new Date(),
    lastPrintedAt: '',
    reprintRequired: 'N',
    reprintReason: '',
    reprintCount: 0,
    lastPrintBatchId: '',
    memo: ''
  };
}
```

- [ ] **Step 5: Export and run tests**

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    base64UrlFromBytes,
    isValidQrAccessKey,
    buildQrLookupUrl,
    buildInitialQrIssueRecord,
    findActiveQrIssue
  };
}
```

Run: `node --test tests/qr-admin.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps-script/QrCore.js tests/qr-admin.test.js
git commit -m "feat: define permanent QR access-key policy"
```

---

### Task 2: Implement first issue, reuse, stop, and reissue operations

**Files:**
- Create: `apps-script/QrAdmin.gs`
- Create: `tests/qr-admin-source.test.js`
- Modify: `tests/syntax.test.js`

**Interfaces:**
- Consumes: `라벨설정.상세조회배포URL`, `비품마스터`, `QR발급관리`, and pure QR rules.
- Produces: `issueQrAccessKeys(request)`, `stopAndReissueQrAccessKey(request)`, `auditQrIssues()`, and internal `ensureActiveQrIssueForAsset_(asset, baseUrl)`.

- [ ] **Step 1: Write failing source contracts**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('apps-script/QrAdmin.gs', 'utf8');

test('QR admin exposes locked issue and reissue entry points', () => {
  assert.match(source, /function issueQrAccessKeys\(request\)/);
  assert.match(source, /function stopAndReissueQrAccessKey\(request\)/);
  assert.match(source, /LockService\.getScriptLock\(\)/);
  assert.match(source, /Utilities\.computeDigest/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/qr-admin-source.test.js`

Expected: FAIL because `QrAdmin.gs` does not exist.

- [ ] **Step 3: Implement cryptographic key material generation**

```javascript
function generateQrAccessKey_() {
  var seed = Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + new Date().getTime();
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    seed,
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '').slice(0, 32);
}
```

Before accepting a generated key, search the entire `QR접근키` column with exact matching. Retry up to five times; throw a clear error if all five collide.

- [ ] **Step 4: Implement batch first issuance with active-key reuse**

```javascript
function issueQrAccessKeys(request) {
  request = request || {};
  var systemIds = Array.from(new Set((request.systemIds || []).map(String)));
  if (!systemIds.length) throw new Error('QR을 발급할 비품을 선택하세요.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var baseUrl = readRequiredLabelSetting_('상세조회배포URL');
    var results = systemIds.map(function (systemId) {
      var asset = readMasterAssetBySystemId_(getSpreadsheet_(), systemId);
      if (!asset) return { systemId: systemId, ok: false, error: '비품마스터 누락' };
      var issue = ensureActiveQrIssueForAsset_(asset, baseUrl);
      updateMasterQrUrl_(asset.systemId, issue.lookupUrl);
      return { systemId: systemId, ok: true, accessKey: issue.accessKey, lookupUrl: issue.lookupUrl, reused: issue.reused };
    });
    return { requested: systemIds.length, results: results };
  } finally {
    lock.releaseLock();
  }
}
```

`ensureActiveQrIssueForAsset_` reuses an existing single active row. When none exists, it appends a new row with `QR접근키상태=사용`, `QR발급상태=미발급`, and no print date.

- [ ] **Step 5: Implement stop and reissue**

```javascript
function stopAndReissueQrAccessKey(request) {
  request = request || {};
  assertText_(request.systemId, '영구 시스템 ID');
  assertText_(request.reason, '재발급 사유');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    stopActiveQrIssueRows_(request.systemId, request.reason);
    var asset = readMasterAssetBySystemId_(getSpreadsheet_(), request.systemId);
    var issue = createNewQrIssueRow_(asset, readRequiredLabelSetting_('상세조회배포URL'), request.reason);
    updateMasterQrUrl_(asset.systemId, issue.lookupUrl);
    return issue;
  } finally {
    lock.releaseLock();
  }
}
```

The stopped row remains in place with `QR접근키상태=중지`, `재출력필요여부=Y`, and the reason. The new row uses a new key and starts with `QR발급상태=재발급필요`.

- [ ] **Step 6: Implement issuance audit**

`auditQrIssues()` returns active count, duplicate-active system IDs, duplicate keys, missing master IDs, master URL mismatches, and rows with invalid key format.

- [ ] **Step 7: Run tests**

Run: `node --test tests/qr-admin.test.js tests/qr-admin-source.test.js tests/syntax.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps-script/QrAdmin.gs tests/qr-admin-source.test.js tests/syntax.test.js
git commit -m "feat: issue and rotate asset QR access keys"
```

---

### Task 3: Build the read-only detail model and error model

**Files:**
- Create: `apps-script-detail/DetailCore.js`
- Create: `tests/detail-core.test.js`

**Interfaces:**
- Consumes: raw master asset, current-state row, session record history, and requested key.
- Produces: `validateDetailKey(key)`, `buildAssetDetailModel(asset, currentState, history)`, `buildDetailError(code)`, `normalizeWon(value)`, and `formatLocation(floor, spaceName, detailLocation)`.

- [ ] **Step 1: Write failing detail-model tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAssetDetailModel,
  buildDetailError,
  normalizeWon
} = require('../apps-script-detail/DetailCore.js');

test('detail model distinguishes official and last confirmed locations', () => {
  const model = buildAssetDetailModel({
    systemId: 'GSYC-000001', newAssetNo: '2015-B-16', name: '일체형 컴퓨터',
    spec: '22V240-LT23K(LG)', quantity: 1, unit: '개', unitPrice: '₩609,420.00',
    acquisitionAmount: '₩609,420.00', purchaseYear: '2015', usefulLife: '5',
    floor: '지하 1층', spaceName: '창고 1', locationCode: 'LOC-001'
  }, {
    currentFloor: '1층', currentSpaceName: '로비', currentLocationCode: 'LOC-019',
    currentResult: '위치변경', lastLocationChangedAt: '2026-08-21T02:00:00Z',
    lastPhysicalConfirmedAt: '2026-08-21T02:00:00Z', lastPhysicalConfirmedBy: '이건희',
    latestSessionName: '2026년 정기 전수조사 1차', latestJudgedAt: '2026-08-21T02:00:00Z',
    masterApplied: 'N', syncStatus: '정상'
  }, []);

  assert.equal(model.location.mismatch, true);
  assert.equal(model.location.registered, '지하 1층 > 창고 1');
  assert.equal(model.location.current, '1층 > 로비');
  assert.equal(model.basic.unitPrice, '609,420원');
});

test('missing values become information unavailable instead of undefined', () => {
  const model = buildAssetDetailModel({ systemId: 'GSYC-000002', newAssetNo: '', name: '' }, null, []);
  assert.equal(model.basic.newAssetNo, '정보 없음');
  assert.equal(model.basic.name, '정보 없음');
});

test('invalid key has a safe user-facing error', () => {
  assert.deepEqual(buildDetailError('INVALID_KEY'), {
    code: 'INVALID_KEY', title: '유효하지 않은 QR입니다', message: '비품에 부착된 QR을 다시 스캔해 주세요.'
  });
});

test('won display removes decimal currency noise', () => {
  assert.equal(normalizeWon('₩609,420.00'), '609,420원');
  assert.equal(normalizeWon(''), '정보 없음');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/detail-core.test.js`

Expected: FAIL because `DetailCore.js` does not exist.

- [ ] **Step 3: Implement the pure detail model**

```javascript
function normalizeWon(value) {
  if (value === null || value === undefined || String(value).trim() === '') return '정보 없음';
  var number = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? Math.round(number).toLocaleString('ko-KR') + '원' : '정보 없음';
}

function formatLocation(floor, spaceName, detailLocation) {
  var parts = [floor, spaceName, detailLocation].map(function (v) { return String(v || '').trim(); }).filter(Boolean);
  return parts.length ? parts.join(' > ') : '정보 없음';
}

function buildAssetDetailModel(asset, currentState, history) {
  var master = asset || {};
  var state = currentState || {};
  var registered = formatLocation(master.floor, master.spaceName, master.detailLocation);
  var current = state.currentLocationCode
    ? formatLocation(state.currentFloor, state.currentSpaceName, state.currentDetailLocation)
    : registered;
  return {
    systemId: master.systemId || '',
    basic: {
      newAssetNo: master.newAssetNo || '정보 없음',
      name: master.name || '정보 없음',
      spec: master.spec || '정보 없음',
      quantity: master.quantity === '' || master.quantity === undefined ? '정보 없음' : String(master.quantity) + (master.unit || ''),
      unitPrice: normalizeWon(master.unitPrice),
      acquisitionAmount: normalizeWon(master.acquisitionAmount),
      purchaseYear: master.purchaseYear ? String(master.purchaseYear) + '년' : '정보 없음',
      usefulLife: master.usefulLife ? String(master.usefulLife) + '년' : '정보 없음'
    },
    location: {
      registered: registered,
      current: current,
      mismatch: registered !== current,
      source: state.locationSource || '비품마스터',
      masterApplied: state.masterApplied || 'N',
      syncStatus: state.syncStatus || '정상'
    },
    latest: {
      result: state.currentResult || '정보 없음',
      sessionName: state.latestSessionName || '정보 없음',
      judgedAt: state.latestJudgedAt || '',
      judgedBy: state.latestJudgedBy || '',
      physicalConfirmedAt: state.lastPhysicalConfirmedAt || '',
      physicalConfirmedBy: state.lastPhysicalConfirmedBy || '',
      locationChangedAt: state.lastLocationChangedAt || ''
    },
    history: history || []
  };
}
```

- [ ] **Step 4: Implement explicit error models**

Support `MISSING_KEY`, `INVALID_KEY`, `INACTIVE_KEY`, `ASSET_NOT_FOUND`, and `STATE_SYNC_ERROR` with Korean title/message pairs.

- [ ] **Step 5: Export and run tests**

Run: `node --test tests/detail-core.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps-script-detail/DetailCore.js tests/detail-core.test.js
git commit -m "feat: model read-only asset QR details"
```

---

### Task 4: Implement the separate readonly Apps Script repository and APIs

**Files:**
- Create: `apps-script-detail/Code.gs`
- Create: `apps-script-detail/DetailRepository.gs`
- Create: `apps-script-detail/appsscript.json`
- Create: `tests/detail-app-source.test.js`
- Modify: `tests/syntax.test.js`

**Interfaces:**
- Consumes: access key, QR issue sheet, master sheet, current-state sheet, session/record/change-log sheets.
- Produces: `getAssetDetailByKey(key, historyLimit)` and `getAssetHistoryByKey(key, offset, limit)`.

- [ ] **Step 1: Write failing readonly/security source tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const allSource = ['Code.gs', 'DetailRepository.gs'].map(name =>
  fs.readFileSync(`apps-script-detail/${name}`, 'utf8')
).join('\n');
const manifest = JSON.parse(fs.readFileSync('apps-script-detail/appsscript.json', 'utf8'));

test('detail project has readonly spreadsheet scope and no mutation calls', () => {
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  assert.doesNotMatch(allSource, /\.setValue\(|\.setValues\(|appendRow\(|deleteRow\(|DriveApp|LockService/);
});

test('detail APIs validate keys and paginate history', () => {
  assert.match(allSource, /function getAssetDetailByKey\(key, historyLimit\)/);
  assert.match(allSource, /function getAssetHistoryByKey\(key, offset, limit\)/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/detail-app-source.test.js`

Expected: FAIL because the detail project files do not exist.

- [ ] **Step 3: Create the readonly manifest**

```json
{
  "timeZone": "Asia/Seoul",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets.readonly"
  ]
}
```

- [ ] **Step 4: Implement exact-key and exact-system-ID readers**

Use `TextFinder.matchEntireCell(true)` on `QR접근키` and `영구 시스템 ID`. Reject a key when zero or more than one active row matches. Read master and current-state rows by system ID. Read history records using `findAll()` in the system-ID column, then join session display fields and latest judgment timestamps from valid judgment change logs.

- [ ] **Step 5: Implement server APIs**

```javascript
var DETAIL_CONFIG = {
  SPREADSHEET_ID: '1R5WjwpXtsJwQfIvNnQ_D5PLD6TTLXqTlQ7CSjbUa274',
  SHEETS: {
    ASSET_MASTER: '비품마스터', CURRENT_STATE: '비품현재상태', QR_ISSUE: 'QR발급관리',
    SESSION: '전수조사세션', RECORD: '전수조사기록', CHANGE_LOG: '변경이력'
  }
};

function getAssetDetailByKey(key, historyLimit) {
  var normalized = validateDetailKey(key);
  if (!normalized.ok) return { ok: false, error: buildDetailError(normalized.code) };
  var issue = readActiveQrIssueByKey_(normalized.key);
  if (!issue) return { ok: false, error: buildDetailError('INACTIVE_KEY') };
  var asset = readDetailMasterAsset_(issue.systemId);
  if (!asset) return { ok: false, error: buildDetailError('ASSET_NOT_FOUND') };
  var state = readDetailCurrentState_(issue.systemId);
  var history = readDetailHistory_(issue.systemId, 0, Math.min(20, Math.max(1, Number(historyLimit || 10))));
  return { ok: true, detail: buildAssetDetailModel(asset, state, history.items), historyTotal: history.total };
}
```

`getAssetHistoryByKey` repeats active-key validation, clamps `offset>=0` and `1<=limit<=20`, and returns `{ok, items, total, nextOffset}`.

- [ ] **Step 6: Add `doGet` and include helper**

```javascript
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  template.initialKey = JSON.stringify(String(e && e.parameter && e.parameter.k || ''));
  return template.evaluate()
    .setTitle('강서청소년회관 비품정보')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function includeDetail_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
```

- [ ] **Step 7: Run tests**

Run: `node --test tests/detail-app-source.test.js tests/detail-core.test.js tests/syntax.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps-script-detail/Code.gs apps-script-detail/DetailRepository.gs apps-script-detail/appsscript.json tests/detail-app-source.test.js tests/syntax.test.js
git commit -m "feat: add readonly asset detail server"
```

---

### Task 5: Build the mobile detail UI and paginated history

**Files:**
- Create: `apps-script-detail/Index.html`
- Create: `apps-script-detail/Styles.html`
- Create: `apps-script-detail/Client.html`
- Modify: `tests/detail-app-source.test.js`
- Modify: `tests/syntax.test.js`

**Interfaces:**
- Consumes: `initialKey`, `getAssetDetailByKey`, and `getAssetHistoryByKey`.
- Produces: a read-only mobile view with basic data, location comparison, recent dates, sync warning, error screens, and expandable history.

- [ ] **Step 1: Add failing UI contract tests**

```javascript
test('detail UI contains required sections and no edit controls', () => {
  const html = ['Index.html', 'Styles.html', 'Client.html'].map(name =>
    fs.readFileSync(`apps-script-detail/${name}`, 'utf8')
  ).join('\n');
  for (const text of ['비품번호', '품명', '규격', '수량', '단가', '취득금액', '구입연도', '내용연수', '마지막 확인 위치', '최근 조사', '조사이력']) {
    assert.match(html, new RegExp(text));
  }
  assert.doesNotMatch(html, /저장|수정하기|삭제/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/detail-app-source.test.js`

Expected: FAIL because the UI files are missing.

- [ ] **Step 3: Create the HTML shell**

```html
<!doctype html>
<html lang="ko">
<head>
  <base target="_top">
  <?!= includeDetail_('Styles'); ?>
</head>
<body>
  <main id="app" aria-live="polite">
    <section id="loading" class="state-card">비품정보를 불러오는 중입니다.</section>
    <section id="error" class="state-card" hidden></section>
    <section id="detail" hidden>
      <header class="hero">
        <p>강서청소년회관 비품정보</p>
        <h1 id="asset-number"></h1>
        <h2 id="asset-name"></h2>
      </header>
      <section class="card" id="basic-card"><h3>기본 정보</h3><dl id="basic-list"></dl></section>
      <section class="card" id="location-card"><h3>위치 정보</h3><div id="location-content"></div></section>
      <section class="card" id="latest-card"><h3>최근 조사</h3><div id="latest-content"></div></section>
      <section class="card" id="history-card"><h3>조사이력</h3><div id="history-list"></div><button id="load-more" hidden>이력 더 보기</button></section>
    </section>
  </main>
  <script>window.INITIAL_QR_KEY = <?!= initialKey ?>;</script>
  <?!= includeDetail_('Client'); ?>
</body>
</html>
```

- [ ] **Step 4: Implement client loading and safe text rendering**

Use `textContent`, never `innerHTML`, for sheet-derived values. Render dates with `Intl.DateTimeFormat('ko-KR', {dateStyle:'medium', timeStyle:'short'})`. Display the official and current locations in separate blocks when `mismatch=true`.

- [ ] **Step 5: Implement history pagination**

Load the first 10 records with the detail response. `이력 더 보기` calls `getAssetHistoryByKey(window.INITIAL_QR_KEY, nextOffset, 10)` and appends `<details>` rows containing session name, judgment date, result, location, inspector, and issue type.

- [ ] **Step 6: Implement state/error styling**

Use a single-column layout, minimum 16px body text, high-contrast status badges, and sticky-free content so scanning immediately exposes the asset number/name. When `syncStatus=오류`, show the official ledger location plus `현재 위치 동기화 확인이 필요합니다` rather than presenting derived location as certain.

- [ ] **Step 7: Run tests**

Run: `node --test tests/detail-app-source.test.js tests/syntax.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps-script-detail/Index.html apps-script-detail/Styles.html apps-script-detail/Client.html tests/detail-app-source.test.js tests/syntax.test.js
git commit -m "feat: render mobile asset QR details"
```

---

### Task 6: Deploy the detail app and issue a five-asset pilot

**Files:**
- Modify: `README.md`
- Evidence: PR comment or rollout record with deployment URL redacted to the stable `/exec` identifier if necessary.

**Interfaces:**
- Consumes: completed detail project and QR admin APIs.
- Produces: one stable detail deployment URL and five active pilot keys/URLs.

- [ ] **Step 1: Document the separate project copy mapping**

```text
apps-script-detail/Code.gs            → Code.gs
apps-script-detail/DetailCore.js      → DetailCore.gs
apps-script-detail/DetailRepository.gs → DetailRepository.gs
apps-script-detail/Index.html         → Index.html
apps-script-detail/Styles.html        → Styles.html
apps-script-detail/Client.html        → Client.html
apps-script-detail/appsscript.json    → appsscript.json
```

- [ ] **Step 2: Create a new standalone Apps Script project and paste the files**

Save all files and verify the manifest requests only `spreadsheets.readonly`.

- [ ] **Step 3: Deploy with the required access configuration**

Use:

```text
실행 사용자: 나
액세스 사용자: Google 계정으로 로그인한 모든 사용자
```

Create one production web-app deployment. Future code updates edit this deployment to a new version; do not create a replacement URL.

- [ ] **Step 4: Save the exact `/exec` URL in `라벨설정`**

Set `설정항목=상세조회배포URL` to the deployed URL without query parameters.

- [ ] **Step 5: Select five pilot assets**

Use one each for 정상, 위치변경, 상태이상, 미발견, and basic-information-partly-empty. Record the exact five system IDs before issuance.

- [ ] **Step 6: Issue only the five pilot keys**

Run `issueQrAccessKeys({systemIds: [...]})` from the existing Apps Script project.

Expected: five successful rows, five active unique keys, and matching `비품마스터.QR조회URL` values.

- [ ] **Step 7: Verify authentication and errors**

Test:

1. Signed-out/incognito request prompts for Google login or denies access.
2. Signed-in Google account opens each of the five correct assets.
3. Missing `k` shows the missing-key screen.
4. A malformed key shows the invalid-key screen.
5. Temporarily stop one pilot key, verify the inactive-key screen, then re-enable it without changing the other four.

- [ ] **Step 8: Verify data semantics**

For the location-changed asset, confirm official and last-confirmed locations both appear. For missing, confirm the current result is 미발견 while the last confirmed location remains visible. Confirm unit price and acquisition amount render as whole won amounts.

- [ ] **Step 9: Run audits and record evidence**

Run `auditQrIssues()`.

Expected: active count 5, no duplicate active system IDs, no duplicate keys, no invalid keys, and no master URL mismatch.

- [ ] **Step 10: Commit documentation**

```bash
git add README.md
git commit -m "docs: add QR detail deployment and pilot workflow"
```
