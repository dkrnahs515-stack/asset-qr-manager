const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeSessionId,
  makeRecordId,
  buildInventoryRecords,
  buildLocationMap,
  aggregateProgress,
  computeMetricDelta
} = require('../apps-script/Core.js');

test('makeSessionId increments the highest sequence for the requested year', () => {
  const id = makeSessionId(2026, [
    'INV-2025-009',
    'INV-2026-001',
    'INV-2026-003',
    'invalid'
  ]);
  assert.equal(id, 'INV-2026-004');
});

test('makeRecordId keeps the session sequence and pads the record index', () => {
  assert.equal(makeRecordId('INV-2026-004', 1), 'INVR-2026-004-0001');
  assert.equal(makeRecordId('INV-2026-004', 842), 'INVR-2026-004-0842');
});

test('buildInventoryRecords snapshots every registered asset as unconfirmed', () => {
  const assets = [
    {
      systemId: 'GSYC-000001',
      oldAssetNo: '2015-16',
      newAssetNo: '2015-B-16',
      name: '일체형 컴퓨터',
      spec: '22V240-LT23K(LG)',
      locationCode: 'LOC-001',
      floor: '지하 1층',
      spaceName: '창고 1'
    },
    {
      systemId: 'GSYC-000003',
      oldAssetNo: '2018-113',
      newAssetNo: '2018-B-113',
      name: '사각테이블',
      spec: '',
      locationCode: 'LOC-001',
      floor: '지하 1층',
      spaceName: '창고 1'
    }
  ];

  const records = buildInventoryRecords('INV-2026-001', assets, {
    'GSYC-000003': 'ERR-00001'
  });

  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    recordId: 'INVR-2026-001-0001',
    sessionId: 'INV-2026-001',
    targetType: '등록비품',
    systemId: 'GSYC-000001',
    tempAssetId: '',
    oldAssetNo: '2015-16',
    newAssetNo: '2015-B-16',
    name: '일체형 컴퓨터',
    spec: '22V240-LT23K(LG)',
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
    photoCount: 0,
    errorReviewId: '',
    adminReviewStatus: '미검토',
    masterApplied: 'N',
    masterAppliedAt: '',
    version: 0,
    lastActionUuid: '',
    memo: ''
  });
  assert.equal(records[1].errorReviewId, 'ERR-00001');
  assert.equal(records[1].confirmedLocationCode, '');
  assert.equal(records[1].result, '미확인');
});

test('buildLocationMap resolves representative locations without deleting legacy codes', () => {
  const locationMap = buildLocationMap([
    {
      locationCode: 'LOC-024', floor: '2층', spaceName: '204호 (피아노실)',
      displayStatus: '표시', sortOrder: 24, representativeLocationCode: 'LOC-024'
    },
    {
      locationCode: 'LOC-050', floor: '2층', spaceName: '피아노실',
      displayStatus: '숨김', sortOrder: 50, representativeLocationCode: 'LOC-024'
    }
  ]);

  assert.equal(locationMap['LOC-050'].representativeLocationCode, 'LOC-024');
  assert.equal(locationMap['LOC-050'].representative.floor, '2층');
  assert.equal(locationMap['LOC-050'].representative.spaceName, '204호 (피아노실)');
});

test('aggregateProgress counts only registered assets in the denominator and groups by representative location', () => {
  const locationMap = buildLocationMap([
    {
      locationCode: 'LOC-024', floor: '2층', spaceName: '204호 (피아노실)',
      displayStatus: '표시', sortOrder: 24, representativeLocationCode: 'LOC-024'
    },
    {
      locationCode: 'LOC-050', floor: '2층', spaceName: '피아노실',
      displayStatus: '숨김', sortOrder: 50, representativeLocationCode: 'LOC-024'
    },
    {
      locationCode: 'LOC-048', floor: '미정', spaceName: '회관',
      displayStatus: '검토', sortOrder: 48, representativeLocationCode: 'LOC-048'
    }
  ]);

  const records = [
    { targetType: '등록비품', originalLocationCode: 'LOC-024', result: '정상' },
    { targetType: '등록비품', originalLocationCode: 'LOC-050', result: '미확인' },
    { targetType: '등록비품', originalLocationCode: 'LOC-048', result: '보류' },
    { targetType: '미등록비품', originalLocationCode: '', result: '미등록발견' }
  ];

  const progress = aggregateProgress(records, locationMap);

  assert.equal(progress.total, 3);
  assert.equal(progress.completed, 2);
  assert.equal(progress.unconfirmed, 1);
  assert.equal(progress.progress, 66.67);
  assert.equal(progress.locations['LOC-024'].total, 2);
  assert.equal(progress.locations['LOC-024'].completed, 1);
  assert.equal(progress.locations['LOC-048'].reviewRequired, true);
  assert.equal(progress.unregisteredFound, 1);
});

test('computeMetricDelta handles transitions without double-counting completed work', () => {
  assert.deepEqual(computeMetricDelta('미확인', '정상'), {
    completed: 1,
    normal: 1,
    locationChanged: 0,
    issue: 0,
    missing: 0,
    unregisteredFound: 0,
    unconfirmed: -1
  });

  assert.deepEqual(computeMetricDelta('정상', '위치변경'), {
    completed: 0,
    normal: -1,
    locationChanged: 1,
    issue: 0,
    missing: 0,
    unregisteredFound: 0,
    unconfirmed: 0
  });
});
