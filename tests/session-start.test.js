const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  normalizeSessionStartRequest,
  selectInspectionBaseline
} = require('../apps-script/CurrentStateCore.js');

const asset = {
  systemId: 'GSYC-000001',
  locationCode: 'LOC-001',
  floor: '지하 1층',
  spaceName: '창고 1',
  detailLocation: ''
};

test('string session start remains backward-compatible regular inspection round one', () => {
  const result = normalizeSessionStartRequest('이건희', 2026);
  assert.deepEqual(result, {
    inspector: '이건희',
    category: '정기',
    round: 1,
    displayName: '2026년 정기 전수조사 1차',
    purpose: '연간 정기 전수조사'
  });
});

test('object session start preserves approved repeated-session metadata', () => {
  const result = normalizeSessionStartRequest({
    inspector: '김정훈',
    category: '수시',
    round: 2,
    displayName: '2026년 수시 위치점검 2차',
    purpose: '하반기 이동 비품 위치 확인'
  }, 2026);

  assert.equal(result.inspector, '김정훈');
  assert.equal(result.category, '수시');
  assert.equal(result.round, 2);
  assert.equal(result.displayName, '2026년 수시 위치점검 2차');
  assert.equal(result.purpose, '하반기 이동 비품 위치 확인');
});

test('invalid or fractional rounds normalize to a positive integer', () => {
  assert.equal(normalizeSessionStartRequest({ inspector: '이건희', round: 0 }, 2026).round, 1);
  assert.equal(normalizeSessionStartRequest({ inspector: '이건희', round: 2.9 }, 2026).round, 2);
  assert.equal(normalizeSessionStartRequest({ inspector: '이건희', round: 'abc' }, 2026).round, 1);
});

test('current state overrides official location only when synchronization is healthy', () => {
  const baseline = selectInspectionBaseline(asset, {
    syncStatus: '정상',
    currentLocationCode: 'LOC-019',
    currentFloor: '1층',
    currentSpaceName: '로비',
    currentDetailLocation: '안내데스크 옆'
  });
  assert.equal(baseline.locationCode, 'LOC-019');
  assert.equal(baseline.floor, '1층');
  assert.equal(baseline.spaceName, '로비');
  assert.equal(
    selectInspectionBaseline(asset, { syncStatus: '오류', currentLocationCode: 'LOC-019' }).locationCode,
    'LOC-001'
  );
});

test('server starts sessions from current-state baselines and writes all session metadata', () => {
  const source = fs.readFileSync('apps-script/Code.gs', 'utf8');
  const body = source.split('function startInventorySession(')[1].split('\nfunction ')[0];
  assert.match(source, /function startInventorySession\(request\)/);
  assert.match(body, /normalizeSessionStartRequest\(request, year\)/);
  assert.match(body, /readCurrentStateMap_\(ss\)/);
  assert.match(body, /selectInspectionBaseline\(asset, currentStateMap\[asset\.systemId\]\)/);
  for (const field of ['조사구분', '조사차수', '조사표기명', '조사목적']) {
    assert.ok(body.includes(`'${field}'`), `missing session field: ${field}`);
  }
  assert.match(body, /buildInventoryRecords\(sessionId, baselineAssets, errorMap\)/);

  const baselineAt = body.indexOf('readCurrentStateMap_(ss)');
  const sessionWriteAt = body.indexOf('sessionSheet.getRange(sessionSheet.getLastRow() + 1');
  assert.ok(baselineAt >= 0 && sessionWriteAt >= 0 && baselineAt < sessionWriteAt,
    'current-state baseline validation must finish before the prepared session row is persisted');
});

test('inactive-session home captures repeated-session metadata while active inspector flow remains', () => {
  const source = fs.readFileSync('apps-script/Index.html', 'utf8');
  for (const id of ['session-category', 'session-round', 'session-display-name', 'session-purpose']) {
    assert.ok(source.includes(`id="${id}"`), `missing UI field: ${id}`);
  }
  assert.match(source, /<option value="정기">정기<\/option>/);
  assert.match(source, /<option value="수시">수시<\/option>/);
  assert.match(source, /<option value="특별">특별<\/option>/);
  assert.match(source, /<option value="재조사">재조사<\/option>/);
  assert.match(source, /startInventorySession\(request\)/);
  assert.match(source, /api\.startInventorySession\(\{inspector:/);
  assert.match(source, /현재 조사자 \*/);
  assert.match(source, /onContinue=/);
});
