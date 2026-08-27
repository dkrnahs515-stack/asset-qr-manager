'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sortLabelPrintItems,
  buildLabelPrintIssueStateFingerprint,
  labelPrintIssueStateMatchesFingerprint
} = require('../apps-script/LabelPrintCore.js');

test('label sorting keeps late review locations inside their floor group', () => {
  const items = [
    { systemId: 'EXT', newAssetNo: '2020-X-1', currentFloor: '외부', currentSpaceName: '컨테이너', floorSortOrder: 43, locationSortOrder: 43 },
    { systemId: 'REVIEW-2F', newAssetNo: '2020-B-2', currentFloor: '2층', currentSpaceName: '통합 사무실', floorSortOrder: 22, locationSortOrder: 49 },
    { systemId: 'BASE', newAssetNo: '2020-B-1', currentFloor: '지하 1층', currentSpaceName: '카페', floorSortOrder: 1, locationSortOrder: 5 },
    { systemId: 'THIRD', newAssetNo: '2020-B-3', currentFloor: '3층', currentSpaceName: '301호 (관장실)', floorSortOrder: 30, locationSortOrder: 30 },
    { systemId: 'UNKNOWN', newAssetNo: '2020-Z-9', currentFloor: '미정', currentSpaceName: '새 공간', floorSortOrder: null, locationSortOrder: null }
  ];

  const sorted = sortLabelPrintItems(items);
  assert.deepEqual(sorted.map(item => item.systemId), ['BASE', 'REVIEW-2F', 'THIRD', 'EXT', 'UNKNOWN']);
  assert.deepEqual(items.map(item => item.systemId), ['EXT', 'REVIEW-2F', 'BASE', 'THIRD', 'UNKNOWN'], 'sort must not mutate caller array');
});

test('issue state fingerprints reject a stale overlapping print preview', () => {
  const original = {
    issueStatus: '미발급',
    reprintRequired: 'N',
    reprintCount: 0,
    lastPrintBatchId: ''
  };
  const fingerprint = buildLabelPrintIssueStateFingerprint(original);

  assert.equal(labelPrintIssueStateMatchesFingerprint(original, fingerprint), true);
  assert.equal(labelPrintIssueStateMatchesFingerprint({
    ...original,
    issueStatus: '발급완료',
    lastPrintBatchId: 'LABEL-20260827-001'
  }, fingerprint), false);
  assert.equal(labelPrintIssueStateMatchesFingerprint({
    ...original,
    reprintRequired: 'Y'
  }, fingerprint), false);
  assert.equal(labelPrintIssueStateMatchesFingerprint({
    ...original,
    reprintCount: 1
  }, fingerprint), false);
});
