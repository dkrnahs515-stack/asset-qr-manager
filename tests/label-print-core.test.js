'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeLabelPrintSettings,
  classifyLabelPrintType,
  validateLabelPrintCandidate,
  sortLabelPrintItems,
  paginateLabelPrintItems,
  calculateLabelSlotPosition,
  makeLabelPrintBatchId,
  buildLabelPrintCompletionPatch
} = require('../apps-script/LabelPrintCore.js');

const BASE_URL = 'https://script.google.com/macros/s/DEPLOYMENT123/exec';
const VALID_KEY = 'AbcdEFGHijklMNOPqrstUVWXyz01_234';
const QR_URL = `${BASE_URL}?k=${VALID_KEY}`;

const RAW_SETTINGS = {
  '기본 라벨규격': 'FORMTEC_LS3106',
  '라벨버전': 'LABEL-2026-01',
  '라벨제목': '강서청소년회관 물품조사',
  '라벨가로mm': '64',
  '라벨세로mm': '33.9',
  '페이지열수': '3',
  '페이지행수': '8',
  '페이지왼쪽여백mm': '6.5',
  '페이지위쪽여백mm': '12.5',
  '열간격mm': '2.5',
  '행간격mm': '0',
  'QR크기mm': '20',
  '가로보정mm': '-1.8',
  '세로보정mm': '2.7',
  '3열가로보정mm': '0.3',
  '인쇄배율': '100',
  '관리책임자 정': '김은영',
  '관리책임자 부': '김정훈',
  '책임자버전': 'RESP-2026-01',
  '상세조회배포URL': BASE_URL
};

function activeIssue(overrides = {}) {
  return {
    systemId: 'GSYC-000001',
    accessKey: VALID_KEY,
    accessKeyStatus: '사용',
    lookupUrl: QR_URL,
    issueStatus: '미발급',
    reprintRequired: 'N',
    reprintReason: '',
    reprintCount: 0,
    lastPrintBatchId: '',
    ...overrides
  };
}

function asset(overrides = {}) {
  return {
    systemId: 'GSYC-000001',
    newAssetNo: '2015-B-16',
    name: '일체형 컴퓨터',
    usageStatus: '사용',
    qrLookupUrl: QR_URL,
    ...overrides
  };
}

const settings = () => normalizeLabelPrintSettings(RAW_SETTINGS);

test('approved LS3106 calibration resolves exact first-row and final-slot positions', () => {
  const s = settings();
  assert.deepEqual(calculateLabelSlotPosition(s, 0), { row: 0, column: 0, xMm: 4.7, topMm: 9.8 });
  assert.deepEqual(calculateLabelSlotPosition(s, 1), { row: 0, column: 1, xMm: 71.2, topMm: 9.8 });
  assert.deepEqual(calculateLabelSlotPosition(s, 2), { row: 0, column: 2, xMm: 138, topMm: 9.8 });
  assert.deepEqual(calculateLabelSlotPosition(s, 23), { row: 7, column: 2, xMm: 138, topMm: 247.1 });
  assert.equal(s.pageSize, 24);
  assert.equal(s.qrSizeMm, 20);
});

test('24, 25, and 49 labels paginate to 1, 2, and 3 pages with padded final pages', () => {
  const p24 = paginateLabelPrintItems(Array.from({ length: 24 }, (_, i) => ({ id: i })), 24);
  const p25 = paginateLabelPrintItems(Array.from({ length: 25 }, (_, i) => ({ id: i })), 24);
  const p49 = paginateLabelPrintItems(Array.from({ length: 49 }, (_, i) => ({ id: i })), 24);
  assert.equal(p24.length, 1);
  assert.equal(p25.length, 2);
  assert.equal(p49.length, 3);
  assert.equal(p25[1].filter(Boolean).length, 1);
  assert.equal(p25[1].length, 24);
});

test('candidate validation accepts exactly one valid active QR and classifies initial print', () => {
  const result = validateLabelPrintCandidate(asset(), null, [activeIssue()], settings());
  assert.equal(result.ok, true);
  assert.equal(result.reason, '');
  assert.equal(result.issue.accessKey, VALID_KEY);
  assert.equal(result.printType, '최초발급');
  assert.equal(classifyLabelPrintType(activeIssue()), '최초발급');
});

test('candidate validation rejects missing, duplicate, stopped, malformed, and mismatched QR state', () => {
  const s = settings();
  assert.equal(validateLabelPrintCandidate(asset(), null, [], s).reason, '활성 QR 없음');
  assert.equal(validateLabelPrintCandidate(asset(), null, [activeIssue(), activeIssue({ accessKey: 'Z'.repeat(32), lookupUrl: `${BASE_URL}?k=${'Z'.repeat(32)}` })], s).reason, '활성 QR 중복');
  assert.equal(validateLabelPrintCandidate(asset(), null, [activeIssue({ accessKeyStatus: '중지' })], s).reason, '활성 QR 없음');
  assert.equal(validateLabelPrintCandidate(asset(), null, [activeIssue({ accessKey: 'bad' })], s).reason, 'QR 접근키 형식 오류');
  assert.equal(validateLabelPrintCandidate(asset(), null, [activeIssue({ lookupUrl: `${BASE_URL}?k=${'Z'.repeat(32)}` })], s).reason, 'QR URL 불일치');
  assert.equal(validateLabelPrintCandidate(asset({ qrLookupUrl: `${BASE_URL}?k=${'Z'.repeat(32)}` }), null, [activeIssue()], s).reason, '마스터 QR URL 불일치');
});

