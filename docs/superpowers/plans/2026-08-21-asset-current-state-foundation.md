# Asset Current-State Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reproducible latest-state storage for all 842 assets, synchronize it with every inspection judgment, and use it as the starting location for later inspection sessions.

**Architecture:** Keep `비품마스터`, `전수조사기록`, and `변경이력` as authoritative sources. Materialize one derived row per asset in `비품현재상태`; rebuild a single row after judgments, revisions, and Undo, and rebuild all rows during installation or repair. Schema installation is idempotent and creates `비품현재상태`, `QR발급관리`, and `라벨설정` without overwriting existing values.

**Tech Stack:** Google Apps Script V8, Google Sheets, vanilla JavaScript, Node.js 20 `node:test`

**Spec:** `docs/superpowers/specs/2026-08-21-asset-qr-detail-label-design.md`

## Global Constraints

- Spreadsheet ID is `1R5WjwpXtsJwQfIvNnQ_D5PLD6TTLXqTlQ7CSjbUa274`.
- Expected registered asset count is 842; migration must report, not silently ignore, any count mismatch.
- `비품마스터` remains the official asset ledger and is never overwritten by a field judgment without a separate administrator-approval flow.
- `비품현재상태` is derived data and must be fully rebuildable from `비품마스터`, `전수조사세션`, `전수조사기록`, and valid `변경이력` rows.
- `미발견` preserves the last physically confirmed location and last physical-confirmation date.
- `사진추가` and memo-only changes must not change recent judgment, last physical confirmation, or last location-change dates.
- Judgment source records and change logs remain committed if current-state synchronization fails; the derived row is marked `동기화상태=오류` and can be rebuilt.
- All mutation and migration entry points use `LockService.getScriptLock()`.
- Pure logic belongs in `.js` files and is exported through `module.exports` for Node tests; Apps Script I/O belongs in `.gs` files.
- Existing mobile APIs and string-form `startInventorySession(inspector)` calls remain backward compatible.

---

## File Structure

- Create: `apps-script/CurrentStateCore.js` — pure timeline reduction and session-baseline selection.
- Create: `apps-script/CurrentState.gs` — sheet reads, upserts, rebuilds, sync-error recording, and audit entry points.
- Create: `apps-script/SchemaSetup.gs` — idempotent sheet/header/default-setting migration.
- Create: `tests/current-state.test.js` — pure current-state rules.
- Create: `tests/current-state-source.test.js` — static integration/order checks for Apps Script source.
- Modify: `apps-script/Code.gs` — sheet constants, session metadata, baseline selection, and legacy normal endpoint sync.
- Modify: `apps-script/Inspection.gs` — current-state rebuild after initial judgment, revision, and Undo.
- Modify: `apps-script/Index.html` — new-session metadata fields while preserving existing active-session flow.
- Modify: `tests/syntax.test.js` — include the new server files.
- Modify: `README.md` — Apps Script file mapping and one-time migration steps.

---

### Task 1: Define and test the current-state reduction model

**Files:**
- Create: `apps-script/CurrentStateCore.js`
- Create: `tests/current-state.test.js`

**Interfaces:**
- Consumes: asset snapshot objects with `systemId`, `newAssetNo`, `name`, and official location fields; session records with current result fields; session metadata; judgment timestamps by record ID.
- Produces: `deriveCurrentState(asset, records, sessionsById, judgmentAtByRecordId, now)` and `selectInspectionBaseline(asset, currentState)`.

- [ ] **Step 1: Write failing tests for normal confirmation and unchanged location**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveCurrentState } = require('../apps-script/CurrentStateCore.js');

const asset = {
  systemId: 'GSYC-000001',
  newAssetNo: '2015-B-16',
  name: '일체형 컴퓨터',
  locationCode: 'LOC-001',
  floor: '지하 1층',
  spaceName: '창고 1',
  detailLocation: ''
};

const sessions = {
  'INV-2026-001': {
    sessionId: 'INV-2026-001',
    name: '2026년 정기 전수조사 1차',
    category: '정기',
    round: 1
  }
};

