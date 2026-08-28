const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQrBatchSnapshot,
  buildQrBatchCanonical,
  buildQrBatchTargetCanonical,
  selectQrBatchItems,
  applyQrBatchResults,
  resetFailedQrBatchItems,
  summarizeQrBatchItems,
  nextQrBatchId
} = require('../apps-script/QrBatchCore.js');

function makeMasterRows() {
  const excluded = new Set([
    16, 47, 235, 236, 302, 327, 383, 444, 561, 583, 800, 801, 802, 803, 804
  ]);
  return Array.from({ length: 842 }, (_, index) => {
    const sequence = index + 1;
    return {
      rowNumber: index + 2,
      systemId: `GSYC-${String(sequence).padStart(6, '0')}`,
      newAssetNo: `2026-T-${String(sequence).padStart(3, '0')}`,
      name: `테스트 비품 ${sequence}`,
      usageStatus: excluded.has(sequence) ? '확인필요' : '사용',
      itemState: excluded.has(sequence) ? '불용예정' : '정상'
    };
  });
}

function makeKey(sequence) {
  return `K${String(sequence).padStart(31, '0')}`;
}

function makeIssueRows(masterRows) {
  const active = masterRows.filter((row) => row.usageStatus === '사용').slice(0, 29)
    .map((row, index) => ({
      systemId: row.systemId,
      accessKey: makeKey(index + 1),
      accessKeyStatus: '사용',
      lookupUrl: `https://script.google.com/macros/s/DEPLOYMENT123/exec?k=${makeKey(index + 1)}`
    }));
  return [
    {
      systemId: active[0].systemId,
      accessKey: makeKey(999),
      accessKeyStatus: '중지',
      lookupUrl: `https://script.google.com/macros/s/DEPLOYMENT123/exec?k=${makeKey(999)}`
    },
    ...active
  ];
}

test('batch snapshot targets 827 active-use assets and excludes the 15 disposal-review rows', () => {
  const masterRows = makeMasterRows();
  const snapshot = buildQrBatchSnapshot(masterRows, makeIssueRows(masterRows));

  assert.deepEqual(snapshot.summary, {
    registered: 842,
    target: 827,
    excluded: 15,
    reuse: 29,
    needsIssue: 798
  });
  assert.equal(snapshot.items.length, 827);
  assert.equal(snapshot.excluded.length, 15);
  assert.equal(snapshot.items.filter((item) => item.snapshotQrState === '재사용').length, 29);
  assert.equal(snapshot.items.filter((item) => item.snapshotQrState === '신규발급').length, 798);
  assert.deepEqual(
    [...new Set(snapshot.excluded.map((item) => item.usageStatus))],
    ['확인필요']
  );
  assert.equal(snapshot.items[0].processingOrder, 1);
  assert.equal(snapshot.items.at(-1).processingOrder, 827);
});

test('batch snapshot rejects duplicate master IDs and duplicate active QR rows', () => {
  const masterRows = makeMasterRows().slice(0, 3);
  assert.throws(
    () => buildQrBatchSnapshot([...masterRows, { ...masterRows[0], rowNumber: 99 }], []),
    /비품마스터.*중복/
  );

  assert.throws(
    () => buildQrBatchSnapshot(masterRows, [
      { systemId: masterRows[0].systemId, accessKeyStatus: '사용', accessKey: makeKey(1) },
      { systemId: masterRows[0].systemId, accessKeyStatus: '사용', accessKey: makeKey(2) }
    ]),
    /활성 QR.*중복/
  );
});

test('batch snapshot rejects missing permanent IDs, missing active asset numbers, and orphan active QR rows', () => {
  const masterRows = makeMasterRows().slice(0, 3);
  assert.throws(
    () => buildQrBatchSnapshot([
      ...masterRows,
      { rowNumber: 99, systemId: '', newAssetNo: '2026-T-999', name: '식별자 누락', usageStatus: '사용' }
    ], []),
    /영구 시스템 ID가 비어/
  );
  assert.throws(
    () => buildQrBatchSnapshot([
      { ...masterRows[0], newAssetNo: '' },
      ...masterRows.slice(1)
    ], []),
    /New 비품번호가 비어/
  );
  assert.throws(
    () => buildQrBatchSnapshot(masterRows, [{
      systemId: 'GSYC-999999',
      accessKeyStatus: '사용',
      accessKey: makeKey(1)
    }]),
    /비품마스터에 없는 활성 QR/
  );
});

test('batch snapshot rejects one active QR key shared by different assets', () => {
  const masterRows = makeMasterRows().slice(0, 3);
  assert.throws(
    () => buildQrBatchSnapshot(masterRows, [
      { systemId: masterRows[0].systemId, accessKeyStatus: '사용', accessKey: makeKey(1) },
      { systemId: masterRows[1].systemId, accessKeyStatus: '사용', accessKey: makeKey(1) }
    ]),
    /활성 QR 접근키가 중복/
  );
});

