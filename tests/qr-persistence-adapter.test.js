const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const batchCore = require('../apps-script/QrBatchCore.js');
const qrCore = require('../apps-script/QrCore.js');

const QR_ISSUE_HEADERS = [
  '영구 시스템 ID', 'QR접근키', 'QR접근키상태', 'QR조회URL', 'QR발급상태',
  '라벨유형', '라벨버전', '인쇄책임자 정', '인쇄책임자 부', '책임자버전',
  '라벨기준조사일', '최초발급일시', '최종출력일시', '재출력필요여부',
  '재출력사유', '재출력횟수', '최종출력배치ID', '비고'
];

const QR_BATCH_HEADERS = [
  '배치ID', '환경', '대상지문', '상태', '배치크기', '전체대상', '신규발급대상',
  '기존활성QR', '성공', '재사용', '실패', '미처리', '다음처리순번', '생성일시',
  '최종실행일시', '완료일시', '생성자', '비고'
];

const QR_BATCH_ITEM_HEADERS = [
  '배치ID', '처리순번', '영구 시스템 ID', 'New 비품번호', '품명', '스냅샷사용여부',
  '스냅샷QR상태', '처리상태', '시도횟수', 'QR접근키', 'QR조회URL', '오류메시지',
  '최종시도일시'
];

class FakeSheet {
  constructor(name, rows, maxRows = 100) {
    this.name = name;
    this.rows = rows.map((row) => row.slice());
    this.maxRows = Math.max(maxRows, this.rows.length);
    this.failNextSetValues = false;
    this.failOnSetValuesCall = 0;
    this.setValuesAttemptCount = 0;
    this.setValuesCalls = [];
  }

  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.rows[0] ? this.rows[0].length : 0; }
  getLastColumn() { return this.getMaxColumns(); }
  getLastRow() {
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      if ((this.rows[index] || []).some((value) => value !== '' && value !== null && value !== undefined)) {
        return index + 1;
      }
    }
    return 0;
  }
  insertRowsAfter(afterRow, count) {
    this.maxRows += count;
    while (this.rows.length < afterRow + count) this.rows.push([]);
  }
  getRange(row, column, numRows = 1, numColumns = 1) {
    const sheet = this;
    return {
      getValues() {
        return Array.from({ length: numRows }, (_, rowOffset) =>
          Array.from({ length: numColumns }, (_, columnOffset) =>
            (sheet.rows[row - 1 + rowOffset] || [])[column - 1 + columnOffset] ?? ''
          )
        );
      },
      setValues(values) {
        sheet.setValuesAttemptCount += 1;
        if (sheet.failNextSetValues || sheet.setValuesAttemptCount === sheet.failOnSetValuesCall) {
          sheet.failNextSetValues = false;
          throw new Error(`injected ${sheet.name} write failure`);
        }
        sheet.setValuesCalls.push({
          row,
          column,
          numRows,
          numColumns,
          values: values.map((entry) => entry.slice())
        });
        for (let rowOffset = 0; rowOffset < numRows; rowOffset += 1) {
          const targetRow = row - 1 + rowOffset;
          while (sheet.rows.length <= targetRow) sheet.rows.push([]);
          for (let columnOffset = 0; columnOffset < numColumns; columnOffset += 1) {
            sheet.rows[targetRow][column - 1 + columnOffset] = values[rowOffset][columnOffset];
          }
        }
        return this;
      },
      setValue(value) {
        return this.setValues([[value]]);
      }
    };
  }
}

