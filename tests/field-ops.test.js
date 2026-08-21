const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeTempAssetId,
  makeUnregisteredRecordId,
  buildUnregisteredRecord,
  summarizeLocationCloseout,
  sortLocationBuckets
} = require('../apps-script/Core.js');

test('makeTempAssetId increments the highest temp asset sequence for the year', () => {
  assert.equal(
    makeTempAssetId(2026, ['TMP-2025-0012', 'TMP-2026-0002', 'TMP-2026-0011']),
    'TMP-2026-0012'
  );
});

test('makeUnregisteredRecordId uses a U-prefixed per-session sequence', () => {
  assert.equal(makeUnregisteredRecordId('INV-2026-001', 1), 'INVR-2026-001-U001');
  assert.equal(makeUnregisteredRecordId('INV-2026-001', 12), 'INVR-2026-001-U012');
});

test('buildUnregisteredRecord creates a discovered asset without changing the registered denominator', () => {
  const now = new Date('2026-08-19T08:50:00.000Z');
  const record = buildUnregisteredRecord({
    sessionId: 'INV-2026-001',
    recordId: 'INVR-2026-001-U001',
    tempAssetId: 'TMP-2026-0001',
    name: '접이식 테이블',
    spec: '화이트 1200mm',
    locationCode: 'LOC-019',
    floor: '1층',
    spaceName: '로비',
    inspector: '이건희',
    memo: '행사용 비품으로 추정',
    actionUuid: 'act-1',
    now,
    photoCount: 1
  });

  assert.equal(record.targetType, '미등록비품');
  assert.equal(record.result, '미등록발견');
  assert.equal(record.tempAssetId, 'TMP-2026-0001');
  assert.equal(record.confirmedLocationCode, 'LOC-019');
  assert.equal(record.physicalConfirmed, 'Y');
  assert.equal(record.photoCount, 1);
  assert.equal(record.adminReviewStatus, '미검토');
  assert.equal(record.masterApplied, 'N');
});

test('summarizeLocationCloseout keeps unregistered finds outside the denominator and reports exceptions', () => {
  const locationMap = {
    'LOC-019': { representative: { locationCode: 'LOC-019' } },
    'LOC-055': { representative: { locationCode: 'LOC-019' } }
  };
  const records = [
    { targetType: '등록비품', originalLocationCode: 'LOC-019', result: '정상' },
    { targetType: '등록비품', originalLocationCode: 'LOC-055', result: '상태이상' },
    { targetType: '등록비품', originalLocationCode: 'LOC-019', result: '미발견' },
    { targetType: '등록비품', originalLocationCode: 'LOC-019', result: '미확인' },
    { targetType: '미등록비품', confirmedLocationCode: 'LOC-019', result: '미등록발견' }
  ];

  const summary = summarizeLocationCloseout(records, 'LOC-019', locationMap);
  assert.deepEqual(summary, {
    total: 4,
    completed: 3,
    unconfirmed: 1,
    normal: 1,
    locationChanged: 0,
    issue: 1,
    missing: 1,
    unregisteredFound: 1,
    canCloseCleanly: false
  });
});

test('sortLocationBuckets puts unfinished rooms first, then follows mobile sort order', () => {
  const sorted = sortLocationBuckets([
    { locationCode: 'LOC-003', unconfirmed: 0, sortOrder: 3, spaceName: '완료실' },
    { locationCode: 'LOC-002', unconfirmed: 2, sortOrder: 2, spaceName: '두번째' },
    { locationCode: 'LOC-001', unconfirmed: 1, sortOrder: 1, spaceName: '첫번째' }
  ]);
  assert.deepEqual(sorted.map(x => x.locationCode), ['LOC-001', 'LOC-002', 'LOC-003']);
});
