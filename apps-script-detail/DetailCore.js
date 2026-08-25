'use strict';

var DETAIL_RUNTIME_ENVIRONMENTS = ['TEST', 'PRODUCTION'];

function detailText_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function requireDetailRuntimeProperty_(properties, key) {
  var value = detailText_((properties || {})[key]);
  if (!value) throw new Error('Script Property가 필요합니다: ' + key);
  return value;
}

function resolveDetailRuntimeConfig(properties) {
  var source = properties || {};
  var environment = requireDetailRuntimeProperty_(source, 'ASSET_DETAIL_APP_ENV').toUpperCase();
  var projectRole = requireDetailRuntimeProperty_(source, 'ASSET_DETAIL_PROJECT_ROLE').toUpperCase();
  if (DETAIL_RUNTIME_ENVIRONMENTS.indexOf(environment) < 0) {
    throw new Error('ASSET_DETAIL_APP_ENV는 TEST 또는 PRODUCTION이어야 합니다.');
  }
  if (DETAIL_RUNTIME_ENVIRONMENTS.indexOf(projectRole) < 0) {
    throw new Error('ASSET_DETAIL_PROJECT_ROLE은 TEST 또는 PRODUCTION이어야 합니다.');
  }
  if (projectRole !== environment) {
    throw new Error(
      'Apps Script 상세조회 프로젝트 역할(' + projectRole + ')과 활성 환경(' + environment + ')이 다릅니다.'
    );
  }

  var testSpreadsheetId = requireDetailRuntimeProperty_(source, 'ASSET_DETAIL_TEST_SPREADSHEET_ID');
  var productionSpreadsheetId = requireDetailRuntimeProperty_(source, 'ASSET_DETAIL_PRODUCTION_SPREADSHEET_ID');
  if (testSpreadsheetId === productionSpreadsheetId) {
    throw new Error('상세조회 TEST와 PRODUCTION Spreadsheet ID는 서로 달라야 합니다.');
  }

  var isProduction = environment === 'PRODUCTION';
  return {
    environment: environment,
    projectRole: projectRole,
    displayLabel: isProduction ? '운영' : '테스트',
    isProduction: isProduction,
    spreadsheetId: isProduction ? productionSpreadsheetId : testSpreadsheetId,
    testSpreadsheetId: testSpreadsheetId,
    productionSpreadsheetId: productionSpreadsheetId,
    configVersion: detailText_(source.ASSET_DETAIL_CONFIG_VERSION)
  };
}

function validateDetailKey(key) {
  var normalized = detailText_(key);
  if (!normalized) return { ok: false, key: '', code: 'MISSING_KEY' };
  if (!/^[A-Za-z0-9_-]{32}$/.test(normalized)) {
    return { ok: false, key: '', code: 'INVALID_KEY' };
  }
  return { ok: true, key: normalized, code: '' };
}

function normalizeWon(value) {
  if (value === null || value === undefined || detailText_(value) === '') return '정보 없음';
  var number = typeof value === 'number'
    ? value
    : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number)
    ? Math.round(number).toLocaleString('ko-KR') + '원'
    : '정보 없음';
}

function formatLocation(floor, spaceName, detailLocation) {
  var parts = [floor, spaceName, detailLocation]
    .map(detailText_)
    .filter(function (value) { return !!value; });
  return parts.length ? parts.join(' > ') : '정보 없음';
}

function detailDisplay_(value) {
  var text = detailText_(value);
  return text || '정보 없음';
}

function detailYear_(value) {
  if (value === null || value === undefined || detailText_(value) === '') return '정보 없음';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value.getFullYear() + '년';
  }
  var text = detailText_(value).replace(/년$/, '');
  return text ? text + '년' : '정보 없음';
}

function detailQuantity_(quantity, unit) {
  if (quantity === null || quantity === undefined || detailText_(quantity) === '') return '정보 없음';
  return detailText_(quantity) + detailText_(unit);
}

function detailIso_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? detailText_(value) : parsed.toISOString();
}