test('batch canonical input is deterministic, ignores stopped history, and changes with active state', () => {
  const masterRows = makeMasterRows().slice(0, 3);
  const first = buildQrBatchSnapshot(masterRows, [{
    systemId: masterRows[0].systemId,
    accessKeyStatus: '사용',
    accessKey: makeKey(1),
    lookupUrl: `https://script.google.com/macros/s/DEPLOYMENT123/exec?k=${makeKey(1)}`
  }]);
  const withStoppedHistory = buildQrBatchSnapshot(masterRows, [
    {
      systemId: masterRows[0].systemId,
      accessKeyStatus: '중지',
      accessKey: makeKey(999),
      lookupUrl: `https://script.google.com/macros/s/DEPLOYMENT123/exec?k=${makeKey(999)}`
    },
    {
      systemId: masterRows[0].systemId,
      accessKeyStatus: '사용',
      accessKey: makeKey(1),
      lookupUrl: `https://script.google.com/macros/s/DEPLOYMENT123/exec?k=${makeKey(1)}`
    }
  ]);
  const changedActive = buildQrBatchSnapshot(masterRows, [{
    systemId: masterRows[0].systemId,
    accessKeyStatus: '사용',
    accessKey: makeKey(2),
    lookupUrl: `https://script.google.com/macros/s/DEPLOYMENT123/exec?k=${makeKey(2)}`
  }]);

  assert.equal(buildQrBatchCanonical(first), buildQrBatchCanonical(withStoppedHistory));
  assert.notEqual(buildQrBatchCanonical(first), buildQrBatchCanonical(changedActive));
  assert.equal(
    buildQrBatchTargetCanonical(first),
    buildQrBatchTargetCanonical(changedActive),
    'issuing a QR must not invalidate the resume fingerprint'
  );
});

test('checkpoint selection processes at most 50 pending items and skips completed or failed rows', () => {
  const rows = Array.from({ length: 75 }, (_, index) => ({
    systemId: `GSYC-${String(index + 1).padStart(6, '0')}`,
    processingOrder: index + 1,
    processingStatus: index < 3 ? '성공' : (index === 3 ? '실패' : '대기'),
    attempts: index < 4 ? 1 : 0
  }));

  const selected = selectQrBatchItems(rows, 50);
  assert.equal(selected.length, 50);
  assert.equal(selected[0].processingOrder, 5);
  assert.equal(selected.at(-1).processingOrder, 54);
  assert.equal(selected.some((row) => row.processingStatus !== '대기'), false);
});

test('applying results records success, reuse, and failure while preserving retry counts', () => {
  const now = '2026-08-27T09:30:00+09:00';
  const rows = [
    { systemId: 'GSYC-000001', processingOrder: 1, processingStatus: '대기', attempts: 0 },
    { systemId: 'GSYC-000002', processingOrder: 2, processingStatus: '대기', attempts: 1 },
    { systemId: 'GSYC-000003', processingOrder: 3, processingStatus: '대기', attempts: 0 },
    { systemId: 'GSYC-000004', processingOrder: 4, processingStatus: '성공', attempts: 1 }
  ];
  const updated = applyQrBatchResults(rows, [
    { systemId: 'GSYC-000001', ok: true, reused: false, accessKey: makeKey(1), lookupUrl: 'url-1' },
    { systemId: 'GSYC-000002', ok: true, reused: true, accessKey: makeKey(2), lookupUrl: 'url-2' },
    { systemId: 'GSYC-000003', ok: false, error: '일시 오류' }
  ], now);

  assert.deepEqual(
    updated.map((row) => [row.processingStatus, row.attempts, row.errorMessage || '']),
    [
      ['성공', 1, ''],
      ['재사용', 2, ''],
      ['실패', 1, '일시 오류'],
      ['성공', 1, '']
    ]
  );
  assert.equal(updated[0].lastAttemptAt, now);
  assert.equal(updated[1].accessKey, makeKey(2));
});

test('failed items require an explicit reset before resume and summaries expose the checkpoint', () => {
  const rows = [
    { systemId: 'GSYC-000001', processingOrder: 1, processingStatus: '성공', attempts: 1 },
    { systemId: 'GSYC-000002', processingOrder: 2, processingStatus: '재사용', attempts: 1 },
    { systemId: 'GSYC-000003', processingOrder: 3, processingStatus: '실패', attempts: 1, errorMessage: '오류' },
    { systemId: 'GSYC-000004', processingOrder: 4, processingStatus: '대기', attempts: 0 }
  ];

  assert.deepEqual(summarizeQrBatchItems(rows), {
    total: 4,
    succeeded: 1,
    reused: 1,
    failed: 1,
    pending: 1,
    processed: 3,
    nextProcessingOrder: 4,
    batchStatus: '일시중단'
  });
  const reset = resetFailedQrBatchItems(rows);
  assert.equal(reset[2].processingStatus, '대기');
  assert.equal(reset[2].attempts, 1);
  assert.equal(reset[2].errorMessage, '');
  assert.deepEqual(selectQrBatchItems(reset, 50).map((row) => row.processingOrder), [3, 4]);
});

test('a clean partial checkpoint remains in progress instead of looking failed or paused', () => {
  const rows = [
    { systemId: 'GSYC-000001', processingOrder: 1, processingStatus: '성공', attempts: 1 },
    { systemId: 'GSYC-000002', processingOrder: 2, processingStatus: '대기', attempts: 0 }
  ];

  assert.equal(summarizeQrBatchItems(rows).batchStatus, '진행중');
});

test('batch IDs increment only the highest sequence for the requested date', () => {
  assert.equal(
    nextQrBatchId(['QRB-20260827-001', 'QRB-20260826-099', 'QRB-20260827-004', 'bad'], '20260827'),
    'QRB-20260827-005'
  );
  assert.equal(nextQrBatchId([], '20260827'), 'QRB-20260827-001');
  assert.equal(nextQrBatchId(['QRB-20260827-999'], '20260827'), 'QRB-20260827-1000');
  assert.equal(nextQrBatchId(['QRB-20260827-1000'], '20260827'), 'QRB-20260827-1001');
});
