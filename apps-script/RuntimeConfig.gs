var ASSET_APPROVED_RUNTIME = {
  TEST_SPREADSHEET_ID: '1jphVHn1W4DpBkeKwi5mZx5rpuMHkQ9oYE4rEI9au3oQ',
  PRODUCTION_SPREADSHEET_ID: '1R5WjwpXtsJwQfIvNnQ_D5PLD6TTLXqTlQ7CSjbUa274',
  CONFIG_VERSION: '2026-08-21-v1'
};

var ASSET_RUNTIME_REQUIRED_SHEETS = [
  '비품마스터',
  '위치마스터',
  '오류검토',
  '전수조사세션',
  '전수조사기록',
  '변경이력',
  '사진',
  '비품현재상태',
  'QR발급관리',
  '라벨설정'
];

function getRuntimeConfig_() {
  var properties = PropertiesService.getScriptProperties().getProperties();
  var config = resolveRuntimeConfig(properties);
  if (config.projectRole && config.projectRole !== config.environment) {
    throw new Error(
      'Apps Script 프로젝트 역할(' + config.projectRole + ')과 활성 환경(' +
      config.environment + ')이 다릅니다.'
    );
  }
  return config;
}

function getSpreadsheet_() {
  var config = getRuntimeConfig_();
  var spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  validateRuntimeSpreadsheet_(spreadsheet, config);
  return spreadsheet;
}

function validateRuntimeSpreadsheet_(spreadsheet, config) {
  if (!spreadsheet) throw new Error('환경에 연결된 스프레드시트를 열 수 없습니다.');
  if (String(spreadsheet.getId()) !== String(config.spreadsheetId)) {
    throw new Error('열린 스프레드시트가 Script Property의 환경 설정과 다릅니다.');
  }

  var missing = ASSET_RUNTIME_REQUIRED_SHEETS.filter(function (sheetName) {
    return !spreadsheet.getSheetByName(sheetName);
  });
  if (missing.length) {
    throw new Error(
      config.displayLabel + ' 스프레드시트에 필수 시트가 없습니다: ' + missing.join(', ')
    );
  }
  return true;
}

function validateRuntimeSpreadsheetById_(config) {
  var spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  validateRuntimeSpreadsheet_(spreadsheet, config);
  return spreadsheet;
}

function getRuntimeEnvironmentStatus() {
  var config = getRuntimeConfig_();
  var spreadsheet = validateRuntimeSpreadsheetById_(config);
  return {
    environment: config.environment,
    displayLabel: config.displayLabel,
    isProduction: config.isProduction,
    projectRole: config.projectRole || '',
    spreadsheetIdMasked: maskRuntimeIdentifier(config.spreadsheetId),
    spreadsheetTitle: spreadsheet.getName(),
    spreadsheetUrl: spreadsheet.getUrl(),
    configVersion: config.configVersion || '',
    scriptIdMasked: maskRuntimeIdentifier(ScriptApp.getScriptId())
  };
}

function setupApprovedTestRuntime() {
  var properties = PropertiesService.getScriptProperties();
  var candidate = {
    ASSET_APP_ENV: 'TEST',
    ASSET_PROJECT_ROLE: 'TEST',
    ASSET_TEST_SPREADSHEET_ID: ASSET_APPROVED_RUNTIME.TEST_SPREADSHEET_ID,
    ASSET_PRODUCTION_SPREADSHEET_ID: ASSET_APPROVED_RUNTIME.PRODUCTION_SPREADSHEET_ID,
    ASSET_RUNTIME_CONFIG_VERSION: ASSET_APPROVED_RUNTIME.CONFIG_VERSION
  };
  validateRuntimeSpreadsheetById_(resolveRuntimeConfig(candidate));
  properties.setProperties(candidate, false);
  return getRuntimeEnvironmentStatus();
}

function setupApprovedProductionRuntime(confirmation) {
  if (String(confirmation || '') !== 'INITIALIZE_PRODUCTION_PROJECT') {
    throw new Error('운영 프로젝트 초기화 확인문구가 올바르지 않습니다.');
  }
  var properties = PropertiesService.getScriptProperties();
  var candidate = {
    ASSET_APP_ENV: 'PRODUCTION',
    ASSET_PROJECT_ROLE: 'PRODUCTION',
    ASSET_TEST_SPREADSHEET_ID: ASSET_APPROVED_RUNTIME.TEST_SPREADSHEET_ID,
    ASSET_PRODUCTION_SPREADSHEET_ID: ASSET_APPROVED_RUNTIME.PRODUCTION_SPREADSHEET_ID,
    ASSET_RUNTIME_CONFIG_VERSION: ASSET_APPROVED_RUNTIME.CONFIG_VERSION
  };
  validateRuntimeSpreadsheetById_(resolveRuntimeConfig(candidate));
  properties.setProperties(candidate, false);
  return getRuntimeEnvironmentStatus();
}

function switchRuntimeEnvironment(environment, confirmation) {
  var target = String(environment || '').trim().toUpperCase();
  if (target !== 'TEST' && target !== 'PRODUCTION') {
    throw new Error('전환 환경은 TEST 또는 PRODUCTION이어야 합니다.');
  }

  var requiredConfirmation = target === 'PRODUCTION'
    ? 'SWITCH_TO_PRODUCTION'
    : 'SWITCH_TO_TEST';
  if (String(confirmation || '') !== requiredConfirmation) {
    throw new Error('환경 전환 확인문구가 올바르지 않습니다: ' + requiredConfirmation);
  }

  var properties = PropertiesService.getScriptProperties();
  var current = properties.getProperties();
  var role = String(current.ASSET_PROJECT_ROLE || '').trim().toUpperCase();
  if (!role) {
    throw new Error('먼저 이 Apps Script 프로젝트의 TEST 또는 PRODUCTION 역할을 초기화하세요.');
  }
  if (role !== target) {
    throw new Error(
      '이 Apps Script 프로젝트는 ' + role + ' 역할로 잠겨 있어 ' + target +
      ' 환경으로 전환할 수 없습니다. 환경별 별도 Apps Script 프로젝트를 사용하세요.'
    );
  }

  var candidate = {};
  Object.keys(current).forEach(function (key) { candidate[key] = current[key]; });
  candidate.ASSET_APP_ENV = target;
  validateRuntimeSpreadsheetById_(resolveRuntimeConfig(candidate));
  properties.setProperty('ASSET_APP_ENV', target);
  return getRuntimeEnvironmentStatus();
}
