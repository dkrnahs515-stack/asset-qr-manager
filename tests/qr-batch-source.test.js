const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sourcePath = 'apps-script/QrBatch.gs';

function readSource() {
  assert.ok(fs.existsSync(sourcePath), 'apps-script/QrBatch.gs must exist');
  return fs.readFileSync(sourcePath, 'utf8');
}

function loadQrBatchSource(context = {}) {
  vm.runInNewContext(readSource(), context);
  return context;
}

test('batch creator records 미기재 when Apps Script cannot read the active user email', () => {
  const context = loadQrBatchSource({
    Session: {
      getActiveUser() {
        return {
          getEmail() {
            throw new Error('userinfo.email permission is unavailable');
          }
        };
      }
    }
  });

  assert.equal(context.qrBatchCreator_({}), '미기재');
});

test('batch creator preserves an explicitly selected operator name without reading email', () => {
  const context = loadQrBatchSource({
    Session: {
      getActiveUser() {
        throw new Error('email lookup must not run for an explicit operator');
      }
    }
  });

  assert.equal(context.qrBatchCreator_({ actor: '운영자' }), '운영자');
});

test('bulk QR adapter exposes dry-run, create, process, retry, and status entry points', () => {
  const source = readSource();
  for (const entryPoint of [
    'previewBulkQrIssuance',
    'createBulkQrIssuanceBatch',
    'processBulkQrIssuanceBatch',
    'cancelBulkQrIssuanceBatch',
    'retryFailedBulkQrIssuance',
    'getBulkQrIssuanceStatus'
  ]) {
    assert.match(source, new RegExp(`function ${entryPoint}\\(`), `missing ${entryPoint}`);
  }
});

test('bulk QR mutations are locked and one unfinished batch blocks another', () => {
  const source = readSource();
  for (const entryPoint of [
    'createBulkQrIssuanceBatch',
    'processBulkQrIssuanceBatch',
    'cancelBulkQrIssuanceBatch',
    'retryFailedBulkQrIssuance'
  ]) {
    const body = source.split(`function ${entryPoint}(`)[1].split('\nfunction ')[0];
    assert.match(body, /LockService\.getScriptLock\(\)/, `${entryPoint} must lock`);
    assert.match(body, /waitLock\(30000\)/, `${entryPoint} must wait for lock`);
  }
  assert.match(source, /\['생성중',\s*'준비',\s*'진행중',\s*'일시중단'\]/);
  assert.match(source, /완료되지 않은 QR 대량발급 배치/);
});

test('dry-run fingerprint is SHA-256 and creation rejects stale previews', () => {
  const source = readSource();
  assert.match(source, /Utilities\.computeDigest\(\s*Utilities\.DigestAlgorithm\.SHA_256/);
  assert.match(source, /Utilities\.base64EncodeWebSafe/);
  assert.match(source, /buildQrBatchSnapshot/);
  assert.match(source, /buildQrBatchCanonical/);
  assert.match(source, /request\.expectedFingerprint/);
  assert.match(source, /미리보기 fingerprint가 현재 대상 상태와 다릅니다/);
});

test('processing revalidates the snapshot and issues at most 50 through the shared idempotent path', () => {
  const source = readSource();
  const body = source
    .split('function processBulkQrIssuanceBatch(')[1]
    .split('\nfunction retryFailedBulkQrIssuance')[0];
  assert.match(body, /selectQrBatchItems\(items,\s*QR_BATCH_MAX_SIZE\)/);
  assert.match(body, /issueQrAccessKeysUnlocked_\(ss, systemIds, baseUrl, current\.issuanceContext\)/);
  assert.match(body, /buildCurrentQrBatchSnapshot_/);
  assert.match(body, /batch\.fingerprint/);
  assert.doesNotMatch(body, /issueQrAccessKeys\(\{/);
});

test('batch state is persisted in the two approved sheets and failed rows require explicit reset', () => {
  const source = readSource();
  assert.match(source, /QR대량발급배치/);
  assert.match(source, /QR대량발급항목/);
  assert.match(source, /resetFailedQrBatchItems/);
  assert.match(source, /summarizeQrBatchItems/);
  assert.match(source, /처리상태/);
  assert.match(source, /오류메시지/);
  assert.doesNotMatch(source, /PropertiesService[\s\S]*QR_BATCH/);
});

test('Apps Script editor helpers stage a ten-minute preview and operate the single open batch without arguments', () => {
  const source = readSource();
  for (const helper of [
    'stageBulkQrIssuancePreview',
    'createBulkQrIssuanceBatchFromStagedPreview',
    'processOpenBulkQrIssuanceBatch',
    'cancelOpenBulkQrIssuanceBatch',
    'retryFailedOpenBulkQrIssuance',
    'getOpenBulkQrIssuanceStatus'
  ]) {
    assert.match(source, new RegExp(`function ${helper}\\(\\)`), `missing editor helper ${helper}`);
  }
  assert.match(source, /CacheService\.getUserCache\(\)/);
  assert.match(source, /cache\.put\([^,]+,\s*preview\.fingerprint,\s*600\)/);
  assert.match(source, /createBulkQrIssuanceBatch\(\{\s*expectedFingerprint:/);
  assert.match(source, /processBulkQrIssuanceBatch\(\{\s*batchId:/);
  assert.match(source, /retryFailedBulkQrIssuance\(\{\s*batchId:/);
});
