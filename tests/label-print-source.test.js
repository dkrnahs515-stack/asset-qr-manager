'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function functionBody(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing function ${name}`);
  const tail = source.slice(start + marker.length);
  const next = tail.indexOf('\nfunction ');
  return next >= 0 ? tail.slice(0, next) : tail;
}

test('label print service exposes derived-sheet refresh and status entry points', () => {
  const source = read('apps-script/LabelPrint.gs');
  assert.match(source, /function refreshLabelPrintSheet\(\)/);
  assert.match(source, /function getLabelPrintSheetStatus\(\)/);
  assert.match(source, /LABEL_PRINT_HEADERS/);
});

test('refresh reads all authoritative sources but never issues or reissues QR keys', () => {
  const source = read('apps-script/LabelPrint.gs');
  const body = functionBody(source, 'refreshLabelPrintSheet');
  for (const constant of ['ASSET_MASTER', 'CURRENT_STATE', 'QR_ISSUE', 'LOCATION_MASTER', 'LABEL_SETTINGS']) {
    assert.ok(body.includes(`INVENTORY_CONFIG.SHEETS.${constant}`), `refresh must read ${constant}`);
  }
  assert.doesNotMatch(source, /ensureActiveQrIssueForAsset_|issueQrAccessKeys|stopAndReissueQrAccessKey/);
});

test('derived sheet formats latest judgment date, falls back to master location, and only enables printable checkboxes', () => {
  const source = read('apps-script/LabelPrint.gs');
  assert.match(source, /Utilities\.formatDate\([^,]+,\s*'Asia\/Seoul',\s*'yyyy\.MM\.dd'\)/);
  assert.match(source, /미조사/);
  assert.match(source, /currentFloor[\s\S]*asset\.floor/);
  assert.match(source, /currentSpaceName[\s\S]*asset\.spaceName/);
  assert.match(source, /requireCheckbox\(\)/);
  assert.match(source, /validation\.ok/);
});

test('derived-sheet refresh never clears source sheets and preserves non-printable active assets as visible rows', () => {
  const source = read('apps-script/LabelPrint.gs');
  assert.doesNotMatch(source, /getRequiredSheet_\([^\n]*ASSET_MASTER[^\n]*\)\.clear/);
  assert.doesNotMatch(source, /getRequiredSheet_\([^\n]*QR_ISSUE[^\n]*\)\.clear/);
  assert.match(source, /usageStatus[\s\S]*===\s*'사용'/);
  assert.match(source, /출력가능/);
});

test('runtime validation does not require the derived label-print sheet', () => {
  const runtime = read('apps-script/RuntimeConfig.gs');
  const requiredBlock = runtime.split('var ASSET_RUNTIME_REQUIRED_SHEETS = [')[1].split('];')[0];
  assert.doesNotMatch(requiredBlock, /라벨출력/);
});
