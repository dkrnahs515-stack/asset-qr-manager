const test = require('node:test');
const assert = require('node:assert/strict');
const {
  base64UrlFromBytes,
  isValidQrAccessKey,
  buildQrLookupUrl,
  buildInitialQrIssueRecord,
  findActiveQrIssue
} = require('../apps-script/QrCore.js');

const VALID_KEY = 'AbcdEFGHijklMNOPqrstUVWXyz01_234';
const BASE_URL = 'https://script.google.com/macros/s/DEPLOYMENT123/exec';

test('QR access keys are exactly 32 URL-safe characters', () => {
  const key = base64UrlFromBytes(Array.from({ length: 32 }, (_, i) => i)).slice(0, 32);
  assert.equal(key.length, 32);
  assert.match(key, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(isValidQrAccessKey(key), true);
  assert.equal(isValidQrAccessKey('GSYC-000001'), false);
  assert.equal(isValidQrAccessKey('a'.repeat(31)), false);
});

test('lookup URL contains only the permanent access key query parameter', () => {
  assert.equal(
    buildQrLookupUrl(BASE_URL, VALID_KEY),
    `${BASE_URL}?k=${VALID_KEY}`
  );
  assert.throws(() => buildQrLookupUrl(`${BASE_URL}?old=1`, VALID_KEY), /query parameter/i);
  assert.throws(() => buildQrLookupUrl('http://example.com/exec', VALID_KEY), /\/exec URL/);
  assert.throws(() => buildQrLookupUrl(BASE_URL, 'GSYC-000001'), /접근키/);
});

test('active QR lookup ignores stopped history and rejects duplicate active rows', () => {
  const active = findActiveQrIssue([
    { systemId: 'GSYC-000001', accessKeyStatus: '중지', accessKey: 'old' },
    { systemId: 'GSYC-000001', accessKeyStatus: '사용', accessKey: VALID_KEY }
  ], 'GSYC-000001');
  assert.equal(active.accessKey, VALID_KEY);

  assert.throws(() => findActiveQrIssue([
    { systemId: 'GSYC-000001', accessKeyStatus: '사용', accessKey: VALID_KEY },
    { systemId: 'GSYC-000001', accessKeyStatus: '사용', accessKey: 'Z'.repeat(32) }
  ], 'GSYC-000001'), /중복/);
});

test('initial issue record preserves the permanent asset link without print claims', () => {
  const now = new Date('2026-08-25T00:00:00Z');
  const record = buildInitialQrIssueRecord(
    { systemId: 'GSYC-000001' },
    VALID_KEY,
    `${BASE_URL}?k=${VALID_KEY}`,
    now
  );

  assert.equal(record.systemId, 'GSYC-000001');
  assert.equal(record.accessKey, VALID_KEY);
  assert.equal(record.accessKeyStatus, '사용');
  assert.equal(record.issueStatus, '미발급');
  assert.equal(record.reprintRequired, 'N');
  assert.equal(record.reprintCount, 0);
  assert.equal(record.firstIssuedAt.toISOString(), now.toISOString());
  assert.equal(record.lastPrintedAt, '');
});
