const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyInspectionAction,
  createInspectionSnapshot,
  restoreInspectionSnapshot
} = require('../apps-script/Core.js');

function baseRecord() {
  return {
    recordId: 'INVR-2026-001-0001',
    sessionId: 'INV-2026-001',
    targetType: '등록비품',
    systemId: 'GSYC-000001',
    originalLocationCode: 'LOC-001',
    originalFloor: '지하 1층',
    originalSpaceName: '창고 1',
    confirmedLocationCode: '',
    confirmedFloor: '',
    confirmedSpaceName: '',
    result: '미확인',
    issueType: '',
    physicalConfirmed: 'N',
    locationMatches: '',
    labelStatus: '',
    fieldMemo: '',
    inspector: '',
    firstInspectedAt: '',
    lastModifiedAt: '',
    version: 0,
    lastActionUuid: ''
  };
}

test('location change records the found location and marks the item completed', () => {
  const record = applyInspectionAction(baseRecord(), {
    type: '위치변경',
    locationCode: 'LOC-024',
    floor: '2층',
    spaceName: '204호 (피아노실)',
    memo: '피아노실에서 발견',
    inspector: '이건희',
    actionUuid: 'act-location',
    now: '2026-08-19T08:00:00.000Z'
  });

  assert.equal(record.result, '위치변경');
  assert.equal(record.confirmedLocationCode, 'LOC-024');
  assert.equal(record.confirmedFloor, '2층');
  assert.equal(record.confirmedSpaceName, '204호 (피아노실)');
  assert.equal(record.physicalConfirmed, 'Y');
  assert.equal(record.locationMatches, 'N');
  assert.equal(record.fieldMemo, '피아노실에서 발견');
  assert.equal(record.version, 1);
});

test('issue action keeps the physical location and stores the issue type', () => {
  const record = applyInspectionAction(baseRecord(), {
    type: '상태이상',
    issueType: '파손',
    locationCode: 'LOC-001',
    floor: '지하 1층',
    spaceName: '창고 1',
    memo: '다리 파손',
    inspector: '이건희',
    actionUuid: 'act-issue',
    now: '2026-08-19T08:01:00.000Z'
  });

  assert.equal(record.result, '상태이상');
  assert.equal(record.issueType, '파손');
  assert.equal(record.physicalConfirmed, 'Y');
  assert.equal(record.locationMatches, 'Y');
  assert.equal(record.confirmedLocationCode, 'LOC-001');
  assert.equal(record.fieldMemo, '다리 파손');
});

test('missing action does not mark a physical location as confirmed', () => {
  const record = applyInspectionAction(baseRecord(), {
    type: '미발견',
    memo: '공간 전체 확인 후 미발견',
    inspector: '이건희',
    actionUuid: 'act-missing',
    now: '2026-08-19T08:02:00.000Z'
  });

  assert.equal(record.result, '미발견');
  assert.equal(record.physicalConfirmed, 'N');
  assert.equal(record.confirmedLocationCode, '');
  assert.equal(record.locationMatches, '');
  assert.equal(record.fieldMemo, '공간 전체 확인 후 미발견');
});

test('undo restores the inspection fields from the pre-action snapshot without rolling back the audit version', () => {
  const before = baseRecord();
  const snapshot = createInspectionSnapshot(before);
  const changed = applyInspectionAction(before, {
    type: '위치변경',
    locationCode: 'LOC-024',
    floor: '2층',
    spaceName: '204호 (피아노실)',
    inspector: '이건희',
    actionUuid: 'act-change',
    now: '2026-08-19T08:03:00.000Z'
  });

  const restored = restoreInspectionSnapshot(changed, snapshot, {
    inspector: '이건희',
    actionUuid: 'act-undo',
    now: '2026-08-19T08:04:00.000Z'
  });

  assert.equal(restored.result, '미확인');
  assert.equal(restored.confirmedLocationCode, '');
  assert.equal(restored.physicalConfirmed, 'N');
  assert.equal(restored.locationMatches, '');
  assert.equal(restored.version, 2);
  assert.equal(restored.lastActionUuid, 'act-undo');
});

test('inspection action rejects transitions from an already processed record', () => {
  const processed = { ...baseRecord(), result: '정상' };
  assert.throws(() => applyInspectionAction(processed, {
    type: '미발견',
    inspector: '이건희',
    actionUuid: 'act-invalid',
    now: '2026-08-19T08:05:00.000Z'
  }), /미확인 상태/);
});