test('normal confirmation updates physical confirmation without inventing a location change', () => {
  const state = deriveCurrentState(asset, [{
    recordId: 'INVR-2026-001-0001',
    sessionId: 'INV-2026-001',
    result: '정상',
    physicalConfirmed: 'Y',
    confirmedLocationCode: 'LOC-001',
    confirmedFloor: '지하 1층',
    confirmedSpaceName: '창고 1',
    inspector: '이건희'
  }], sessions, {
    'INVR-2026-001-0001': new Date('2026-08-21T01:00:00Z')
  }, new Date('2026-08-21T01:05:00Z'));

  assert.equal(state.currentLocationCode, 'LOC-001');
  assert.equal(state.currentResult, '정상');
  assert.equal(state.lastPhysicalConfirmedBy, '이건희');
  assert.equal(state.lastLocationChangedAt, '');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/current-state.test.js`

Expected: FAIL because `apps-script/CurrentStateCore.js` or `deriveCurrentState` does not exist.

- [ ] **Step 3: Add failing tests for location change, issue-at-different-location, missing, and unconfirmed restore**

```javascript
test('location change preserves prior location and records the change time', () => {
  const state = deriveCurrentState(asset, [{
    recordId: 'INVR-2026-001-0001',
    sessionId: 'INV-2026-001',
    result: '위치변경',
    physicalConfirmed: 'Y',
    confirmedLocationCode: 'LOC-019',
    confirmedFloor: '1층',
    confirmedSpaceName: '로비',
    inspector: '이건희'
  }], sessions, {
    'INVR-2026-001-0001': new Date('2026-08-21T02:00:00Z')
  }, new Date('2026-08-21T02:05:00Z'));

  assert.equal(state.currentLocationCode, 'LOC-019');
  assert.equal(state.previousLocationCode, 'LOC-001');
  assert.equal(state.lastLocationChangedBy, '이건희');
  assert.equal(state.locationSource, '전수조사');
});

test('missing keeps the latest physically confirmed location', () => {
  const records = [
    {
      recordId: 'INVR-2026-001-0001', sessionId: 'INV-2026-001', result: '정상',
      physicalConfirmed: 'Y', confirmedLocationCode: 'LOC-001', confirmedFloor: '지하 1층',
      confirmedSpaceName: '창고 1', inspector: '김정훈'
    },
    {
      recordId: 'INVR-2026-002-0001', sessionId: 'INV-2026-002', result: '미발견',
      physicalConfirmed: 'N', confirmedLocationCode: '', confirmedFloor: '', confirmedSpaceName: '',
      inspector: '이건희'
    }
  ];
  const state = deriveCurrentState(asset, records, {
    ...sessions,
    'INV-2026-002': { sessionId: 'INV-2026-002', name: '2026년 수시 위치점검 1차', category: '수시', round: 1 }
  }, {
    'INVR-2026-001-0001': new Date('2026-08-21T01:00:00Z'),
    'INVR-2026-002-0001': new Date('2026-09-01T01:00:00Z')
  }, new Date('2026-09-01T01:05:00Z'));

  assert.equal(state.currentResult, '미발견');
  assert.equal(state.currentLocationCode, 'LOC-001');
  assert.equal(state.lastPhysicalConfirmedBy, '김정훈');
});

test('unconfirmed record is excluded so a prior valid session remains authoritative', () => {
  const state = deriveCurrentState(asset, [
    {
      recordId: 'INVR-2026-001-0001', sessionId: 'INV-2026-001', result: '정상',
      physicalConfirmed: 'Y', confirmedLocationCode: 'LOC-001', confirmedFloor: '지하 1층',
      confirmedSpaceName: '창고 1', inspector: '김정훈'
    },
    {
      recordId: 'INVR-2026-002-0001', sessionId: 'INV-2026-002', result: '미확인',
      physicalConfirmed: 'N', inspector: '이건희'
    }
  ], {
    ...sessions,
    'INV-2026-002': { sessionId: 'INV-2026-002', name: '2026년 재조사 1차', category: '재조사', round: 1 }
  }, {
    'INVR-2026-001-0001': new Date('2026-08-21T01:00:00Z'),
    'INVR-2026-002-0001': new Date('2026-09-02T01:00:00Z')
  }, new Date('2026-09-02T01:05:00Z'));

  assert.equal(state.currentResult, '정상');
  assert.equal(state.evidenceRecordId, 'INVR-2026-001-0001');
});
```

- [ ] **Step 4: Implement the minimal reducer and baseline selector**

```javascript
function deriveCurrentState(asset, records, sessionsById, judgmentAtByRecordId, now) {
  var state = {
    systemId: asset.systemId,
    newAssetNo: asset.newAssetNo || '',
    name: asset.name || '',
    currentLocationCode: asset.locationCode || '',
    currentFloor: asset.floor || '',
    currentSpaceName: asset.spaceName || '',
    currentDetailLocation: asset.detailLocation || '',
    locationSource: '비품마스터',
    currentResult: '',
    latestSessionId: '',
    latestSessionName: '',
    latestSessionCategory: '',
    latestSessionRound: '',
    latestJudgedAt: '',
    latestJudgedBy: '',
    lastPhysicalConfirmedAt: '',
    lastPhysicalConfirmedBy: '',
    lastLocationChangedAt: '',
    lastLocationChangedBy: '',
    previousLocationCode: '',
    previousFloor: '',
    previousSpaceName: '',
    evidenceRecordId: '',
    masterApplied: 'N',
    syncStatus: '정상',
    syncError: '',
    version: 1,
    syncedAt: now
  };

  (records || []).filter(function (record) {
    return record && record.result && record.result !== '미확인';
  }).sort(function (a, b) {
    return new Date(judgmentAtByRecordId[a.recordId] || 0) - new Date(judgmentAtByRecordId[b.recordId] || 0);
  }).forEach(function (record) {
    var judgedAt = judgmentAtByRecordId[record.recordId] || '';
    var session = sessionsById[record.sessionId] || {};
    state.currentResult = record.result;
    state.latestSessionId = record.sessionId || '';
    state.latestSessionName = session.name || '';
    state.latestSessionCategory = session.category || '';
    state.latestSessionRound = session.round || '';
    state.latestJudgedAt = judgedAt;
    state.latestJudgedBy = record.inspector || '';
    state.evidenceRecordId = record.recordId || '';
    state.masterApplied = record.masterApplied || 'N';

    if (record.physicalConfirmed !== 'Y' || !record.confirmedLocationCode) return;
    if (state.currentLocationCode !== record.confirmedLocationCode) {
      state.previousLocationCode = state.currentLocationCode;
      state.previousFloor = state.currentFloor;
      state.previousSpaceName = state.currentSpaceName;
      state.lastLocationChangedAt = judgedAt;
      state.lastLocationChangedBy = record.inspector || '';
    }
    state.currentLocationCode = record.confirmedLocationCode;
    state.currentFloor = record.confirmedFloor || '';
    state.currentSpaceName = record.confirmedSpaceName || '';
    state.locationSource = '전수조사';
    state.lastPhysicalConfirmedAt = judgedAt;
    state.lastPhysicalConfirmedBy = record.inspector || '';
  });

  return state;
}

function selectInspectionBaseline(asset, currentState) {
  if (!currentState || currentState.syncStatus !== '정상' || !currentState.currentLocationCode) return asset;
  var copy = Object.assign({}, asset);
  copy.locationCode = currentState.currentLocationCode;
  copy.floor = currentState.currentFloor;
  copy.spaceName = currentState.currentSpaceName;
  copy.detailLocation = currentState.currentDetailLocation;
  return copy;
}
```

- [ ] **Step 5: Export the pure interfaces**

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    deriveCurrentState: deriveCurrentState,
    selectInspectionBaseline: selectInspectionBaseline
  };
}
```

- [ ] **Step 6: Run the focused tests and full suite**

Run: `node --test tests/current-state.test.js`

Expected: PASS.

Run: `npm test`

Expected: all existing tests plus current-state tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps-script/CurrentStateCore.js tests/current-state.test.js
git commit -m "feat: derive latest asset current state"
```

---

### Task 2: Add the idempotent three-sheet schema migration

**Files:**
- Create: `apps-script/SchemaSetup.gs`
- Create: `tests/schema-setup.test.js`
- Modify: `apps-script/Code.gs`
- Modify: `tests/syntax.test.js`

**Interfaces:**
- Consumes: the existing spreadsheet and `INVENTORY_CONFIG.SPREADSHEET_ID`.
- Produces: `installAssetQrSchema()` returning `{createdSheets, addedHeaders, seededSettings, assetCount}` and three sheets with exact headers/defaults.

- [ ] **Step 1: Write a failing source-contract test for exact sheet names and headers**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('apps-script/SchemaSetup.gs', 'utf8');

test('schema installer declares all three QR subsystem sheets', () => {
  assert.match(source, /비품현재상태/);
  assert.match(source, /QR발급관리/);
  assert.match(source, /라벨설정/);
  assert.match(source, /function installAssetQrSchema\(\)/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/schema-setup.test.js`

Expected: FAIL because `SchemaSetup.gs` does not exist.

- [ ] **Step 3: Add the exact schema constants**

```javascript
var CURRENT_STATE_HEADERS = [
  '영구 시스템 ID', 'New 비품번호', '품명', '현재위치코드', '현재층', '현재공간명',
  '현재세부위치', '위치출처', '현재조사결과', '최근조사세션ID', '최근조사명',
  '최근조사구분', '최근조사차수', '최근판정일시', '최근판정자', '마지막실물확인일시',
  '마지막실물확인자', '마지막위치변경일시', '마지막위치변경자', '이전위치코드',
  '이전층', '이전공간명', '근거기록ID', '마스터반영여부', '동기화상태',
  '동기화오류', '버전', '최종동기화일시'
];

var QR_ISSUE_HEADERS = [
  '영구 시스템 ID', 'QR접근키', 'QR접근키상태', 'QR조회URL', 'QR발급상태',
  '라벨유형', '라벨버전', '인쇄책임자 정', '인쇄책임자 부', '책임자버전',
  '라벨기준조사일', '최초발급일시', '최종출력일시', '재출력필요여부',
  '재출력사유', '재출력횟수', '최종출력배치ID', '비고'
];

var LABEL_SETTING_DEFAULTS = [
  ['기관명', '강서청소년회관'],
  ['라벨제목', '강서청소년회관 물품조사'],
  ['관리책임자 정', '김은영'],
  ['관리책임자 부', '김정훈'],
  ['책임자버전', 'RESP-2026-01'],
  ['책임자 적용시작일', ''],
  ['기본 조사일자', ''],
  ['QR 안내문구', '최신 위치·조사이력 확인'],
  ['기본 라벨규격', 'FORMTEC_LS3106'],
  ['상세조회배포URL', ''],
  ['라벨가로mm', '64'],
  ['라벨세로mm', '33.9'],
  ['페이지열수', '3'],
  ['페이지행수', '8'],
  ['페이지왼쪽여백mm', '6.5'],
  ['페이지위쪽여백mm', '12.5'],
  ['열간격mm', '2.5'],
  ['행간격mm', '0'],
  ['QR크기mm', '20'],
  ['가로보정mm', '0'],
  ['세로보정mm', '0'],
  ['열간격보정mm', '0'],
  ['행간격보정mm', '0'],
  ['인쇄배율', '100']
];
```

- [ ] **Step 4: Implement idempotent sheet/header/default creation**

```javascript
function installAssetQrSchema() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSpreadsheet_();
    var report = { createdSheets: [], addedHeaders: {}, seededSettings: [], assetCount: 0 };
    ensureSheetSchema_(ss, '비품현재상태', CURRENT_STATE_HEADERS, report);
    ensureSheetSchema_(ss, 'QR발급관리', QR_ISSUE_HEADERS, report);
    ensureSheetSchema_(ss, '라벨설정', ['설정항목', '설정값'], report);
    seedLabelSettings_(ss.getSheetByName('라벨설정'), report);
    ensureSessionMetadataHeaders_(ss.getSheetByName('전수조사세션'), report);
    report.assetCount = Math.max(0, ss.getSheetByName('비품마스터').getLastRow() - 1);
    return report;
  } finally {
    lock.releaseLock();
  }
}
```

`ensureSheetSchema_` must append missing headers only, preserve existing data, freeze row 1, and apply strict list validation to `동기화상태`, `QR접근키상태`, `QR발급상태`, `라벨유형`, and Y/N columns. `seedLabelSettings_` must insert only missing keys and preserve user-edited values.

- [ ] **Step 5: Add sheet names to `INVENTORY_CONFIG.SHEETS`**

```javascript
CURRENT_STATE: '비품현재상태',
QR_ISSUE: 'QR발급관리',
LABEL_SETTINGS: '라벨설정'
```

- [ ] **Step 6: Extend `전수조사세션` with multi-session metadata headers**

```javascript
var SESSION_METADATA_HEADERS = ['조사구분', '조사차수', '조사표기명', '조사목적'];
```

The installer appends only missing headers and does not rewrite existing session rows.

- [ ] **Step 7: Include new files in syntax tests and run tests**

Run: `node --test tests/schema-setup.test.js tests/syntax.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps-script/SchemaSetup.gs apps-script/Code.gs tests/schema-setup.test.js tests/syntax.test.js
git commit -m "feat: add QR subsystem sheet migration"
```

---

### Task 3: Implement sheet-backed single-asset and full rebuilds

**Files:**
- Create: `apps-script/CurrentState.gs`
- Create: `tests/current-state-source.test.js`
- Modify: `tests/syntax.test.js`

**Interfaces:**
- Consumes: `deriveCurrentState`, existing sheet helpers, asset/session/record/change-log rows.
- Produces: `rebuildCurrentStateForAsset_(systemId)`, `safeRebuildCurrentStateForAsset_(systemId)`, `rebuildAllCurrentStates()`, and `auditCurrentState()`.

- [ ] **Step 1: Write failing source-order tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('apps-script/CurrentState.gs', 'utf8');

test('current-state service exposes single and full rebuild entry points', () => {
  assert.match(source, /function rebuildCurrentStateForAsset_\(systemId\)/);
  assert.match(source, /function rebuildAllCurrentStates\(\)/);
  assert.match(source, /function auditCurrentState\(\)/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/current-state-source.test.js`

Expected: FAIL because `CurrentState.gs` does not exist.

- [ ] **Step 3: Implement exact-row readers**

Add helpers that use `TextFinder.matchEntireCell(true)` on the key columns:

```javascript
function findRowByExactValue_(sheet, header, target) {
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, [header], sheet.getName());
  if (sheet.getLastRow() <= 1) return null;
  var range = sheet.getRange(2, index[header] + 1, sheet.getLastRow() - 1, 1);
  var cell = range.createTextFinder(String(target)).matchEntireCell(true).findNext();
  if (!cell) return null;
  return {
    rowNumber: cell.getRow(),
    headers: headers,
    row: sheet.getRange(cell.getRow(), 1, 1, headers.length).getValues()[0]
  };
}
```

Add readers for one master asset, all records for one system ID, all sessions as a map, and relevant judgment change logs. Judgment timestamps include `정상확인`, `위치변경`, `상태이상`, `미발견`, `보류`, `판정수정`, and `작업취소`; ignore rows with `취소여부=Y`, missing action type, or missing record ID.

- [ ] **Step 4: Implement single-asset rebuild and upsert**

```javascript
function rebuildCurrentStateForAsset_(systemId) {
  assertText_(systemId, '영구 시스템 ID');
  var ss = getSpreadsheet_();
  var asset = readMasterAssetBySystemId_(ss, systemId);
  if (!asset) throw new Error('비품마스터에서 비품을 찾을 수 없습니다: ' + systemId);

  var sessionsById = readSessionMapForCurrentState_(ss);
  var records = readRecordsBySystemId_(ss, systemId);
  var judgmentAtByRecordId = readJudgmentTimesForRecords_(ss, records);
  var previous = readCurrentStateBySystemId_(ss, systemId);
  var state = deriveCurrentState(asset, records, sessionsById, judgmentAtByRecordId, new Date());
  state.version = Number(previous && previous.version || 0) + 1;
  upsertCurrentState_(ss, state);
  return serializeCurrentState_(state);
}
```

- [ ] **Step 5: Implement safe rebuild and explicit sync errors**

```javascript
function safeRebuildCurrentStateForAsset_(systemId) {
  try {
    return { ok: true, state: rebuildCurrentStateForAsset_(systemId), error: '' };
  } catch (error) {
    markCurrentStateSyncError_(systemId, String(error && error.message || error));
    return { ok: false, state: null, error: String(error && error.message || error) };
  }
}
```

`markCurrentStateSyncError_` must preserve the last valid location when a row exists and set only `동기화상태=오류`, `동기화오류`, `최종동기화일시`, and incremented `버전`.

- [ ] **Step 6: Implement full rebuild and audit**

```javascript
function rebuildAllCurrentStates() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var assets = readAssetMaster_(getRequiredSheet_(getSpreadsheet_(), '비품마스터'));
    var results = assets.map(function (asset) {
      return safeRebuildCurrentStateForAsset_(asset.systemId);
    });
    return {
      expected: assets.length,
      succeeded: results.filter(function (item) { return item.ok; }).length,
      failed: results.filter(function (item) { return !item.ok; }).map(function (item) { return item.error; })
    };
  } finally {
    lock.releaseLock();
  }
}
```

`auditCurrentState()` returns registered count, state count, duplicate IDs, missing IDs, extra IDs, sync-error IDs, and whether the expected 842 count matches.

- [ ] **Step 7: Run tests**

Run: `node --test tests/current-state.test.js tests/current-state-source.test.js tests/syntax.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps-script/CurrentState.gs tests/current-state-source.test.js tests/syntax.test.js
git commit -m "feat: rebuild sheet-backed asset current state"
```

---

### Task 4: Synchronize current state after all judgment mutations

**Files:**
- Modify: `apps-script/Inspection.gs`
- Modify: `apps-script/Code.gs`
- Modify: `tests/current-state-source.test.js`

**Interfaces:**
- Consumes: `safeRebuildCurrentStateForAsset_(systemId)`.
- Produces: every judgment response includes optional `currentStateSync: {ok, error}` without rolling back an already committed source judgment.

- [ ] **Step 1: Add failing source-order assertions**

```javascript
test('judgment endpoints rebuild current state after source record and audit log writes', () => {
  const inspection = fs.readFileSync('apps-script/Inspection.gs', 'utf8');
  for (const fn of ['applyInspectionActionFromMobile', 'reviseInspectionActionFromMobile', 'undoInspectionAction']) {
    const body = inspection.split(`function ${fn}(`)[1].split('\nfunction ')[0];
    assert.match(body, /safeRebuildCurrentStateForAsset_\(record\.systemId\)/);
    assert.ok(body.indexOf('appendChangeLog_') < body.indexOf('safeRebuildCurrentStateForAsset_'));
  }
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/current-state-source.test.js`

Expected: FAIL because the sync calls are absent.

- [ ] **Step 3: Add post-commit synchronization to initial judgment**

After `applySessionMetricDelta_` succeeds:

```javascript
var currentStateSync = safeRebuildCurrentStateForAsset_(record.systemId);
return buildInspectionResponse_(nextRecord, payload.sessionId, changeId, false, currentStateSync);
```

Extend `buildInspectionResponse_`:

```javascript
function buildInspectionResponse_(record, sessionId, changeId, duplicate, currentStateSync) {
  return {
    duplicate: !!duplicate,
    changeId: changeId || '',
    record: serializeRecord_(record),
    summary: getSessionSummary_(sessionId),
    currentStateSync: currentStateSync || null
  };
}
```

- [ ] **Step 4: Add the same post-commit synchronization to revision and Undo**

Use the restored or revised record's `systemId`. Do not call the rebuild for records with empty system ID or `대상구분=미등록비품`.

- [ ] **Step 5: Update the legacy `markAssetNormal` endpoint**

After its change log and session metric update:

```javascript
var currentStateSync = safeRebuildCurrentStateForAsset_(record.systemId);
return {
  duplicate: false,
  record: serializeRecord_(record),
  summary: getSessionSummary_(payload.sessionId),
  currentStateSync: currentStateSync
};
```

- [ ] **Step 6: Confirm photo upload remains excluded**

Add a source test that `uploadInventoryPhoto` in `FieldOps.gs` does not call `safeRebuildCurrentStateForAsset_`.

- [ ] **Step 7: Run tests**

Run: `node --test tests/current-state-source.test.js tests/inspection-actions.test.js tests/field-ops.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps-script/Inspection.gs apps-script/Code.gs tests/current-state-source.test.js
git commit -m "feat: sync current state after inspection judgments"
```

---

### Task 5: Support multiple annual sessions and current-state baselines

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `apps-script/Index.html`
- Modify: `apps-script/CurrentStateCore.js`
- Modify: `tests/core.test.js`
- Modify: `tests/current-state.test.js`

**Interfaces:**
- Consumes: `selectInspectionBaseline(asset, currentState)` and installed session metadata headers.
- Produces: backward-compatible `startInventorySession(request)` where `request` can be a string inspector or `{inspector, category, round, displayName, purpose}`.

- [ ] **Step 1: Write failing tests for request normalization and baseline fallback**

```javascript
test('string session start remains a first-round regular inspection', () => {
  const result = normalizeSessionStartRequest('이건희', 2026);
  assert.equal(result.inspector, '이건희');
  assert.equal(result.category, '정기');
  assert.equal(result.round, 1);
  assert.equal(result.displayName, '2026년 정기 전수조사 1차');
});

test('current state overrides official location only when sync is normal', () => {
  const baseline = selectInspectionBaseline(asset, {
    syncStatus: '정상', currentLocationCode: 'LOC-019', currentFloor: '1층', currentSpaceName: '로비'
  });
  assert.equal(baseline.locationCode, 'LOC-019');
  assert.equal(selectInspectionBaseline(asset, { syncStatus: '오류', currentLocationCode: 'LOC-019' }).locationCode, 'LOC-001');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/core.test.js tests/current-state.test.js`

Expected: FAIL because request normalization is missing.

- [ ] **Step 3: Implement backward-compatible request normalization**

```javascript
function normalizeSessionStartRequest(request, year) {
  var input = typeof request === 'string' ? { inspector: request } : (request || {});
  var category = String(input.category || '정기').trim();
  var round = Math.max(1, Number(input.round || 1));
  return {
    inspector: String(input.inspector || '').trim(),
    category: category,
    round: round,
    displayName: String(input.displayName || (year + '년 ' + category + ' 전수조사 ' + round + '차')).trim(),
    purpose: String(input.purpose || (category === '정기' ? '연간 정기 전수조사' : category + ' 조사')).trim()
  };
}
```

Export it from `Core.js` or place it in `CurrentStateCore.js` and export it for tests.

- [ ] **Step 4: Write session metadata and build records from current-state locations**

In `startInventorySession`:

```javascript
var sessionRequest = normalizeSessionStartRequest(request, year);
var currentStateMap = readCurrentStateMap_();
var baselineAssets = assets.map(function (asset) {
  return selectInspectionBaseline(asset, currentStateMap[asset.systemId]);
});
var records = buildInventoryRecords(sessionId, baselineAssets, errorMap);
```

Write these session fields:

```javascript
'조사명': sessionRequest.displayName,
'조사유형': sessionRequest.category,
'조사구분': sessionRequest.category,
'조사차수': sessionRequest.round,
'조사표기명': sessionRequest.displayName,
'조사목적': sessionRequest.purpose,
'생성자': normalizeInspector_(sessionRequest.inspector)
```

- [ ] **Step 5: Add new-session fields to the inactive-session home UI**

When no session is active, show:

```html
<select id="session-category">
  <option value="정기">정기</option>
  <option value="수시">수시</option>
  <option value="특별">특별</option>
  <option value="재조사">재조사</option>
</select>
<input id="session-round" type="number" min="1" value="1">
<input id="session-display-name" type="text">
<textarea id="session-purpose"></textarea>
```

The existing active-session `현재 조사자` field and continuation flow must remain unchanged.

- [ ] **Step 6: Run tests**

Run: `node --test tests/core.test.js tests/current-state.test.js tests/syntax.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps-script/Code.gs apps-script/Index.html apps-script/CurrentStateCore.js tests/core.test.js tests/current-state.test.js
git commit -m "feat: start repeated inspections from current locations"
```

---

### Task 6: Add repair/audit operations and one-time migration documentation

**Files:**
- Modify: `apps-script/CurrentState.gs`
- Modify: `README.md`
- Modify: `tests/current-state-source.test.js`

**Interfaces:**
- Consumes: all current-state rebuild interfaces.
- Produces: administrator-callable `repairCurrentState(systemId)` and `auditCurrentState()` with explicit reports.

- [ ] **Step 1: Write failing contract tests**

```javascript
test('repair endpoint requires a system id and delegates to a locked rebuild', () => {
  const source = fs.readFileSync('apps-script/CurrentState.gs', 'utf8');
  assert.match(source, /function repairCurrentState\(systemId\)/);
  assert.match(source, /LockService\.getScriptLock\(\)/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/current-state-source.test.js`

Expected: FAIL because `repairCurrentState` is missing.

- [ ] **Step 3: Implement the repair entry point**

```javascript
function repairCurrentState(systemId) {
  assertText_(systemId, '영구 시스템 ID');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return rebuildCurrentStateForAsset_(systemId);
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 4: Document exact Apps Script file mappings and run order**

Add to `README.md`:

```text
apps-script/CurrentStateCore.js → CurrentStateCore.gs
apps-script/CurrentState.gs     → CurrentState.gs
apps-script/SchemaSetup.gs       → SchemaSetup.gs

One-time order:
1. Replace/save all source files.
2. Run installAssetQrSchema().
3. Confirm assetCount=842.
4. Run rebuildAllCurrentStates().
5. Run auditCurrentState().
6. Deploy a new version of the existing web app.
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: all tests pass, including syntax checks for every Apps Script server file and the mobile client.

- [ ] **Step 6: Commit**

```bash
git add apps-script/CurrentState.gs README.md tests/current-state-source.test.js
git commit -m "docs: add current-state repair and migration workflow"
```

---

### Task 7: Execute the data migration and verify the 842-row foundation

**Files:**
- No source changes expected unless verification reveals a reproducible defect.
- Evidence update: `docs/superpowers/plans/2026-08-21-asset-current-state-foundation.md` or a PR comment with exact results.

**Interfaces:**
- Consumes: deployed schema and rebuild functions.
- Produces: three new sheets, 842 valid current-state rows, and an audit report with no duplicates or missing IDs.

- [ ] **Step 1: Copy the new Apps Script files and deploy a test version**

Copy the exact mappings in Task 6, save, and use `배포 → 테스트 배포` before updating `/exec`.

- [ ] **Step 2: Run the schema migration**

Run from the Apps Script editor: `installAssetQrSchema()`.

Expected result:

```json
{
  "assetCount": 842,
  "createdSheets": ["비품현재상태", "QR발급관리", "라벨설정"]
}
```

If a sheet already exists, it may be absent from `createdSheets`; the final headers/defaults must still match.

- [ ] **Step 3: Run the full current-state rebuild**

Run: `rebuildAllCurrentStates()`.

Expected: `expected=842`, `succeeded=842`, `failed=[]`.

- [ ] **Step 4: Run the audit**

Run: `auditCurrentState()`.

Expected:

```json
{
  "registeredCount": 842,
  "stateCount": 842,
  "duplicateSystemIds": [],
  "missingSystemIds": [],
  "extraSystemIds": [],
  "syncErrorSystemIds": [],
  "countMatchesExpected": true
}
```

- [ ] **Step 5: Verify five rule examples in the sheet**

Select one record for each current result: 정상, 위치변경, 상태이상, 미발견, and a record restored to 미확인. Confirm the derived locations and dates follow Tasks 1 and 3.

- [ ] **Step 6: Verify mutation synchronization in `/dev`**

Perform one normal confirmation, one location change, one revision, and one Undo. Confirm each response has `currentStateSync.ok=true` and the corresponding `비품현재상태` row increments its version.

- [ ] **Step 7: Update the production deployment**

Use `배포 → 배포 관리 → 현재 웹 앱 수정 → 새 버전` so the existing `/exec` URL remains unchanged.

- [ ] **Step 8: Record evidence**

Record exact counts, five sampled system IDs, and mutation results in PR #1 or a dedicated follow-up PR. Do not claim completion until the evidence shows 842/842 and zero sync errors.
