'use strict';

var ASSET_RUNTIME_ENVIRONMENTS = ['TEST', 'PRODUCTION'];

function runtimeConfigText_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function requireRuntimeProperty_(properties, key) {
  var value = runtimeConfigText_((properties || {})[key]);
  if (!value) {
    throw new Error('Script Property가 필요합니다: ' + key);
  }
  return value;
}

function resolveRuntimeConfig(properties) {
  var source = properties || {};
  var environment = requireRuntimeProperty_(source, 'ASSET_APP_ENV').toUpperCase();
  if (ASSET_RUNTIME_ENVIRONMENTS.indexOf(environment) < 0) {
    throw new Error('ASSET_APP_ENV는 TEST 또는 PRODUCTION이어야 합니다.');
  }

  var projectRole = requireRuntimeProperty_(source, 'ASSET_PROJECT_ROLE').toUpperCase();
  if (ASSET_RUNTIME_ENVIRONMENTS.indexOf(projectRole) < 0) {
    throw new Error('Apps Script 프로젝트 역할은 TEST 또는 PRODUCTION이어야 합니다.');
  }
  if (projectRole !== environment) {
    throw new Error(
      'Apps Script 프로젝트 역할(' + projectRole + ')과 활성 환경(' + environment + ')이 다릅니다.'
    );
  }

  var testSpreadsheetId = requireRuntimeProperty_(source, 'ASSET_TEST_SPREADSHEET_ID');
  var productionSpreadsheetId = requireRuntimeProperty_(source, 'ASSET_PRODUCTION_SPREADSHEET_ID');
  if (testSpreadsheetId === productionSpreadsheetId) {
    throw new Error('TEST와 PRODUCTION Spreadsheet ID는 서로 달라야 합니다.');
  }

  var isProduction = environment === 'PRODUCTION';
  var propertyPrefix = isProduction ? 'ASSET_PRODUCTION_' : 'ASSET_TEST_';
  return {
    environment: environment,
    displayLabel: isProduction ? '운영' : '테스트',
    isProduction: isProduction,
    spreadsheetId: isProduction ? productionSpreadsheetId : testSpreadsheetId,
    testSpreadsheetId: testSpreadsheetId,
    productionSpreadsheetId: productionSpreadsheetId,
    projectRole: projectRole,
    configVersion: runtimeConfigText_(source.ASSET_RUNTIME_CONFIG_VERSION),
    photoRootIdKey: propertyPrefix + 'PHOTO_ROOT_ID',
    photoSessionIdPrefix: propertyPrefix + 'PHOTO_SESSION_',
    photoRootName: isProduction
      ? '강서청소년회관 비품 전수조사 사진'
      : '강서청소년회관 비품 전수조사 사진 [TEST]'
  };
}

function maskRuntimeIdentifier(value) {
  var text = runtimeConfigText_(value);
  if (!text) return '';
  if (text.length <= 10) return text.slice(0, 2) + '…' + text.slice(-2);
  return text.slice(0, 5) + '…' + text.slice(-5);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ASSET_RUNTIME_ENVIRONMENTS: ASSET_RUNTIME_ENVIRONMENTS,
    resolveRuntimeConfig: resolveRuntimeConfig,
    maskRuntimeIdentifier: maskRuntimeIdentifier
  };
}
