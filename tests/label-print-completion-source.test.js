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

test('label print completion exposes token-only locked entry point', () => {
  const source = read('apps-script/LabelPrintCompletion.gs');
  assert.match(source, /function completeLabelPrintBatch\(request\)/);
  const body = functionBody(source, 'completeLabelPrintBatch');
  assert.match(body, /request\.token/);
  assert.match(body, /loadLabelPrintPreviewSnapshot_\(/);
  assert.match(body, /LockService\.getScriptLock\(\)/);
  assert.match(body, /lock\.waitLock\(30000\)/);
  assert.match(body, /lock\.releaseLock\(\)/);
  assert.doesNotMatch(body, /request\.systemIds|request\.batchId|request\.qrUrl|request\.manager/);
});

test('completion revalidates environment and active QR identity before writes', () => {
  const source = read('apps-script/LabelPrintCompletion.gs');
  const body = functionBody(source, 'completeLabelPrintBatch');
  assert.match(body, /snapshot\.environment/);
  assert.match(body, /config\.environment/);
  assert.match(body, /readAllQrIssueRows_\(/);
  assert.match(body, /accessKeyStatus/);
  assert.match(body, /item\.accessKey/);
  assert.match(body, /item\.qrUrl/);
});

test('completion records cached printed facts and delegates idempotency to core patch builder', () => {
  const source = read('apps-script/LabelPrintCompletion.gs');
  const body = functionBody(source, 'completeLabelPrintBatch');
  for (const marker of [
    'snapshot.batchId',
    'snapshot.printSettings',
    'item.printType',
    'item.inspectionDate',
    'buildLabelPrintCompletionPatch',
    'updateQrIssue_'
  ]) assert.ok(body.includes(marker), `missing completion marker: ${marker}`);
  assert.match(body, /patch\.duplicate/);
});

test('completion supports partial retry and returns exact result counts', () => {
  const source = read('apps-script/LabelPrintCompletion.gs');
  const body = functionBody(source, 'completeLabelPrintBatch');
  assert.match(body, /try\s*\{/);
  assert.match(body, /catch\s*\(error\)/);
  for (const field of ['batchId', 'requested', 'updated', 'skipped', 'failed', 'results']) {
    assert.ok(body.includes(field), `missing result field: ${field}`);
  }
});

test('completion server file participates in syntax verification', () => {
  const syntax = read('tests/syntax.test.js');
  assert.match(syntax, /apps-script\/LabelPrintCompletion\.gs/);
});
