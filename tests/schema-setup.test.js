const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const currentStateHeaders = [
  '영구 시스템 ID', 'New 비품번호', '품명', '현재위치코드', '현재층', '현재공간명',
  '현재세부위치', '위치출처', '현재조사결과', '최근조사세션ID', '최근조사명',
  '최근조사구분', '최근조사차수', '최근판정일시', '최근판정자', '마지막실물확인일시',
  '마지막실물확인자', '마지막위치변경일시', '마지막위치변경자', '이전위치코드',
  '이전층', '이전공간명', '근거기록ID', '마스터반영여부', '동기화상태',
  '동기화오류', '버전', '최종동기화일시'
];

const qrIssueHeaders = [
  '영구 시스템 ID', 'QR접근키', 'QR접근키상태', 'QR조회URL', 'QR발급상태',
  '라벨유형', '라벨버전', '인쇄책임자 정', '인쇄책임자 부', '책임자버전',
  '라벨기준조사일', '최초발급일시', '최종출력일시', '재출력필요여부',
  '재출력사유', '재출력횟수', '최종출력배치ID', '비고'
];

const labelPrintHeaders = [
  '출력선택', '출력구분', 'New 비품번호', '품명', '현재층', '현재공간명',
  '현재조사결과', 'QR상태', 'QR발급상태', '재출력필요', '최근조사일',
  '출력가능여부', '영구 시스템 ID', 'QR조회URL', '위치정렬순서'
];

test('schema installer declares all three QR subsystem sheets and exact headers', () => {
  const source = read('apps-script/SchemaSetup.gs');
  assert.match(source, /function installAssetQrSchema\(\)/);
  assert.match(source, /비품현재상태/);
  assert.match(source, /QR발급관리/);
  assert.match(source, /라벨설정/);

  for (const header of currentStateHeaders) assert.ok(source.includes(`'${header}'`), `missing current-state header: ${header}`);
  for (const header of qrIssueHeaders) assert.ok(source.includes(`'${header}'`), `missing QR issue header: ${header}`);
});

test('schema installer is locked, idempotent, and preserves existing settings', () => {
  const source = read('apps-script/SchemaSetup.gs');
  assert.match(source, /LockService\.getScriptLock\(\)/);
  assert.match(source, /function ensureSheetSchema_\(/);
  assert.match(source, /function seedLabelSettings_\(/);
  assert.match(source, /existingKeys/);
  assert.match(source, /createdSheets/);
  assert.match(source, /addedHeaders/);
  assert.match(source, /seededSettings/);
  assert.doesNotMatch(source, /clearContents\(/);
});

test('schema expands the sheet grid before writing 28 headers and preserves physical header positions', () => {
  const source = read('apps-script/SchemaSetup.gs');
  assert.match(source, /function ensureSheetCapacity_\(/);
  const body = source.split('function ensureSheetSchema_(')[1].split('\nfunction ')[0];
  assert.ok(
    body.indexOf('ensureSheetCapacity_') >= 0 && body.indexOf('ensureSheetCapacity_') < body.indexOf('setValues'),
    'grid capacity must be ensured before writing headers'
  );
  assert.match(body, /sheet\.getLastColumn\(\) \+ 1/);
  const reader = source.split('function readSchemaHeaders_(')[1].split('\nfunction ')[0];
  assert.doesNotMatch(reader, /\.filter\(/, 'header reader must not collapse blank physical columns');
});

test('label settings include approved managers and exact Formtec defaults', () => {
  const source = read('apps-script/SchemaSetup.gs');
  for (const required of [
    "['관리책임자 정', '김은영']",
    "['관리책임자 부', '김정훈']",
    "['기본 라벨규격', 'FORMTEC_LS3106']",
    "['라벨버전', 'LABEL-2026-01']",
    "['라벨가로mm', '64']",
    "['라벨세로mm', '33.9']",
    "['페이지열수', '3']",
    "['페이지행수', '8']",
    "['페이지왼쪽여백mm', '6.5']",
    "['페이지위쪽여백mm', '12.5']",
    "['열간격mm', '2.5']",
    "['QR크기mm', '20']",
    "['가로보정mm', '-1.8']",
    "['세로보정mm', '2.7']",
    "['3열가로보정mm', '0.3']"
  ]) assert.ok(source.includes(required), `missing setting: ${required}`);
});

test('label-print work sheet has the exact 15-column row-four contract', () => {
  const source = read('apps-script/SchemaSetup.gs');
  assert.match(source, /var LABEL_PRINT_HEADERS = \[/);
  for (const header of labelPrintHeaders) assert.ok(source.includes(`'${header}'`), `missing label-print header: ${header}`);
  assert.match(source, /function ensureLabelPrintWorkSheet_\(/);
  assert.match(source, /setFrozenRows\(4\)/);
  assert.match(source, /hideColumns\(13,\s*3\)/);
});

test('session metadata and shared sheet names are declared', () => {
  const schema = read('apps-script/SchemaSetup.gs');
  const code = read('apps-script/Code.gs');
  const labelPrint = read('apps-script/LabelPrint.gs');
  for (const header of ['조사구분', '조사차수', '조사표기명', '조사목적']) {
    assert.ok(schema.includes(`'${header}'`), `missing session metadata header: ${header}`);
  }
  assert.match(code, /CURRENT_STATE:\s*'비품현재상태'/);
  assert.match(code, /QR_ISSUE:\s*'QR발급관리'/);
  assert.match(code, /LABEL_SETTINGS:\s*'라벨설정'/);
  assert.match(labelPrint, /LABEL_PRINT_SHEET_NAME\s*=\s*'라벨출력'/);
});

test('derived label-print sheet is not a runtime-required source sheet', () => {
  const runtime = read('apps-script/RuntimeConfig.gs');
  const required = runtime.split('var ASSET_RUNTIME_REQUIRED_SHEETS = [')[1].split('];')[0];
  assert.doesNotMatch(required, /라벨출력/);
});

test('new Apps Script files participate in syntax verification', () => {
  const source = read('tests/syntax.test.js');
  assert.match(source, /apps-script\/CurrentStateCore\.js/);
  assert.match(source, /apps-script\/SchemaSetup\.gs/);
  assert.match(source, /apps-script\/LabelPrintCore\.js/);
  assert.match(source, /apps-script\/LabelPrint\.gs/);
});
