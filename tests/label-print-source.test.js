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

test('non-printable rows keep an empty selection cell instead of a visible FALSE value', () => {
  const source = read('apps-script/LabelPrint.gs');
  const rowBuilder = functionBody(source, 'labelPrintBrowseItemToRow_');
  const selector = functionBody(source, 'setLabelPrintSelections_');
  assert.match(rowBuilder, /item\.validation\.ok\s*\?\s*false\s*:\s*''/);
  assert.match(selector, /row\.printability\s*===\s*'출력가능'\s*\?[^:]+:\s*''/);
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

test('label print server exposes filters, selection controls, panel, and installable onOpen UI', () => {
  const source = read('apps-script/LabelPrint.gs');
  for (const fn of [
    'getLabelPrintPanelBootstrap',
    'applyLabelPrintSheetFilter',
    'selectVisibleLabelPrintRows',
    'clearLabelPrintSelection',
    'selectReprintLabelRows',
    'getSelectedLabelPrintSystemIds',
    'showLabelPrintPanel',
    'installLabelPrintUi',
    'labelPrintOnOpen_'
  ]) assert.match(source, new RegExp(`function ${fn}\\(`), `missing ${fn}`);
});

test('filters support search, floor, space, and output state and use row visibility instead of deleting rows', () => {
  const source = read('apps-script/LabelPrint.gs');
  const body = functionBody(source, 'applyLabelPrintSheetFilter');
  for (const field of ['search', 'floor', 'spaceName', 'outputState']) assert.ok(body.includes(field), `missing filter ${field}`);
  assert.match(body, /showRows\(/);
  assert.match(body, /hideLabelPrintRows_\(/);
  assert.match(source, /sheet\.hideRows\(/);
  assert.doesNotMatch(body, /deleteRow\(|deleteRows\(/);
});

test('bulk selection respects visible rows, printability, and reprint flags', () => {
  const source = read('apps-script/LabelPrint.gs');
  const visible = functionBody(source, 'selectVisibleLabelPrintRows');
  const reprint = functionBody(source, 'selectReprintLabelRows');
  assert.match(visible, /isRowHiddenByUser\(/);
  assert.match(visible, /출력가능/);
  assert.match(reprint, /재발급필요/);
  assert.match(reprint, /===\s*'Y'/);
  assert.match(source, /Math\.ceil\(selected\s*\/\s*24\)/);
});

test('installLabelPrintUi creates one installable spreadsheet onOpen trigger and a direct panel URL fallback', () => {
  const source = read('apps-script/LabelPrint.gs');
  const install = functionBody(source, 'installLabelPrintUi');
  assert.match(install, /ScriptApp\.getProjectTriggers\(\)/);
  assert.match(install, /getHandlerFunction\(\).*labelPrintOnOpen_/);
  assert.match(install, /ScriptApp\.newTrigger\('labelPrintOnOpen_'\)/);
  assert.match(install, /forSpreadsheet\(/);
  assert.match(install, /\.onOpen\(\)/);
  assert.match(install, /ScriptApp\.getService\(\)\.getUrl\(\)/);
  assert.match(install, /\?view=label-panel/);

  const onOpen = functionBody(source, 'labelPrintOnOpen_');
  assert.match(onOpen, /createMenu\('QR 라벨'\)/);
});

test('standalone Apps Script can fall back to web panel when Spreadsheet UI is unavailable', () => {
  const source = read('apps-script/LabelPrint.gs');
  const showPanel = functionBody(source, 'showLabelPrintPanel');
  const install = functionBody(source, 'installLabelPrintUi');
  const onOpen = functionBody(source, 'labelPrintOnOpen_');
  assert.match(showPanel, /try\s*\{/);
  assert.match(showPanel, /catch\s*\(/);
  assert.match(showPanel, /panelUrl/);
  assert.match(install, /uiInstalled/);
  assert.match(onOpen, /try\s*\{/);
  assert.match(onOpen, /catch\s*\(/);
});

test('label print panel contains all approved controls and popup-blocker fallback', () => {
  const panel = read('apps-script/LabelPrintPanel.html');
  for (const label of ['목록 새로고침', '현재 필터 전체선택', '선택해제', '재출력 대상 선택', '선택 라벨 미리보기']) {
    assert.ok(panel.includes(label), `missing panel action: ${label}`);
  }
  for (const filter of ['search', 'floor', 'spaceName', 'outputState']) assert.ok(panel.includes(filter), `missing panel filter: ${filter}`);
  assert.match(panel, /google\.script\.run/);
  assert.match(panel, /window\.open\(['"]about:blank['"],\s*['"]_blank['"]\)/);
  assert.match(panel, /preview-fallback/);
  assert.match(panel, /estimatedPages/);
});
