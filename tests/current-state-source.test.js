const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function functionBody(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing function ${name}`);
  const tail = source.slice(start + marker.length);
  const next = tail.indexOf('\nfunction ');
  return next >= 0 ? tail.slice(0, next) : tail;
}

test('current-state service exposes single, safe, full rebuild, and audit entry points', () => {
  const source = read('apps-script/CurrentState.gs');
  assert.match(source, /function rebuildCurrentStateForAsset_\(systemId\)/);
  assert.match(source, /function safeRebuildCurrentStateForAsset_\(systemId\)/);
  assert.match(source, /function rebuildAllCurrentStates\(\)/);
  assert.match(source, /function auditCurrentState\(\)/);
});

test('sheet lookups use exact key matching and current-state upsert is keyed by permanent system ID', () => {
  const source = read('apps-script/CurrentState.gs');
  assert.match(source, /function findRowByExactValue_\(/);
  assert.match(source, /createTextFinder\(String\(target\)\)\.matchEntireCell\(true\)/);
  assert.match(source, /function upsertCurrentState_\(/);
  assert.match(source, /'영구 시스템 ID'/);
});

test('judgment timestamps ignore invalid and cancelled logs but include revision and undo', () => {
  const source = read('apps-script/CurrentState.gs');
  for (const action of ['정상확인', '위치변경', '상태이상', '미발견', '보류', '판정수정', '작업취소']) {
    assert.ok(source.includes(`'${action}'`), `missing judgment action: ${action}`);
  }
  assert.match(source, /cancelled === 'Y'/);
  assert.match(source, /if \(!recordId \|\| !actionType\) return/);
});

test('safe rebuild preserves source data and records an explicit derived-state sync error', () => {
  const source = read('apps-script/CurrentState.gs');
  const body = functionBody(source, 'safeRebuildCurrentStateForAsset_');
  assert.match(body, /rebuildCurrentStateForAsset_\(systemId\)/);
  assert.match(body, /markCurrentStateSyncError_\(systemId/);
  assert.match(body, /ok: false/);

  const errorBody = functionBody(source, 'markCurrentStateSyncError_');
  assert.match(errorBody, /syncStatus = '오류'/);
  assert.match(errorBody, /syncError/);
  assert.doesNotMatch(errorBody, /deleteRow\(/);
});

test('full rebuild and repair-grade audit are locked and report all integrity classes', () => {
  const source = read('apps-script/CurrentState.gs');
  const rebuild = functionBody(source, 'rebuildAllCurrentStates');
  assert.match(rebuild, /LockService\.getScriptLock\(\)/);
  assert.match(rebuild, /expected/);
  assert.match(rebuild, /succeeded/);
  assert.match(rebuild, /failed/);

  const audit = functionBody(source, 'auditCurrentState');
  for (const field of ['registeredCount', 'stateCount', 'duplicateIds', 'missingIds', 'extraIds', 'syncErrorIds', 'expectedCountMatches']) {
    assert.ok(audit.includes(field), `audit report missing: ${field}`);
  }
});

test('all inspection judgment mutations rebuild derived state only after source and audit writes', () => {
  const inspection = read('apps-script/Inspection.gs');
  for (const name of ['applyInspectionActionFromMobile', 'reviseInspectionActionFromMobile', 'undoInspectionAction']) {
    const body = functionBody(inspection, name);
    assert.match(body, /safeRebuildCurrentStateForAsset_\((?:record|nextRecord|restored)\.systemId\)/, `${name} must rebuild current state`);
    const logAt = body.lastIndexOf('appendChangeLog_');
    const metricAt = body.lastIndexOf('applySessionMetricDelta_');
    const syncAt = body.lastIndexOf('safeRebuildCurrentStateForAsset_');
    assert.ok(logAt >= 0 && metricAt >= 0 && syncAt > logAt && syncAt > metricAt,
      `${name} must synchronize only after change-log and metric writes`);
  }
});

test('inspection responses expose non-rolling-back current-state sync status', () => {
  const inspection = read('apps-script/Inspection.gs');
  const body = functionBody(inspection, 'buildInspectionResponse_');
  assert.match(inspection, /function buildInspectionResponse_\(record, sessionId, changeId, duplicate, currentStateSync\)/);
  assert.match(body, /currentStateSync:\s*currentStateSync \|\| null/);
});

test('legacy normal endpoint synchronizes after its audit and metric writes', () => {
  const code = read('apps-script/Code.gs');
  const body = functionBody(code, 'markAssetNormal');
  const logAt = body.lastIndexOf('appendChangeLog_');
  const metricAt = body.lastIndexOf('applySessionMetricDelta_');
  const syncAt = body.lastIndexOf('safeRebuildCurrentStateForAsset_');
  assert.ok(logAt >= 0 && metricAt >= 0 && syncAt > logAt && syncAt > metricAt);
  assert.match(body, /currentStateSync:\s*currentStateSync/);
});

test('photo-only evidence does not change judgment-derived current state', () => {
  const fieldOps = read('apps-script/FieldOps.gs');
  const uploadBody = functionBody(fieldOps, 'uploadInventoryPhoto');
  assert.doesNotMatch(uploadBody, /safeRebuildCurrentStateForAsset_/);
});

test('repair endpoint validates one asset and performs a locked rebuild', () => {
  const source = read('apps-script/CurrentState.gs');
  assert.match(source, /function repairCurrentState\(systemId\)/);
  const body = functionBody(source, 'repairCurrentState');
  assert.match(body, /assertText_\(systemId, '영구 시스템 ID'\)/);
  assert.match(body, /LockService\.getScriptLock\(\)/);
  assert.match(body, /lock\.waitLock\(30000\)/);
  assert.match(body, /return rebuildCurrentStateForAsset_\(systemId\)/);
  assert.match(body, /lock\.releaseLock\(\)/);
});

test('README documents exact Apps Script mappings and one-time migration order', () => {
  const readme = read('README.md');
  for (const mapping of [
    'apps-script/CurrentStateCore.js → CurrentStateCore.gs',
    'apps-script/CurrentState.gs → CurrentState.gs',
    'apps-script/SchemaSetup.gs → SchemaSetup.gs'
  ]) assert.ok(readme.includes(mapping), `missing mapping: ${mapping}`);

  const ordered = [
    'installAssetQrSchema()',
    'assetCount=842',
    'rebuildAllCurrentStates()',
    'auditCurrentState()',
    '기존 웹 앱을 새 버전으로 배포'
  ];
  let previous = -1;
  for (const marker of ordered) {
    const index = readme.indexOf(marker);
    assert.ok(index > previous, `migration marker is missing or out of order: ${marker}`);
    previous = index;
  }
  assert.match(readme, /운영 시트에 적용하기 전에 백업 또는 테스트 사본에서 먼저 실행/);
});

test('CurrentState.gs participates in server syntax verification', () => {
  const syntax = read('tests/syntax.test.js');
  assert.match(syntax, /apps-script\/CurrentState\.gs/);
});
