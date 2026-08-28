'use strict';

var INVENTORY_SESSION_CATEGORIES = ['정기', '수시', '특별', '재조사'];

function clonePlainObject_(value) {
  var copy = {};
  Object.keys(value || {}).forEach(function (key) {
    copy[key] = value[key];
  });
  return copy;
}

function asComparableTime_(value) {
  if (!value) return 0;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? 0 : value.getTime();
  }
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function resolveJudgedAt_(record, judgmentAtByRecordId) {
  var map = judgmentAtByRecordId || {};
  if (record && Object.prototype.hasOwnProperty.call(map, record.recordId)) {
    return map[record.recordId] || '';
  }
  return record && (record.lastModifiedAt || record.firstInspectedAt) || '';
}

function resolveSessionStartedAt_(record, sessionsById, judgedAt) {
  var session = (sessionsById || {})[record && record.sessionId] || {};
  var startedAt = asComparableTime_(session.startedAt || '');
  return startedAt || asComparableTime_(judgedAt);
}

function normalizeMasterApplied_(value) {
  var text = String(value || '').trim();
  if (text === 'Y' || text === '반영완료') return '반영완료';
  if (text === '승인') return '승인';
  return 'N';
}

function isUsableInspectionRecord_(record) {
  if (!record) return false;
  if (record.targetType && record.targetType !== '등록비품') return false;
  var result = String(record.result || '').trim();
  return !!result && result !== '미확인' && result !== '미등록발견';
}

function normalizeSessionStartRequest(request, year) {
  var input = typeof request === 'string' ? { inspector: request } : (request || {});
  var normalizedYear = Number(year) || new Date().getFullYear();
  var category = String(input.category || '정기').trim();
  if (INVENTORY_SESSION_CATEGORIES.indexOf(category) < 0) {
    throw new Error('지원하지 않는 조사구분입니다: ' + category);
  }

  var rawRound = Number(input.round);
  var round = isFinite(rawRound) && rawRound >= 1 ? Math.floor(rawRound) : 1;
  var defaultDisplayName = normalizedYear + '년 ' + category + ' 전수조사 ' + round + '차';
  var defaultPurpose = category === '정기' ? '연간 정기 전수조사' : category + ' 조사';

  return {
    inspector: String(input.inspector || '').trim(),
    category: category,
    round: round,
    displayName: String(input.displayName || defaultDisplayName).trim(),
    purpose: String(input.purpose || defaultPurpose).trim()
  };
}

function deriveCurrentState(asset, records, sessionsById, judgmentAtByRecordId, now) {
  var sourceAsset = asset || {};
  if (!String(sourceAsset.systemId || '').trim()) {
    throw new Error('영구 시스템 ID가 필요합니다.');
  }

  var sessions = sessionsById || {};
  var judgmentMap = judgmentAtByRecordId || {};
  var state = {
    systemId: String(sourceAsset.systemId),
    newAssetNo: sourceAsset.newAssetNo || '',
    name: sourceAsset.name || '',
    currentLocationCode: sourceAsset.locationCode || '',
    currentFloor: sourceAsset.floor || '',
    currentSpaceName: sourceAsset.spaceName || '',
    currentDetailLocation: sourceAsset.detailLocation || '',
    locationSource: '비품마스터',
    currentResult: '',
    latestSessionId: '',
    latestSessionName: '',
    latestSessionCategory: '',
    latestSessionRound: '',
    latestJudgedAt: '',
    latestJudgedBy: '',
    lastPhysicalConfirmedAt: '',
    lastPhysicalConfirmedBy: '',
    lastLocationChangedAt: '',
    lastLocationChangedBy: '',
    previousLocationCode: '',
    previousFloor: '',
    previousSpaceName: '',
    evidenceRecordId: '',
    masterApplied: 'N',
    syncStatus: '정상',
    syncError: '',
    version: 1,
    syncedAt: now || new Date()
  };

  var orderedRecords = (records || [])
    .filter(isUsableInspectionRecord_)
    .map(function (record, inputIndex) {
      var judgedAt = resolveJudgedAt_(record, judgmentMap);
      return {
        record: record,
        judgedAt: judgedAt,
        sessionStartedAt: resolveSessionStartedAt_(record, sessions, judgedAt),
        inputIndex: inputIndex
      };
    })
    .sort(function (a, b) {
      var sessionDifference = a.sessionStartedAt - b.sessionStartedAt;
      if (sessionDifference) return sessionDifference;
      var timeDifference = asComparableTime_(a.judgedAt) - asComparableTime_(b.judgedAt);
      if (timeDifference) return timeDifference;
      var idDifference = String(a.record.recordId || '').localeCompare(String(b.record.recordId || ''));
      return idDifference || a.inputIndex - b.inputIndex;
    });

  orderedRecords.forEach(function (entry) {
    var record = entry.record;
    var judgedAt = entry.judgedAt;
    var session = sessions[record.sessionId] || {};

    state.currentResult = String(record.result || '');
    state.latestSessionId = record.sessionId || '';
    state.latestSessionName = session.name || session.displayName || '';
    state.latestSessionCategory = session.category || session.type || '';
    state.latestSessionRound = session.round === undefined || session.round === null
      ? ''
      : session.round;
    state.latestJudgedAt = judgedAt;
    state.latestJudgedBy = record.inspector || '';
    state.evidenceRecordId = record.recordId || '';
    state.masterApplied = normalizeMasterApplied_(record.masterApplied);

    if (String(record.physicalConfirmed || '') !== 'Y' || !record.confirmedLocationCode) {
      return;
    }

    var nextLocationCode = String(record.confirmedLocationCode || '');
    var locationChanged = String(state.currentLocationCode || '') !== nextLocationCode;
    if (locationChanged) {
      state.previousLocationCode = state.currentLocationCode || '';
      state.previousFloor = state.currentFloor || '';
      state.previousSpaceName = state.currentSpaceName || '';
      state.lastLocationChangedAt = judgedAt;
      state.lastLocationChangedBy = record.inspector || '';
    }

    state.currentLocationCode = nextLocationCode;
    state.currentFloor = record.confirmedFloor || '';
    state.currentSpaceName = record.confirmedSpaceName || '';
    if (Object.prototype.hasOwnProperty.call(record, 'confirmedDetailLocation')) {
      state.currentDetailLocation = record.confirmedDetailLocation || '';
    } else if (locationChanged) {
      state.currentDetailLocation = '';
    }
    state.locationSource = state.masterApplied === '반영완료' ? '관리자반영' : '전수조사';
    state.lastPhysicalConfirmedAt = judgedAt;
    state.lastPhysicalConfirmedBy = record.inspector || '';
  });

  return state;
}

function selectInspectionBaseline(asset, currentState) {
  if (!currentState || currentState.syncStatus !== '정상' || !currentState.currentLocationCode) {
    return asset;
  }

  var baseline = clonePlainObject_(asset || {});
  baseline.locationCode = currentState.currentLocationCode;
  baseline.floor = currentState.currentFloor || '';
  baseline.spaceName = currentState.currentSpaceName || '';
  baseline.detailLocation = currentState.currentDetailLocation || '';
  return baseline;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeSessionStartRequest: normalizeSessionStartRequest,
    deriveCurrentState: deriveCurrentState,
    selectInspectionBaseline: selectInspectionBaseline
  };
}
