const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
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
  const body = source.split('function safeRebuildCurrentStateForAsset_(')[1].split('\nfunction ')[0];
  assert.match(body, /rebuildCurrentStateForAsset_\(systemId\)/);
  assert.match(body, /markCurrentStateSyncError_\(systemId/);
  assert.match(body, /ok: false/);

  const errorBody = source.split('function markCurrentStateSyncError_(')[1].split('\nfunction ')[0];
  assert.match(errorBody, /syncStatus = '오류'/);
  assert.match(errorBody, /syncError/);
  assert.doesNotMatch(errorBody, /deleteRow\(/);
});

test('full rebuild and repair-grade audit are locked and report all integrity classes', () => {
  const source = read('apps-script/CurrentState.gs');
  const rebuild = source.split('function rebuildAllCurrentStates()')[1].split('\nfunction ')[0];
  assert.match(rebuild, /LockService\.getScriptLock\(\)/);
  assert.match(rebuild, /expected/);
  assert.match(rebuild, /succeeded/);
  assert.match(rebuild, /failed/);

  const audit = source.split('function auditCurrentState()')[1].split('\nfunction ')[0];
  for (const field of ['registeredCount', 'stateCount', 'duplicateIds', 'missingIds', 'extraIds', 'syncErrorIds', 'expectedCountMatches']) {
    assert.ok(audit.includes(field), `audit report missing: ${field}`);
  }
});

test('CurrentState.gs participates in server syntax verification', () => {
  const syntax = read('tests/syntax.test.js');
  assert.match(syntax, /apps-script\/CurrentState\.gs/);
});
