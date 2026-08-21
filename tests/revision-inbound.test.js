const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  reviseInspectionAction,
  buildRoomDisplayRecords
} = require('../apps-script/Core.js');

function completedRecord(overrides = {}) {
  return {
    recordId: 'INVR-2026-001-0001',
    sessionId: 'INV-2026-001',
    targetType: '등록비품',
    systemId: 'GSYC-000001',
    originalLocationCode: 'LOC-B1',
    originalFloor: '지하 1층',
    originalSpaceName: '창고 1',
    confirmedLocationCode: 'LOC-B1',
    confirmedFloor: '지하 1층',
    confirmedSpaceName: '창고 1',
    result: '정상',
    issueType: '',
    physicalConfirmed: 'Y',
    locationMatches: 'Y',
    labelStatus: '정상',
    fieldMemo: '',
    inspector: '기존조사자',
    firstInspectedAt: '2026-08-20T08:00:00.000Z',
    lastModifiedAt: '2026-08-20T08:00:00.000Z',
    photoCount: 0,
    version: 1,
    lastActionUuid: 'old-action',
    ...overrides
  };
}

test('a completed normal item can be revised to a different confirmed location', () => {
  const revised = reviseInspectionAction(completedRecord(), {
    type: '위치변경',
    locationCode: 'LOC-LOBBY',
    floor: '1층',
    spaceName: '로비',
    memo: '정상 처리 후 로비에서 재확인',
    inspector: '수정자',
    actionUuid: 'revise-location',
    now: '2026-08-20T09:00:00.000Z'
  });

  assert.equal(revised.result, '위치변경');
  assert.equal(revised.confirmedLocationCode, 'LOC-LOBBY');
  assert.equal(revised.confirmedFloor, '1층');
  assert.equal(revised.confirmedSpaceName, '로비');
  assert.equal(revised.locationMatches, 'N');
  assert.equal(revised.inspector, '수정자');
  assert.equal(revised.firstInspectedAt, '2026-08-20T08:00:00.000Z');
  assert.equal(revised.version, 2);
});

test('a completed item can be returned to unconfirmed while preserving audit progression', () => {
  const revised = reviseInspectionAction(completedRecord(), {
    type: '미확인복원',
    memo: '현장 재확인 필요',
    inspector: '수정자',
    actionUuid: 'revise-reset',
    now: '2026-08-20T09:05:00.000Z'
  });

  assert.equal(revised.result, '미확인');
  assert.equal(revised.confirmedLocationCode, '');
  assert.equal(revised.confirmedFloor, '');
  assert.equal(revised.confirmedSpaceName, '');
  assert.equal(revised.physicalConfirmed, 'N');
  assert.equal(revised.locationMatches, '');
  assert.equal(revised.version, 2);
});

test('revision requires a reason so completed decisions are not silently overwritten', () => {
  assert.throws(() => reviseInspectionAction(completedRecord(), {
    type: '미발견',
    memo: '',
    inspector: '수정자',
    actionUuid: 'revise-without-reason',
    now: '2026-08-20T09:10:00.000Z'
  }), /수정 사유/);
});

test('room display keeps the asset in its registered room and also exposes it as inbound at the confirmed room', () => {
  const locationMap = {
    'LOC-B1': { representative: { locationCode: 'LOC-B1' } },
    'LOC-LOBBY': { representative: { locationCode: 'LOC-LOBBY' } }
  };
  const moved = completedRecord({
    result: '위치변경',
    confirmedLocationCode: 'LOC-LOBBY',
    confirmedFloor: '1층',
    confirmedSpaceName: '로비',
    locationMatches: 'N'
  });

  const sourceRoom = buildRoomDisplayRecords([moved], 'LOC-B1', locationMap);
  const destinationRoom = buildRoomDisplayRecords([moved], 'LOC-LOBBY', locationMap);

  assert.equal(sourceRoom.length, 1);
  assert.equal(sourceRoom[0].displayRole, 'original');
  assert.equal(destinationRoom.length, 1);
  assert.equal(destinationRoom[0].displayRole, 'inbound');
  assert.equal(destinationRoom[0].originalSpaceName, '창고 1');
  assert.equal(destinationRoom[0].confirmedSpaceName, '로비');
});

test('mobile UI and server expose revision and inbound workflows', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'apps-script/Index.html'), 'utf8');
  const inspection = fs.readFileSync(path.join(root, 'apps-script/Inspection.gs'), 'utf8');
  const fieldOps = fs.readFileSync(path.join(root, 'apps-script/FieldOps.gs'), 'utf8');

  assert.match(html, /✏ 판정 수정/);
  assert.match(html, /유입/);
  assert.match(html, /reviseInspectionAction/);
  assert.match(inspection, /function reviseInspectionActionFromMobile/);
  assert.match(fieldOps, /buildRoomDisplayRecords/);
});
