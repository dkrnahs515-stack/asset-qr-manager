const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sourcePath = 'apps-script/QrAdmin.gs';

function readSource() {
  assert.ok(fs.existsSync(sourcePath), 'apps-script/QrAdmin.gs must exist');
  return fs.readFileSync(sourcePath, 'utf8');
}

test('QR admin exposes locked issue, reissue, and audit entry points', () => {
  const source = readSource();
  assert.match(source, /function issueQrAccessKeys\(request\)/);
  assert.match(source, /function stopAndReissueQrAccessKey\(request\)/);
  assert.match(source, /function auditQrIssues\(\)/);
  assert.match(source, /LockService\.getScriptLock\(\)/);
  assert.match(source, /Utilities\.computeDigest/);
  assert.match(source, /Utilities\.base64EncodeWebSafe/);
});

test('QR issuance uses exact key lookups, reuses one active row, and updates the master URL', () => {
  const source = readSource();
  assert.match(source, /matchEntireCell\(true\)/);
  assert.match(source, /findActiveQrIssue/);
  assert.match(source, /function updateMasterQrUrl_/);
  assert.match(source, /'QR조회URL'/);
  assert.doesNotMatch(source, /deleteRow\(|deleteRows\(/);
});

test('QR issuance rejects duplicate permanent IDs in the asset master', () => {
  const source = readSource();
  const reader = source
    .split('function readQrAdminMasterAssetById_')[1]
    .split('\nfunction updateMasterQrUrl_')[0];

  assert.match(reader, /findAll\(\)/);
  assert.match(reader, /영구 시스템 ID가 중복/);
});

test('QR issuance requires the stable detail deployment URL from label settings', () => {
  const source = readSource();
  assert.match(source, /readRequiredLabelSetting_\('상세조회배포URL'\)/);
  assert.match(source, /buildQrLookupUrl/);
  assert.match(source, /재발급 사유/);
});