function buildAssetDetailModel(asset, currentState, history) {
  var master = asset || {};
  var state = currentState || {};
  var registered = formatLocation(master.floor, master.spaceName, master.detailLocation);
  var stateHealthy = !state.syncStatus || state.syncStatus === '정상';
  var hasDerivedLocation = stateHealthy && !!detailText_(state.currentLocationCode);
  var current = hasDerivedLocation
    ? formatLocation(state.currentFloor, state.currentSpaceName, state.currentDetailLocation)
    : registered;
  var registeredCode = detailText_(master.locationCode);
  var currentCode = hasDerivedLocation ? detailText_(state.currentLocationCode) : registeredCode;
  var mismatch = !!registeredCode && !!currentCode
    ? registeredCode !== currentCode
    : registered !== current;
  if (!stateHealthy) mismatch = false;

  return {
    systemId: detailText_(master.systemId),
    basic: {
      newAssetNo: detailDisplay_(master.newAssetNo),
      name: detailDisplay_(master.name),
      spec: detailDisplay_(master.spec),
      quantity: detailQuantity_(master.quantity, master.unit),
      unitPrice: normalizeWon(master.unitPrice),
      acquisitionAmount: normalizeWon(master.acquisitionAmount),
      purchaseYear: detailYear_(master.purchaseYear),
      usefulLife: detailYear_(master.usefulLife)
    },
    location: {
      registered: registered,
      current: current,
      registeredLocationCode: registeredCode,
      currentLocationCode: currentCode,
      mismatch: mismatch,
      source: hasDerivedLocation ? detailDisplay_(state.locationSource || '전수조사') : '비품마스터',
      masterApplied: detailText_(state.masterApplied) || 'N',
      syncStatus: detailText_(state.syncStatus) || '정상',
      syncWarning: stateHealthy ? '' : '현재 위치 동기화 확인이 필요합니다',
      changedAt: detailIso_(state.lastLocationChangedAt),
      changedBy: detailText_(state.lastLocationChangedBy)
    },
    latest: {
      result: detailDisplay_(state.currentResult),
      sessionName: detailDisplay_(state.latestSessionName),
      sessionCategory: detailText_(state.latestSessionCategory),
      sessionRound: state.latestSessionRound === '' || state.latestSessionRound === undefined
        ? ''
        : state.latestSessionRound,
      judgedAt: detailIso_(state.latestJudgedAt),
      judgedBy: detailText_(state.latestJudgedBy),
      physicalConfirmedAt: detailIso_(state.lastPhysicalConfirmedAt),
      physicalConfirmedBy: detailText_(state.lastPhysicalConfirmedBy),
      locationChangedAt: detailIso_(state.lastLocationChangedAt),
      syncError: stateHealthy ? '' : detailText_(state.syncError)
    },
    history: Array.isArray(history) ? history : []
  };
}

function buildDetailError(code) {
  var errors = {
    MISSING_KEY: {
      code: 'MISSING_KEY',
      title: 'QR 정보가 없습니다',
      message: '비품에 부착된 QR을 스캔하여 다시 접속해 주세요.'
    },
    INVALID_KEY: {
      code: 'INVALID_KEY',
      title: '유효하지 않은 QR입니다',
      message: '비품에 부착된 QR을 다시 스캔해 주세요.'
    },
    INACTIVE_KEY: {
      code: 'INACTIVE_KEY',
      title: '사용이 중지된 QR입니다',
      message: '새로 발급된 비품 QR을 이용해 주세요.'
    },
    ASSET_NOT_FOUND: {
      code: 'ASSET_NOT_FOUND',
      title: '비품정보를 찾을 수 없습니다',
      message: '비품관리 담당자에게 QR과 비품번호를 확인해 주세요.'
    },
    STATE_SYNC_ERROR: {
      code: 'STATE_SYNC_ERROR',
      title: '현재 위치 확인이 필요합니다',
      message: '등록대장 위치를 표시하며, 최신 위치는 관리자 확인 후 반영됩니다.'
    },
    DATA_ERROR: {
      code: 'DATA_ERROR',
      title: '비품정보를 불러오지 못했습니다',
      message: '잠시 후 다시 시도하거나 비품관리 담당자에게 문의해 주세요.'
    }
  };
  var selected = errors[code] || errors.DATA_ERROR;
  return {
    code: selected.code,
    title: selected.title,
    message: selected.message
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    resolveDetailRuntimeConfig: resolveDetailRuntimeConfig,
    validateDetailKey: validateDetailKey,
    normalizeWon: normalizeWon,
    formatLocation: formatLocation,
    buildAssetDetailModel: buildAssetDetailModel,
    buildDetailError: buildDetailError
  };
}
