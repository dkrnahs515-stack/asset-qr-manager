const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeAssetNumber,
  validateChangeLogPayload
} = require('../apps-script/Core.js');

const root = path.resolve(__dirname, '..');

function validRevisionChange() {
  return {
    sessionId: 'INV-2026-001',
    recordId: 'INVR-2026-001-0386',
    systemId: 'GSYC-000386',
    changedAt: new Date('2026-08-20T13:46:40.000Z'),
    changedBy: '이건희',
    actionType: '판정수정',
    targetField: '전수조사기록 상태',
    beforeValue: '{}',
    afterValue: '{}',
    reason: '정상 → 위치변경 · 판정 수정 기능 테스트',
    actionUuid: 'audit-action-1'
  };
}

test('asset numbers accidentally converted to dates are restored to year-sequence text', () => {
  assert.equal(normalizeAssetNumber(new Date(2019, 9, 1)), '2019-10');
  assert.equal(normalizeAssetNumber('Tue Oct 01 2019 00:00:00 GMT+0900 (한국 표준시)'), '2019-10');
  assert.equal(normalizeAssetNumber('Sat Jan 01 1994 00:00:00 GMT+0900 (한국 표준시)'), '1994-1');
  assert.equal(normalizeAssetNumber('2019-10'), '2019-10');
  assert.equal(normalizeAssetNumber('2022-O-54'), '2022-O-54');
});

test('change-log validation accepts legitimate blank identifiers and creation before-values', () => {
  assert.doesNotThrow(() => validateChangeLogPayload(validRevisionChange()));

  const created = {
    ...validRevisionChange(),
    actionType: '미등록발견',
    beforeValue: '',
    afterValue: '{"tempAssetId":"TMP-2026-0001"}'
  };
  assert.doesNotThrow(() => validateChangeLogPayload(created));

  const roomCloseout = {
    ...validRevisionChange(),
    recordId: '',
    systemId: '',
    actionType: '공간마감',
    targetField: '대표위치코드'
  };
  assert.doesNotThrow(() => validateChangeLogPayload(roomCloseout));
});

test('change-log validation rejects incomplete audit rows before they can be written', () => {
  for (const field of ['actionType', 'targetField', 'changedBy', 'reason', 'actionUuid']) {
    const incomplete = validRevisionChange();
    delete incomplete[field];
    assert.throws(() => validateChangeLogPayload(incomplete), new RegExp(field === 'actionType' ? '작업유형' : field === 'targetField' ? '대상필드' : field === 'changedBy' ? '변경자' : field === 'reason' ? '변경사유' : '작업UUID'));
  }

  const missingBefore = validRevisionChange();
  delete missingBefore.beforeValue;
  assert.throws(() => validateChangeLogPayload(missingBefore), /변경전값/);

  const missingRecord = validRevisionChange();
  missingRecord.recordId = '';
  assert.throws(() => validateChangeLogPayload(missingRecord), /기록ID/);
});

test('Apps Script normalizes old asset numbers and validates a revision log before record mutation', () => {
  const code = fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8');
  const inspection = fs.readFileSync(path.join(root, 'apps-script/Inspection.gs'), 'utf8');
  const revision = inspection.split('function reviseInspectionActionFromMobile(payload) {')[1]
    .split('function undoInspectionAction(payload) {')[0];

  assert.match(code, /oldAssetNo:\s*normalizeAssetNumber\(row\[index\['Old 비품번호'\]\]\)/);
  assert.match(code, /oldAssetNo:\s*normalizeAssetNumber\(value\('Old 비품번호'\)\)/);
  assert.match(code, /oldAssetNo:\s*normalizeAssetNumber\(record\.oldAssetNo\)/);
  assert.match(code, /function appendChangeLog_\(sheet, change\) \{\s*validateChangeLogPayload\(change\);/);
  assert.match(revision, /var changeEntry = \{/);

  const validateAt = revision.indexOf('validateChangeLogPayload(changeEntry);');
  const writeAt = revision.indexOf('writeInspectionRecord_(recordSheet, found.rowNumber, nextRecord);');
  assert.ok(validateAt >= 0 && writeAt >= 0 && validateAt < writeAt,
    '판정수정 변경이력은 전수조사기록을 쓰기 전에 검증되어야 합니다.');
});
