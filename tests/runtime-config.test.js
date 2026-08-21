const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimeModulePath = path.join(__dirname, '..', 'apps-script', 'RuntimeConfigCore.js');

function loadRuntimeModule() {
  assert.ok(
    fs.existsSync(runtimeModulePath),
    'apps-script/RuntimeConfigCore.js must exist before runtime configuration can be resolved'
  );
  delete require.cache[require.resolve(runtimeModulePath)];
  return require(runtimeModulePath);
}

const APPROVED_PROPERTIES = {
  ASSET_APP_ENV: 'TEST',
  ASSET_TEST_SPREADSHEET_ID: '1jphVHn1W4DpBkeKwi5mZx5rpuMHkQ9oYE4rEI9au3oQ',
  ASSET_PRODUCTION_SPREADSHEET_ID: '1R5WjwpXtsJwQfIvNnQ_D5PLD6TTLXqTlQ7CSjbUa274',
  ASSET_RUNTIME_CONFIG_VERSION: '2026-08-21-v1'
};

test('TEST environment selects only the approved test sheet and test-scoped photo keys', () => {
  const { resolveRuntimeConfig } = loadRuntimeModule();
  const config = resolveRuntimeConfig(APPROVED_PROPERTIES);

  assert.equal(config.environment, 'TEST');
  assert.equal(config.displayLabel, '테스트');
  assert.equal(config.isProduction, false);
  assert.equal(config.spreadsheetId, APPROVED_PROPERTIES.ASSET_TEST_SPREADSHEET_ID);
  assert.equal(config.photoRootIdKey, 'ASSET_TEST_PHOTO_ROOT_ID');
  assert.equal(config.photoSessionIdPrefix, 'ASSET_TEST_PHOTO_SESSION_');
  assert.equal(config.photoRootName, '강서청소년회관 비품 전수조사 사진 [TEST]');
});

test('PRODUCTION environment selects only the approved production sheet and production photo keys', () => {
  const { resolveRuntimeConfig } = loadRuntimeModule();
  const config = resolveRuntimeConfig({
    ...APPROVED_PROPERTIES,
    ASSET_APP_ENV: 'PRODUCTION'
  });

  assert.equal(config.environment, 'PRODUCTION');
  assert.equal(config.displayLabel, '운영');
  assert.equal(config.isProduction, true);
  assert.equal(config.spreadsheetId, APPROVED_PROPERTIES.ASSET_PRODUCTION_SPREADSHEET_ID);
  assert.equal(config.photoRootIdKey, 'ASSET_PRODUCTION_PHOTO_ROOT_ID');
  assert.equal(config.photoSessionIdPrefix, 'ASSET_PRODUCTION_PHOTO_SESSION_');
  assert.equal(config.photoRootName, '강서청소년회관 비품 전수조사 사진');
});

test('runtime resolution fails closed for missing, invalid, incomplete, or colliding configuration', () => {
  const { resolveRuntimeConfig } = loadRuntimeModule();

  assert.throws(
    () => resolveRuntimeConfig({ ...APPROVED_PROPERTIES, ASSET_APP_ENV: '' }),
    /ASSET_APP_ENV/
  );
  assert.throws(
    () => resolveRuntimeConfig({ ...APPROVED_PROPERTIES, ASSET_APP_ENV: 'DEV' }),
    /TEST 또는 PRODUCTION/
  );
  assert.throws(
    () => resolveRuntimeConfig({ ...APPROVED_PROPERTIES, ASSET_TEST_SPREADSHEET_ID: '' }),
    /ASSET_TEST_SPREADSHEET_ID/
  );
  assert.throws(
    () => resolveRuntimeConfig({
      ...APPROVED_PROPERTIES,
      ASSET_TEST_SPREADSHEET_ID: APPROVED_PROPERTIES.ASSET_PRODUCTION_SPREADSHEET_ID
    }),
    /서로 달라야/
  );
});

test('Apps Script integration reads Script Properties and no longer uses an active hardcoded spreadsheet ID', () => {
  const codeSource = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const runtimePath = path.join(__dirname, '..', 'apps-script', 'RuntimeConfig.gs');

  assert.doesNotMatch(codeSource, /SPREADSHEET_ID\s*:/);
  assert.ok(fs.existsSync(runtimePath), 'apps-script/RuntimeConfig.gs must exist');

  const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
  assert.match(runtimeSource, /PropertiesService\.getScriptProperties\(\)/);
  assert.match(runtimeSource, /function getRuntimeConfig_\(\)/);
  assert.match(runtimeSource, /function getSpreadsheet_\(\)/);
  assert.match(runtimeSource, /SpreadsheetApp\.openById\(config\.spreadsheetId\)/);
  assert.match(runtimeSource, /function setupApprovedTestRuntime\(\)/);
  assert.match(runtimeSource, /function switchRuntimeEnvironment\(environment, confirmation\)/);
  assert.match(runtimeSource, /SWITCH_TO_PRODUCTION/);
});

test('approved TEST setup writes both sheet IDs but activates TEST only', () => {
  const runtimePath = path.join(__dirname, '..', 'apps-script', 'RuntimeConfig.gs');
  assert.ok(fs.existsSync(runtimePath), 'apps-script/RuntimeConfig.gs must exist');
  const source = fs.readFileSync(runtimePath, 'utf8');

  assert.match(source, /1jphVHn1W4DpBkeKwi5mZx5rpuMHkQ9oYE4rEI9au3oQ/);
  assert.match(source, /1R5WjwpXtsJwQfIvNnQ_D5PLD6TTLXqTlQ7CSjbUa274/);
  assert.match(source, /ASSET_APP_ENV[\s\S]*TEST/);
  assert.doesNotMatch(source, /setupApprovedTestRuntime[\s\S]{0,1000}ASSET_APP_ENV[\s\S]{0,80}PRODUCTION/);
});

test('photo folder persistence is scoped by the selected runtime environment', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'FieldOps.gs'), 'utf8');
  const body = source.split('function getInventoryPhotoFolder_(')[1].split('\nfunction ')[0];

  assert.match(body, /getRuntimeConfig_\(\)/);
  assert.match(body, /config\.photoRootIdKey/);
  assert.match(body, /config\.photoSessionIdPrefix/);
  assert.match(body, /config\.photoRootName/);
});

test('bootstrap and mobile UI expose a visible runtime marker', () => {
  const codeSource = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const uiSource = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Index.html'), 'utf8');

  assert.match(codeSource, /getRuntimeEnvironmentStatus\(\)/);
  assert.match(codeSource, /runtime:/);
  assert.match(uiSource, /runtime-banner/);
  assert.match(uiSource, /bootstrap\?\.runtime/);
  assert.match(uiSource, /테스트 환경/);
});
