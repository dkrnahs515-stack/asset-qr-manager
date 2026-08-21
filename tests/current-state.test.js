const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveCurrentState,
  selectInspectionBaseline
} = require('../apps-script/CurrentStateCore.js');

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
  },
  'INV-2026-002': {
    sessionId: 'INV-2026-002',
    name: '2026년 수시 위치점검 1차',
    category: '수시',
    round: 1
  }
};

function at(value) {
  return new Date(value);
}

test('normal confirmation updates physical confirmation without inventing a location change', () => {
  const state = deriveCurrentState(asset, [{
    recordId: 'INVR-2026-001-0001',
    sessionId: 'INV-2026-001',
    result: '정상',
    physicalConfirmed: 'Y',
    confirmedLocationCode: 'LOC-001',
    confirmedFloor: '지하 1층',
    confirmedSpaceName: '창고 1',
    inspector: '이건희',
    masterApplied: 'N'
  }], sessions, {
    'INVR-2026-001-0001': at('2026-08-21T01:00:00Z')
  }, at('2026-08-21T01:05:00Z'));

  assert.equal(state.currentLocationCode, 'LOC-001');
  assert.equal(state.currentResult, '정상');
  assert.equal(state.lastPhysicalConfirmedBy, '이건희');
  assert.equal(state.lastLocationChangedAt, '');
  assert.equal(state.evidenceRecordId, 'INVR-2026-001-0001');
  assert.equal(state.latestSessionName, '2026년 정기 전수조사 1차');
});

test('location change preserves prior location and records the change time', () => {
  const judgedAt = at('2026-08-21T02:00:00Z');
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
    'INVR-2026-001-0001': judgedAt
  }, at('2026-08-21T02:05:00Z'));

  assert.equal(state.currentLocationCode, 'LOC-019');
  assert.equal(state.previousLocationCode, 'LOC-001');
  assert.equal(state.previousFloor, '지하 1층');
  assert.equal(state.previousSpaceName, '창고 1');
  assert.equal(state.lastLocationChangedAt, judgedAt);
  assert.equal(state.lastLocationChangedBy, '이건희');
  assert.equal(state.locationSource, '전수조사');
});

test('state issue at another location updates physical and location evidence', () => {
  const judgedAt = at('2026-08-21T03:00:00Z');
  const state = deriveCurrentState(asset, [{
    recordId: 'INVR-2026-001-0001',
    sessionId: 'INV-2026-001',
    result: '상태이상',
    issueType: '고장',
    physicalConfirmed: 'Y',
    confirmedLocationCode: 'LOC-019',
    confirmedFloor: '1층',
    confirmedSpaceName: '로비',
    inspector: '김정훈'
  }], sessions, {
    'INVR-2026-001-0001': judgedAt
  }, at('2026-08-21T03:05:00Z'));

  assert.equal(state.currentResult, '상태이상');
  assert.equal(state.currentLocationCode, 'LOC-019');
  assert.equal(state.lastPhysicalConfirmedAt, judgedAt);
  assert.equal(state.lastPhysicalConfirmedBy, '김정훈');
  assert.equal(state.lastLocationChangedAt, judgedAt);
});

test('missing keeps the latest physically confirmed location', () => {
  const firstAt = at('2026-08-21T01:00:00Z');
  const missingAt = at('2026-09-01T01:00:00Z');
  const state = deriveCurrentState(asset, [
    {
      recordId: 'INVR-2026-001-0001',
      sessionId: 'INV-2026-001',
      result: '위치변경',
      physicalConfirmed: 'Y',
      confirmedLocationCode: 'LOC-019',
      confirmedFloor: '1층',
      confirmedSpaceName: '로비',
      inspector: '김정훈'
    },
    {
      recordId: 'INVR-2026-002-0001',
      sessionId: 'INV-2026-002',
      result: '미발견',
      physicalConfirmed: 'N',
      confirmedLocationCode: '',
      confirmedFloor: '',
      confirmedSpaceName: '',
      inspector: '이건희'
    }
  ], sessions, {
    'INVR-2026-001-0001': firstAt,
    'INVR-2026-002-0001': missingAt
  }, at('2026-09-01T01:05:00Z'));

  assert.equal(state.currentResult, '미발견');
  assert.equal(state.currentLocationCode, 'LOC-019');
  assert.equal(state.lastPhysicalConfirmedAt, firstAt);
  assert.equal(state.lastPhysicalConfirmedBy, '김정훈');
  assert.equal(state.latestJudgedAt, missingAt);
  assert.equal(state.latestJudgedBy, '이건희');
});

test('unconfirmed record is excluded so a prior valid session remains authoritative', () => {
  const state = deriveCurrentState(asset, [
    {
      recordId: 'INVR-2026-001-0001',
      sessionId: 'INV-2026-001',
      result: '정상',
      physicalConfirmed: 'Y',
      confirmedLocationCode: 'LOC-001',
      confirmedFloor: '지하 1층',
      confirmedSpaceName: '창고 1',
      inspector: '김정훈'
    },
    {
      recordId: 'INVR-2026-002-0001',
      sessionId: 'INV-2026-002',
      result: '미확인',
      physicalConfirmed: 'N',
      inspector: '이건희'
    }
  ], sessions, {
    'INVR-2026-001-0001': at('2026-08-21T01:00:00Z'),
    'INVR-2026-002-0001': at('2026-09-02T01:00:00Z')
  }, at('2026-09-02T01:05:00Z'));

  assert.equal(state.currentResult, '정상');
  assert.equal(state.evidenceRecordId, 'INVR-2026-001-0001');
});

test('records are reduced by judgment time rather than input order', () => {
  const earlier = {
    recordId: 'INVR-2026-001-0001',
    sessionId: 'INV-2026-001',
    result: '정상',
    physicalConfirmed: 'Y',
    confirmedLocationCode: 'LOC-001',
    confirmedFloor: '지하 1층',
    confirmedSpaceName: '창고 1',
    inspector: '김정훈'
  };
  const later = {
    recordId: 'INVR-2026-002-0001',
    sessionId: 'INV-2026-002',
    result: '위치변경',
    physicalConfirmed: 'Y',
    confirmedLocationCode: 'LOC-019',
    confirmedFloor: '1층',
    confirmedSpaceName: '로비',
    inspector: '이건희'
  };

  const state = deriveCurrentState(asset, [later, earlier], sessions, {
    [earlier.recordId]: at('2026-08-21T01:00:00Z'),
    [later.recordId]: at('2026-09-01T01:00:00Z')
  }, at('2026-09-01T01:05:00Z'));

  assert.equal(state.currentLocationCode, 'LOC-019');
  assert.equal(state.currentResult, '위치변경');
  assert.equal(state.previousLocationCode, 'LOC-001');
});

test('baseline uses current state only when synchronization is healthy', () => {
  const baseline = selectInspectionBaseline(asset, {
    syncStatus: '정상',
    currentLocationCode: 'LOC-019',
    currentFloor: '1층',
    currentSpaceName: '로비',
    currentDetailLocation: '안내데스크 옆'
  });

  assert.notEqual(baseline, asset);
  assert.equal(baseline.locationCode, 'LOC-019');
  assert.equal(baseline.floor, '1층');
  assert.equal(baseline.spaceName, '로비');
  assert.equal(baseline.detailLocation, '안내데스크 옆');
  assert.equal(asset.locationCode, 'LOC-001');

  assert.equal(
    selectInspectionBaseline(asset, {
      syncStatus: '오류',
      currentLocationCode: 'LOC-019'
    }),
    asset
  );
});