test('candidate validation rejects inactive assets and missing label text', () => {
  const s = settings();
  assert.equal(validateLabelPrintCandidate(asset({ usageStatus: '미사용' }), null, [activeIssue()], s).reason, '사용 중지 비품');
  assert.equal(validateLabelPrintCandidate(asset({ newAssetNo: '' }), null, [activeIssue()], s).reason, '비품번호 없음');
  assert.equal(validateLabelPrintCandidate(asset({ name: '' }), null, [activeIssue()], s).reason, '품명 없음');
});

test('reprint classification covers reissue-needed, reprint-required, and previously printed rows', () => {
  assert.equal(classifyLabelPrintType(activeIssue({ issueStatus: '재발급필요' })), '재출력');
  assert.equal(classifyLabelPrintType(activeIssue({ reprintRequired: 'Y' })), '재출력');
  assert.equal(classifyLabelPrintType(activeIssue({ issueStatus: '발급완료', lastPrintedAt: new Date() })), '재출력');
});

test('label items sort by mapped location order, then asset number, with unknown locations last', () => {
  const items = [
    { systemId: 'D', newAssetNo: '2020-B-9', currentFloor: '미정', currentSpaceName: '기타', locationSortOrder: null },
    { systemId: 'C', newAssetNo: '2020-B-20', currentFloor: '지하 1층', currentSpaceName: '창고 1', locationSortOrder: 1 },
    { systemId: 'B', newAssetNo: '2020-B-3', currentFloor: '지하 1층', currentSpaceName: '사진관', locationSortOrder: 10 },
    { systemId: 'A', newAssetNo: '2020-B-2', currentFloor: '지하 1층', currentSpaceName: '창고 1', locationSortOrder: 1 }
  ];
  const sorted = sortLabelPrintItems(items);
  assert.deepEqual(sorted.map(item => item.systemId), ['A', 'C', 'B', 'D']);
  assert.deepEqual(items.map(item => item.systemId), ['D', 'C', 'B', 'A'], 'sort must not mutate caller array');
});

test('batch IDs are date-scoped and zero-padded', () => {
  assert.equal(makeLabelPrintBatchId('20260826', 1), 'LABEL-20260826-001');
  assert.equal(makeLabelPrintBatchId('20260826', 12), 'LABEL-20260826-012');
});

test('completion patch records first print without increasing reprint count', () => {
  const issue = activeIssue({ reprintCount: 2 });
  const patch = buildLabelPrintCompletionPatch(issue, {
    batchId: 'LABEL-20260826-001',
    printType: '최초발급',
    labelType: 'FORMTEC_LS3106',
    labelVersion: 'LABEL-2026-01',
    primaryManager: '김은영',
    secondaryManager: '김정훈',
    managerVersion: 'RESP-2026-01',
    inspectionDate: '2026.08.22',
    printedAt: new Date('2026-08-26T04:00:00Z')
  });
  assert.equal(patch.duplicate, false);
  assert.equal(patch.issueStatus, '발급완료');
  assert.equal(patch.reprintCount, 2);
  assert.equal(patch.reprintRequired, 'N');
  assert.equal(patch.lastPrintBatchId, 'LABEL-20260826-001');
});

test('reprint completion increments exactly once and preserves the audit reason', () => {
  const issue = activeIssue({ issueStatus: '재발급필요', reprintRequired: 'Y', reprintReason: '중지 QR 동작 검증 테스트', reprintCount: 3 });
  const context = {
    batchId: 'LABEL-20260826-002',
    printType: '재출력',
    labelType: 'FORMTEC_LS3106',
    labelVersion: 'LABEL-2026-01',
    primaryManager: '김은영',
    secondaryManager: '김정훈',
    managerVersion: 'RESP-2026-01',
    inspectionDate: '미조사',
    printedAt: new Date('2026-08-26T04:00:00Z')
  };
  const patch = buildLabelPrintCompletionPatch(issue, context);
  assert.equal(patch.reprintCount, 4);
  assert.equal(patch.reprintRequired, 'N');
  assert.equal(patch.reprintReason, '중지 QR 동작 검증 테스트');

  const duplicate = buildLabelPrintCompletionPatch({ ...issue, ...patch }, context);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.reprintCount, 4);
  assert.equal(duplicate.lastPrintBatchId, 'LABEL-20260826-002');
});