function headerIndex(headers) {
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

function buildRowForHeaders(headers, values) {
  return headers.map((header) => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '');
}

function requiredHeaders(headers, required, name) {
  const index = headerIndex(headers);
  for (const header of required) {
    if (index[header] === undefined) throw new Error(`${name} missing ${header}`);
  }
  return index;
}

function makeIssue(systemId, key, lookupUrl, rowNumber = 0) {
  return {
    rowNumber,
    systemId,
    accessKey: key,
    accessKeyStatus: '사용',
    lookupUrl,
    issueStatus: '미발급',
    labelType: '',
    labelVersion: '',
    printedPrimaryManager: '',
    printedSecondaryManager: '',
    managerVersion: '',
    labelInspectionDate: '',
    firstIssuedAt: '',
    lastPrintedAt: '',
    reprintRequired: 'N',
    reprintReason: '',
    reprintCount: 0,
    lastPrintBatchId: '',
    memo: ''
  };
}

function loadQrAdminContext(issueSheet, masterSheet) {
  const sheets = {
    QR발급관리: issueSheet,
    비품마스터: masterSheet
  };
  const context = {
    ...qrCore,
    INVENTORY_CONFIG: { SHEETS: { QR_ISSUE: 'QR발급관리', ASSET_MASTER: '비품마스터' } },
    QR_ISSUE_HEADERS,
    getRequiredSheet_: (_ss, name) => sheets[name],
    getHeaders_: (sheet) => sheet.rows[0].slice(),
    requireHeaders_: requiredHeaders,
    headerIndex_: headerIndex,
    buildRowForHeaders_: buildRowForHeaders,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid: (() => {
        let sequence = 0;
        return () => `uuid-${sequence += 1}`;
      })(),
      computeDigest: (_algorithm, value) => [...crypto.createHash('sha256').update(String(value)).digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url')
    },
    console
  };
  vm.runInNewContext(fs.readFileSync('apps-script/QrAdmin.gs', 'utf8'), context);
  return context;
}

test('QR issuance flush preserves untouched rows, formulas, and physical row positions', () => {
  const issueHeaders = [
    ...QR_ISSUE_HEADERS.slice(0, 3),
    '관리메모',
    ...QR_ISSUE_HEADERS.slice(3)
  ];
  const issueIndex = headerIndex(issueHeaders);
  const issueRows = [issueHeaders];
  issueRows[1] = Array(issueHeaders.length).fill('');
  issueRows[1][issueIndex['관리메모']] = '메모 전용 행';
  issueRows[2] = Array(issueHeaders.length).fill('');
  issueRows[2][issueIndex['영구 시스템 ID']] = 'GSYC-000001';
  issueRows[2][issueIndex['QR접근키']] = 'A'.repeat(32);
  issueRows[2][issueIndex['QR접근키상태']] = '사용';
  issueRows[2][issueIndex['관리메모']] = '=ROW()';
  issueRows[3] = Array(issueHeaders.length).fill('');
  issueRows[3][issueIndex['관리메모']] = '내부 빈칸 유지';
  issueRows[4] = Array(issueHeaders.length).fill('');
  issueRows[4][issueIndex['영구 시스템 ID']] = 'GSYC-000999';
  issueRows[4][issueIndex['QR접근키']] = 'Z'.repeat(32);
  issueRows[4][issueIndex['관리메모']] = '기존 마지막 행';
  const issueSheet = new FakeSheet('QR발급관리', issueRows);

  const masterHeaders = ['영구 시스템 ID', 'QR조회URL', '계산열'];
  const masterSheet = new FakeSheet('비품마스터', [
    masterHeaders,
    ['GSYC-000999', 'keep-url', '=ROW()'],
    ['GSYC-000001', '', '=ROW()*2']
  ]);
  const context = loadQrAdminContext(issueSheet, masterSheet);
  const updated = makeIssue('GSYC-000001', 'A'.repeat(32), 'https://example.test/one', 3);
  const appended = makeIssue('GSYC-000002', 'B'.repeat(32), 'https://example.test/two');
  const issuanceContext = {
    issues: [updated, makeIssue('GSYC-000999', 'Z'.repeat(32), 'keep-url', 5), appended],
    assetsBySystemId: {
      'GSYC-000001': [{ rowNumber: 3, systemId: 'GSYC-000001' }]
    },
    dirtyIssueRows: { 3: updated },
    newIssues: [appended],
    masterUrls: { 'GSYC-000001': 'https://example.test/one' },
    qrDirty: true,
    masterDirty: true
  };

  context.flushQrIssuanceContext_({}, issuanceContext);

  assert.equal(issueSheet.rows[1][issueIndex['관리메모']], '메모 전용 행');
  assert.equal(issueSheet.rows[2][issueIndex['QR조회URL']], 'https://example.test/one');
  assert.equal(issueSheet.rows[2][issueIndex['관리메모']], '=ROW()');
  assert.equal(issueSheet.rows[3][issueIndex['관리메모']], '내부 빈칸 유지');
  assert.equal(issueSheet.rows[4][issueIndex['관리메모']], '기존 마지막 행');
  assert.equal(issueSheet.rows[5][issueIndex['영구 시스템 ID']], 'GSYC-000002');
  const appendCalls = issueSheet.setValuesCalls.filter((call) => call.row === 6);
  assert.equal(appendCalls.length, 1, 'a new ledger row must be committed in one range write');
  assert.equal(appendCalls[0].numColumns, issueHeaders.length);
  assert.equal(masterSheet.rows[1][1], 'keep-url');
  assert.equal(masterSheet.rows[1][2], '=ROW()');
  assert.equal(masterSheet.rows[2][1], 'https://example.test/one');
  assert.equal(masterSheet.rows[2][2], '=ROW()*2');
});

test('QR issuance flush skips unchanged master URLs and coalesces adjacent changed rows', () => {
  const issueSheet = new FakeSheet('QR발급관리', [QR_ISSUE_HEADERS]);
  const masterSheet = new FakeSheet('비품마스터', [
    ['영구 시스템 ID', 'QR조회URL'],
    ['GSYC-000001', 'same-url'],
    ['GSYC-000002', 'old-2'],
    ['GSYC-000003', 'old-3'],
    ['GSYC-000004', 'old-4']
  ]);
  const context = loadQrAdminContext(issueSheet, masterSheet);
  const issuanceContext = context.createQrIssuanceContext_({}, [
    { rowNumber: 2, systemId: 'GSYC-000001', qrLookupUrl: 'same-url' },
    { rowNumber: 3, systemId: 'GSYC-000002', qrLookupUrl: 'old-2' },
    { rowNumber: 4, systemId: 'GSYC-000003', qrLookupUrl: 'old-3' },
    { rowNumber: 5, systemId: 'GSYC-000004', qrLookupUrl: 'old-4' }
  ], []);

  context.updateMasterQrUrl_('GSYC-000001', 'same-url', {}, issuanceContext);
  context.updateMasterQrUrl_('GSYC-000002', 'new-2', {}, issuanceContext);
  context.updateMasterQrUrl_('GSYC-000003', 'new-3', {}, issuanceContext);
  context.updateMasterQrUrl_('GSYC-000004', 'new-4', {}, issuanceContext);
  context.flushQrIssuanceContext_({}, issuanceContext);

  assert.deepEqual(
    masterSheet.setValuesCalls.map((call) => [call.row, call.numRows, call.numColumns]),
    [[3, 3, 1]],
    'three adjacent URL changes should use one single-column range write'
  );
  assert.deepEqual(masterSheet.rows.slice(1).map((row) => row[1]), [
    'same-url', 'new-2', 'new-3', 'new-4'
  ]);
});

test('rerun after ledger append but before master update reuses the single active key', () => {
  const issueSheet = new FakeSheet('QR발급관리', [QR_ISSUE_HEADERS]);
  const masterSheet = new FakeSheet('비품마스터', [
    ['영구 시스템 ID', 'New 비품번호', '품명', 'QR조회URL'],
    ['GSYC-000001', 'A-1', '테스트 비품', '']
  ]);
  const context = loadQrAdminContext(issueSheet, masterSheet);
  const baseUrl = 'https://script.google.com/macros/s/DEPLOYMENT123/exec';

  masterSheet.failNextSetValues = true;
  assert.throws(
    () => context.issueQrAccessKeysUnlocked_({}, ['GSYC-000001'], baseUrl),
    /injected 비품마스터 write failure/
  );
  assert.equal(issueSheet.getLastRow(), 2, 'the committed ledger row remains after the later master failure');

  const resumed = context.issueQrAccessKeysUnlocked_({}, ['GSYC-000001'], baseUrl);
  const issueIndex = headerIndex(QR_ISSUE_HEADERS);
  const activeRows = issueSheet.rows.slice(1).filter((row) => row[issueIndex['QR접근키상태']] === '사용');
  assert.equal(activeRows.length, 1);
  assert.equal(resumed.results[0].reused, true);
  assert.equal(masterSheet.rows[1][3], activeRows[0][issueIndex['QR조회URL']]);
});

function loadQrBatchContext() {
  const batchSheet = new FakeSheet('QR대량발급배치', [QR_BATCH_HEADERS]);
  const itemSheet = new FakeSheet('QR대량발급항목', [QR_BATCH_ITEM_HEADERS]);
  const sheets = {
    QR대량발급배치: batchSheet,
    QR대량발급항목: itemSheet
  };
  const lock = { waitLock() {}, releaseLock() {} };
  const context = {
    ...batchCore,
    QR_BATCH_MAX_SIZE: 50,
    QR_BATCH_HEADERS,
    QR_BATCH_ITEM_HEADERS,
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: { flush() {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'operator@example.test' }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithm, value) => [...crypto.createHash('sha256').update(String(value)).digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
      formatDate: () => '20260827'
    },
    getSpreadsheet_: () => ({ getSheetByName: (name) => sheets[name] }),
    getRequiredSheet_: (_ss, name) => sheets[name],
    getHeaders_: (sheet) => sheet.rows[0].slice(),
    requireHeaders_: requiredHeaders,
    headerIndex_: headerIndex,
    buildRowForHeaders_: buildRowForHeaders,
    getRuntimeConfig_: () => ({ environment: 'TEST' }),
    assertText_: (value, name) => { if (!String(value || '').trim()) throw new Error(`${name} required`); },
    console
  };
  vm.runInNewContext(fs.readFileSync('apps-script/QrBatch.gs', 'utf8'), context);
  return { context, batchSheet, itemSheet };
}

function makeSnapshotItems(count) {
  return Array.from({ length: count }, (_, index) => ({
    processingOrder: index + 1,
    systemId: `GSYC-${String(index + 1).padStart(6, '0')}`,
    newAssetNo: `A-${index + 1}`,
    name: `비품 ${index + 1}`,
    usageStatus: '사용',
    snapshotQrState: '신규발급',
    snapshotAccessKey: '',
    snapshotLookupUrl: '',
    processingStatus: '대기',
    attempts: 0,
    accessKey: '',
    lookupUrl: '',
    errorMessage: '',
    lastAttemptAt: ''
  }));
}

test('interrupted batch creation resumes the same creating record without orphan items', () => {
  const { context, batchSheet, itemSheet } = loadQrBatchContext();
  const items = makeSnapshotItems(2);
  context.buildCurrentQrBatchSnapshot_ = () => ({
    environment: 'TEST',
    baseUrl: 'https://example.test/exec',
    previewFingerprint: 'preview-1',
    targetFingerprint: 'target-1',
    snapshot: { items, excluded: [], summary: { target: 2, needsIssue: 2, reuse: 0 } }
  });

  itemSheet.failNextSetValues = true;
  assert.throws(
    () => context.createBulkQrIssuanceBatch({ expectedFingerprint: 'preview-1' }),
    /injected QR대량발급항목 write failure/
  );
  assert.equal(batchSheet.getLastRow(), 2);
  assert.equal(batchSheet.rows[1][headerIndex(QR_BATCH_HEADERS)['상태']], '생성중');
  assert.equal(itemSheet.getLastRow(), 1);

  const resumed = context.createBulkQrIssuanceBatch({ expectedFingerprint: 'preview-1' });
  assert.equal(resumed.batchId, 'QRB-20260827-001');
  assert.equal(resumed.status, '준비');
  assert.equal(batchSheet.getLastRow(), 2, 'must not allocate a second batch ID');
  assert.equal(itemSheet.getLastRow(), 3);
});

test('a batch with persisted items but an interrupted final transition resumes without duplicates', () => {
  const { context, batchSheet, itemSheet } = loadQrBatchContext();
  const items = makeSnapshotItems(2);
  context.buildCurrentQrBatchSnapshot_ = () => ({
    environment: 'TEST',
    baseUrl: 'https://example.test/exec',
    previewFingerprint: 'preview-finalize',
    targetFingerprint: 'target-finalize',
    snapshot: { items, excluded: [], summary: { target: 2, needsIssue: 2, reuse: 0 } }
  });
  batchSheet.failOnSetValuesCall = 2;

  assert.throws(
    () => context.createBulkQrIssuanceBatch({ expectedFingerprint: 'preview-finalize' }),
    /injected QR대량발급배치 write failure/
  );
  assert.equal(batchSheet.rows[1][headerIndex(QR_BATCH_HEADERS)['상태']], '생성중');
  assert.equal(itemSheet.getLastRow(), 3);

  const resumed = context.createBulkQrIssuanceBatch({ expectedFingerprint: 'preview-finalize' });
  assert.equal(resumed.batchId, 'QRB-20260827-001');
  assert.equal(resumed.status, '준비');
  assert.equal(batchSheet.getLastRow(), 2);
  assert.equal(itemSheet.getLastRow(), 3);
});

test('a cancelled partially created batch reports cancellation before item-count validation', () => {
  const { context, itemSheet } = loadQrBatchContext();
  const items = makeSnapshotItems(2);
  context.buildCurrentQrBatchSnapshot_ = () => ({
    environment: 'TEST',
    baseUrl: 'https://example.test/exec',
    previewFingerprint: 'preview-partial-cancel',
    targetFingerprint: 'target-partial-cancel',
    snapshot: { items, excluded: [], summary: { target: 2, needsIssue: 2, reuse: 0 } }
  });
  itemSheet.failNextSetValues = true;
  assert.throws(
    () => context.createBulkQrIssuanceBatch({ expectedFingerprint: 'preview-partial-cancel' }),
    /injected QR대량발급항목 write failure/
  );
  const cancelled = context.cancelBulkQrIssuanceBatch({
    batchId: 'QRB-20260827-001',
    reason: '부분 생성 취소 테스트'
  });
  assert.equal(cancelled.status, '취소');
  assert.throws(
    () => context.processBulkQrIssuanceBatch({ batchId: cancelled.batchId }),
    /취소된 QR 대량발급 배치/
  );
});

test('an unfinished batch can be cancelled without deleting its checkpoint items', () => {
  const { context, batchSheet, itemSheet } = loadQrBatchContext();
  const items = makeSnapshotItems(1);
  context.buildCurrentQrBatchSnapshot_ = () => ({
    environment: 'TEST',
    baseUrl: 'https://example.test/exec',
    previewFingerprint: 'preview-cancel',
    targetFingerprint: 'target-cancel',
    snapshot: { items, excluded: [], summary: { target: 1, needsIssue: 1, reuse: 0 } }
  });
  const created = context.createBulkQrIssuanceBatch({ expectedFingerprint: 'preview-cancel' });

  const cancelled = context.cancelBulkQrIssuanceBatch({
    batchId: created.batchId,
    reason: '마스터 변경 후 새 미리보기 필요'
  });

  assert.equal(cancelled.status, '취소');
  assert.equal(cancelled.pending, 1);
  assert.equal(batchSheet.rows[1][headerIndex(QR_BATCH_HEADERS)['상태']], '취소');
  assert.equal(itemSheet.getLastRow(), 2, 'cancellation must retain checkpoint evidence');
  assert.throws(
    () => context.processBulkQrIssuanceBatch({ batchId: created.batchId }),
    /취소된 QR 대량발급 배치/
  );
  assert.throws(
    () => context.retryFailedBulkQrIssuance({ batchId: created.batchId }),
    /취소된 QR 대량발급 배치/
  );
});

test('batch processing reuses the already validated issuance context', () => {
  const { context } = loadQrBatchContext();
  const items = makeSnapshotItems(1);
  const fingerprint = context.qrBatchFingerprint_(
    `TEST\n${batchCore.buildQrBatchTargetCanonical({ items })}`
  );
  const sentinel = { sourceReads: 1 };
  context.buildCurrentQrBatchSnapshot_ = () => ({
    environment: 'TEST',
    baseUrl: 'https://example.test/exec',
    previewFingerprint: 'preview-process',
    targetFingerprint: fingerprint,
    issuanceContext: sentinel,
    snapshot: { items, excluded: [], summary: { target: 1, needsIssue: 1, reuse: 0 } }
  });
  const created = context.createBulkQrIssuanceBatch({ expectedFingerprint: 'preview-process' });
  let receivedContext;
  context.issueQrAccessKeysUnlocked_ = (_ss, systemIds, _baseUrl, issuanceContext) => {
    receivedContext = issuanceContext;
    return {
      requested: 1,
      succeeded: 1,
      results: [{
        systemId: systemIds[0],
        ok: true,
        reused: false,
        accessKey: 'K'.repeat(32),
        lookupUrl: 'https://example.test/exec?k=' + 'K'.repeat(32)
      }]
    };
  };

  const processed = context.processBulkQrIssuanceBatch({ batchId: created.batchId });

  assert.equal(receivedContext, sentinel);
  assert.equal(processed.status, '완료');
  assert.equal(processed.succeeded, 1);
});

test('resetting failed items keeps a clean pending checkpoint in progress', () => {
  const { context } = loadQrBatchContext();
  const items = makeSnapshotItems(2);
  context.buildCurrentQrBatchSnapshot_ = () => ({
    environment: 'TEST',
    baseUrl: 'https://example.test/exec',
    previewFingerprint: 'preview-retry-state',
    targetFingerprint: 'target-retry-state',
    snapshot: { items, excluded: [], summary: { target: 2, needsIssue: 2, reuse: 0 } }
  });
  const created = context.createBulkQrIssuanceBatch({ expectedFingerprint: 'preview-retry-state' });
  const persisted = context.readQrBatchItems_({}, created.batchId);
  persisted[0].processingStatus = '성공';
  persisted[0].attempts = 1;
  persisted[1].processingStatus = '실패';
  persisted[1].attempts = 1;
  persisted[1].errorMessage = '일시 오류';
  context.updateQrBatchItems_({}, persisted);

  const reset = context.retryFailedBulkQrIssuance({ batchId: created.batchId });

  assert.equal(reset.status, '진행중');
  assert.equal(reset.succeeded, 1);
  assert.equal(reset.pending, 1);
  assert.equal(reset.failed, 0);
});

test('rerun after issuance but before item checkpoint repairs the pending item by key reuse', () => {
  const { context, itemSheet } = loadQrBatchContext();
  const items = makeSnapshotItems(1);
  const fingerprint = context.qrBatchFingerprint_(
    `TEST\n${batchCore.buildQrBatchTargetCanonical({ items })}`
  );
  context.buildCurrentQrBatchSnapshot_ = () => ({
    environment: 'TEST',
    baseUrl: 'https://example.test/exec',
    previewFingerprint: 'preview-checkpoint',
    targetFingerprint: fingerprint,
    issuanceContext: {},
    snapshot: { items, excluded: [], summary: { target: 1, needsIssue: 1, reuse: 0 } }
  });
  const created = context.createBulkQrIssuanceBatch({ expectedFingerprint: 'preview-checkpoint' });
  let activeKey = '';
  let issueCalls = 0;
  context.issueQrAccessKeysUnlocked_ = (_ss, systemIds) => {
    issueCalls += 1;
    const reused = !!activeKey;
    if (!activeKey) activeKey = 'R'.repeat(32);
    return {
      requested: 1,
      succeeded: 1,
      results: [{
        systemId: systemIds[0],
        ok: true,
        reused,
        accessKey: activeKey,
        lookupUrl: 'https://example.test/exec?k=' + activeKey
      }]
    };
  };

  itemSheet.failNextSetValues = true;
  assert.throws(
    () => context.processBulkQrIssuanceBatch({ batchId: created.batchId }),
    /injected QR대량발급항목 write failure/
  );
  const resumed = context.processBulkQrIssuanceBatch({ batchId: created.batchId });

  assert.equal(issueCalls, 2);
  assert.equal(resumed.status, '완료');
  assert.equal(resumed.reused, 1);
  assert.equal(resumed.succeeded, 0);
  assert.equal(resumed.runResults[0].accessKey, activeKey);
});
