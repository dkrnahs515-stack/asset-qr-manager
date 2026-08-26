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

test('preview service exposes immutable snapshot lifecycle entry points', () => {
  const source = read('apps-script/LabelPrintPreview.gs');
  for (const name of [
    'createSelectedLabelPrintPreview',
    'prepareLabelPrintPreview',
    'getLabelPrintPreviewModel',
    'makeNextLabelPrintBatchId_',
    'makeLabelPrintPreviewToken_',
    'storeLabelPrintPreviewSnapshot_',
    'loadLabelPrintPreviewSnapshot_',
    'validateLabelPrintPreviewSnapshot_'
  ]) assert.match(source, new RegExp(`function ${name}\\(`), `missing ${name}`);
});

test('preview preparation re-reads authoritative sources and never calls QR mutation helpers', () => {
  const source = read('apps-script/LabelPrintPreview.gs');
  const body = functionBody(source, 'prepareLabelPrintPreview');
  for (const marker of [
    'readLabelPrintMasterAssets_',
    'readCurrentStateMap_',
    'readAllQrIssueRows_',
    'readLabelPrintLocationOrderMap_',
    'readLabelSettingsMap_'
  ]) assert.match(body, new RegExp(marker));
  assert.match(body, /validateLabelPrintCandidate/);
  assert.match(body, /failures/);
  assert.match(body, /throw new Error/);
  assert.doesNotMatch(source, /ensureActiveQrIssueForAsset_|issueQrAccessKeys|stopAndReissueQrAccessKey|createNewQrIssueRow_/);
});

test('batch ID is allocated only after all requested items validate', () => {
  const source = read('apps-script/LabelPrintPreview.gs');
  const body = functionBody(source, 'prepareLabelPrintPreview');
  const validationAt = body.indexOf('failures.length');
  const batchAt = body.indexOf('makeNextLabelPrintBatchId_');
  assert.ok(validationAt >= 0 && batchAt > validationAt, 'batch allocation must happen after aggregate validation');
  const batchBody = functionBody(source, 'makeNextLabelPrintBatchId_');
  assert.match(batchBody, /LockService\.getScriptLock\(\)/);
  assert.match(batchBody, /ASSET_LABEL_BATCH_SEQUENCE_/);
  assert.match(batchBody, /Utilities\.formatDate\([^,]+,\s*'Asia\/Seoul',\s*'yyyyMMdd'\)/);
});

test('snapshot freezes printed facts and stores cache chunks by page for six hours', () => {
  const source = read('apps-script/LabelPrintPreview.gs');
  const prepare = functionBody(source, 'prepareLabelPrintPreview');
  for (const field of [
    'batchId', 'environment', 'printSettings', 'inspectionDate', 'accessKey',
    'qrUrl', 'newAssetNo', 'name', 'currentFloor', 'currentSpaceName', 'currentResult',
    'printType', 'locationSortOrder'
  ]) assert.ok(prepare.includes(field), `snapshot missing ${field}`);

  const settingsSnapshot = functionBody(source, 'buildLabelPrintSettingsSnapshot_');
  for (const field of [
    'labelType', 'labelVersion', 'labelTitle', 'labelWidthMm', 'labelHeightMm',
    'columns', 'rows', 'pageSize', 'leftMarginMm', 'topMarginMm', 'columnGapMm',
    'rowGapMm', 'qrSizeMm', 'xCorrectionMm', 'yCorrectionMm',
    'thirdColumnXCorrectionMm', 'printScale', 'primaryManager', 'secondaryManager',
    'managerVersion'
  ]) assert.ok(settingsSnapshot.includes(field), `print settings snapshot missing ${field}`);

  const manifestKey = functionBody(source, 'labelPrintPreviewManifestKey_');
  const pageKey = functionBody(source, 'labelPrintPreviewPageKey_');
  assert.match(manifestKey, /LPV:/);
  assert.match(manifestKey, /:manifest/);
  assert.match(pageKey, /LPV:/);
  assert.match(pageKey, /:page:/);

  const store = functionBody(source, 'storeLabelPrintPreviewSnapshot_');
  assert.match(store, /CacheService\.getScriptCache\(\)/);
  assert.match(store, /labelPrintPreviewManifestKey_/);
  assert.match(store, /labelPrintPreviewPageKey_/);
  assert.match(source, /LABEL_PRINT_PREVIEW_CACHE_TTL_SECONDS\s*=\s*21600/);
  assert.match(store, /compactPage\.length > 24/);
});

test('preview load accepts only opaque tokens and revalidates environment and active QR identity', () => {
  const source = read('apps-script/LabelPrintPreview.gs');
  const load = functionBody(source, 'loadLabelPrintPreviewSnapshot_');
  const validate = functionBody(source, 'validateLabelPrintPreviewSnapshot_');
  assert.match(load, /\^\[A-Za-z0-9_-\]\{32,64\}\$/);
  assert.match(validate, /getRuntimeConfig_\(\)/);
  assert.match(validate, /snapshot\.environment/);
  assert.match(validate, /readAllQrIssueRows_/);
  assert.match(validate, /accessKey/);
  assert.match(validate, /qrUrl/);
  assert.match(validate, /사용/);
  assert.doesNotMatch(validate, /snapshot\.items\s*=|item\.name\s*=|item\.inspectionDate\s*=/);
});

test('preview model derives 24-slot pages and calibrated positions from cached settings only', () => {
  const source = read('apps-script/LabelPrintPreview.gs');
  const body = functionBody(source, 'getLabelPrintPreviewModel');
  assert.match(body, /loadLabelPrintPreviewSnapshot_/);
  assert.match(body, /validateLabelPrintPreviewSnapshot_/);
  assert.match(body, /paginateLabelPrintItems/);
  assert.match(body, /calculateLabelSlotPosition/);
  assert.match(body, /snapshot\.printSettings/);
});

test('selected preview URL uses the existing web-app deployment and a token only', () => {
  const source = read('apps-script/LabelPrintPreview.gs');
  const body = functionBody(source, 'createSelectedLabelPrintPreview');
  assert.match(body, /getSelectedLabelPrintSystemIds\(\)/);
  assert.match(body, /ScriptApp\.getService\(\)\.getUrl\(\)/);
  assert.match(body, /\?view=label-print&token=/);
  assert.doesNotMatch(body, /systemId=/);
});
