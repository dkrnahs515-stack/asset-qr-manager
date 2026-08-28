var CURRENT_STATE_JUDGMENT_ACTIONS = [
  '정상확인', '위치변경', '상태이상', '미발견', '보류', '판정수정', '작업취소'
];

function findRowByExactValue_(sheet, header, target) {
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, [header], sheet.getName());
  if (sheet.getLastRow() <= 1) return null;
  var range = sheet.getRange(2, index[header] + 1, sheet.getLastRow() - 1, 1);
  var cell = range.createTextFinder(String(target)).matchEntireCell(true).findNext();
  if (!cell) return null;
  return {
    rowNumber: cell.getRow(),
    headers: headers,
    row: sheet.getRange(cell.getRow(), 1, 1, headers.length).getValues()[0]
  };
}

function readMasterAssetBySystemId_(ss, systemId) {
  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.ASSET_MASTER);
  var found = findRowByExactValue_(sheet, '영구 시스템 ID', systemId);
  return found ? masterRowToCurrentStateAsset_(found.headers, found.row) : null;
}

function readAllMasterAssetsForCurrentState_(ss) {
  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.ASSET_MASTER);
  var headers = getHeaders_(sheet);
  requireHeaders_(headers, [
    '영구 시스템 ID', 'New 비품번호', '품명', '위치코드', '층', '공간명'
  ], sheet.getName());
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map(function (row) { return masterRowToCurrentStateAsset_(headers, row); })
    .filter(function (asset) { return !!asset.systemId; });
}

function masterRowToCurrentStateAsset_(headers, row) {
  var index = headerIndex_(headers);
  function value(header) {
    return index[header] === undefined ? '' : row[index[header]];
  }
  return {
    systemId: String(value('영구 시스템 ID') || '').trim(),
    newAssetNo: String(value('New 비품번호') || '').trim(),
    name: String(value('품명') || '').trim(),
    locationCode: String(value('위치코드') || '').trim(),
    floor: String(value('층') || '').trim(),
    spaceName: String(value('공간명') || '').trim(),
    detailLocation: String(value('세부위치') || '').trim()
  };
}

function readSessionMapForCurrentState_(ss) {
  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.SESSION);
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['세션ID'], sheet.getName());
  var map = {};
  if (sheet.getLastRow() <= 1) return map;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().forEach(function (row) {
    var sessionId = String(row[index['세션ID']] || '').trim();
    if (!sessionId) return;
    function optional(header) {
      return index[header] === undefined ? '' : row[index[header]];
    }
    var roundValue = optional('조사차수');
    map[sessionId] = {
      sessionId: sessionId,
      name: String(optional('조사표기명') || optional('조사명') || '').trim(),
      displayName: String(optional('조사표기명') || '').trim(),
      category: String(optional('조사구분') || optional('조사유형') || '').trim(),
      type: String(optional('조사유형') || '').trim(),
      round: roundValue === '' || roundValue === null ? '' : Number(roundValue),
      startedAt: optional('시작일시') || '',
      status: String(optional('세션상태') || '').trim()
    };
  });
  return map;
}

function readRecordsBySystemId_(ss, systemId) {
  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.RECORD);
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['영구 시스템 ID'], sheet.getName());
  if (sheet.getLastRow() <= 1) return [];

  var range = sheet.getRange(2, index['영구 시스템 ID'] + 1, sheet.getLastRow() - 1, 1);
  var cells = range.createTextFinder(String(systemId)).matchEntireCell(true).findAll();
  return cells.map(function (cell) {
    var row = sheet.getRange(cell.getRow(), 1, 1, headers.length).getValues()[0];
    return rowToRecord_(headers, row);
  }).filter(function (record) {
    return record.targetType === '등록비품' && record.systemId === systemId;
  });
}

function readAllRegisteredRecordsForCurrentState_(ss) {
  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.RECORD);
  var headers = getHeaders_(sheet);
  requireHeaders_(headers, ['영구 시스템 ID', '대상구분'], sheet.getName());
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map(function (row) { return rowToRecord_(headers, row); })
    .filter(function (record) {
      return record.targetType === '등록비품' && !!record.systemId;
    });
}

function readJudgmentTimesForRecords_(ss, records) {
  var requestedIds = {};
  (records || []).forEach(function (record) {
    if (record && record.recordId) requestedIds[record.recordId] = true;
  });
  var result = {};
  if (!Object.keys(requestedIds).length) return result;

  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.CHANGE_LOG);
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, [
    '기록ID', '변경일시', '작업유형', '취소여부'
  ], sheet.getName());
  if (sheet.getLastRow() <= 1) return result;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().forEach(function (row) {
    var recordId = String(row[index['기록ID']] || '').trim();
    var actionType = String(row[index['작업유형']] || '').trim();
    if (!recordId || !actionType) return;
    if (!requestedIds[recordId]) return;
    var cancelled = String(row[index['취소여부']] || '').trim();
    if (cancelled === 'Y') return;
    if (CURRENT_STATE_JUDGMENT_ACTIONS.indexOf(actionType) < 0) return;

    var changedAt = row[index['변경일시']] || '';
    if (!changedAt) return;
    if (!result[recordId] || currentStateTimestamp_(changedAt) >= currentStateTimestamp_(result[recordId])) {
      result[recordId] = changedAt;
    }
  });
  return result;
}

function currentStateTimestamp_(value) {
  if (!value) return 0;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? 0 : value.getTime();
  }
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function readCurrentStateBySystemId_(ss, systemId) {
  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.CURRENT_STATE);
  var found = findRowByExactValue_(sheet, '영구 시스템 ID', systemId);
  return found ? rowToCurrentState_(found.headers, found.row) : null;
}

function readAllCurrentStates_(ss) {
  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.CURRENT_STATE);
  var headers = getHeaders_(sheet);
  requireHeaders_(headers, ['영구 시스템 ID'], sheet.getName());
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map(function (row) { return rowToCurrentState_(headers, row); })
    .filter(function (state) { return !!state.systemId; });
}

function readCurrentStateMap_(ss) {
  var map = {};
  readAllCurrentStates_(ss || getSpreadsheet_()).forEach(function (state) {
    if (map[state.systemId]) {
      throw new Error('비품현재상태 영구 시스템 ID 중복: ' + state.systemId);
    }
    map[state.systemId] = state;
  });
  return map;
}

function rowToCurrentState_(headers, row) {
  var index = headerIndex_(headers);
  function value(header) {
    return index[header] === undefined ? '' : row[index[header]];
  }
  return {
    systemId: String(value('영구 시스템 ID') || '').trim(),
    newAssetNo: String(value('New 비품번호') || '').trim(),
    name: String(value('품명') || '').trim(),
    currentLocationCode: String(value('현재위치코드') || '').trim(),
    currentFloor: String(value('현재층') || '').trim(),
    currentSpaceName: String(value('현재공간명') || '').trim(),
    currentDetailLocation: String(value('현재세부위치') || '').trim(),
    locationSource: String(value('위치출처') || '').trim(),
    currentResult: String(value('현재조사결과') || '').trim(),
    latestSessionId: String(value('최근조사세션ID') || '').trim(),
    latestSessionName: String(value('최근조사명') || '').trim(),
    latestSessionCategory: String(value('최근조사구분') || '').trim(),
    latestSessionRound: value('최근조사차수') === '' ? '' : Number(value('최근조사차수')),
    latestJudgedAt: value('최근판정일시') || '',
    latestJudgedBy: String(value('최근판정자') || '').trim(),
    lastPhysicalConfirmedAt: value('마지막실물확인일시') || '',
    lastPhysicalConfirmedBy: String(value('마지막실물확인자') || '').trim(),
    lastLocationChangedAt: value('마지막위치변경일시') || '',
    lastLocationChangedBy: String(value('마지막위치변경자') || '').trim(),
    previousLocationCode: String(value('이전위치코드') || '').trim(),
    previousFloor: String(value('이전층') || '').trim(),
    previousSpaceName: String(value('이전공간명') || '').trim(),
    evidenceRecordId: String(value('근거기록ID') || '').trim(),
    masterApplied: String(value('마스터반영여부') || 'N').trim(),
    syncStatus: String(value('동기화상태') || '').trim(),
    syncError: String(value('동기화오류') || '').trim(),
    version: Number(value('버전') || 0),
    syncedAt: value('최종동기화일시') || ''
  };
}

function buildCurrentStateRow_(headers, state) {
  return buildRowForHeaders_(headers, {
    '영구 시스템 ID': state.systemId,
    'New 비품번호': state.newAssetNo,
    '품명': state.name,
    '현재위치코드': state.currentLocationCode,
    '현재층': state.currentFloor,
    '현재공간명': state.currentSpaceName,
    '현재세부위치': state.currentDetailLocation,
    '위치출처': state.locationSource,
    '현재조사결과': state.currentResult,
    '최근조사세션ID': state.latestSessionId,
    '최근조사명': state.latestSessionName,
    '최근조사구분': state.latestSessionCategory,
    '최근조사차수': state.latestSessionRound,
    '최근판정일시': state.latestJudgedAt,
    '최근판정자': state.latestJudgedBy,
    '마지막실물확인일시': state.lastPhysicalConfirmedAt,
    '마지막실물확인자': state.lastPhysicalConfirmedBy,
    '마지막위치변경일시': state.lastLocationChangedAt,
    '마지막위치변경자': state.lastLocationChangedBy,
    '이전위치코드': state.previousLocationCode,
    '이전층': state.previousFloor,
    '이전공간명': state.previousSpaceName,
    '근거기록ID': state.evidenceRecordId,
    '마스터반영여부': state.masterApplied || 'N',
    '동기화상태': state.syncStatus,
    '동기화오류': state.syncError,
    '버전': Number(state.version || 0),
    '최종동기화일시': state.syncedAt
  });
}

function upsertCurrentState_(ss, state) {
  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.CURRENT_STATE);
  var headers = getHeaders_(sheet);
  requireHeaders_(headers, CURRENT_STATE_HEADERS, sheet.getName());
  var found = findRowByExactValue_(sheet, '영구 시스템 ID', state.systemId);
  var row = buildCurrentStateRow_(headers, state);
  var rowNumber = found ? found.rowNumber : sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
  return rowNumber;
}

function serializeCurrentState_(state) {
  return {
    systemId: state.systemId,
    newAssetNo: state.newAssetNo,
    name: state.name,
    currentLocationCode: state.currentLocationCode,
    currentFloor: state.currentFloor,
    currentSpaceName: state.currentSpaceName,
    currentDetailLocation: state.currentDetailLocation,
    locationSource: state.locationSource,
    currentResult: state.currentResult,
    latestSessionId: state.latestSessionId,
    latestSessionName: state.latestSessionName,
    latestSessionCategory: state.latestSessionCategory,
    latestSessionRound: state.latestSessionRound,
    latestJudgedAt: dateToIso_(state.latestJudgedAt),
    latestJudgedBy: state.latestJudgedBy,
    lastPhysicalConfirmedAt: dateToIso_(state.lastPhysicalConfirmedAt),
    lastPhysicalConfirmedBy: state.lastPhysicalConfirmedBy,
    lastLocationChangedAt: dateToIso_(state.lastLocationChangedAt),
    lastLocationChangedBy: state.lastLocationChangedBy,
    previousLocationCode: state.previousLocationCode,
    previousFloor: state.previousFloor,
    previousSpaceName: state.previousSpaceName,
    evidenceRecordId: state.evidenceRecordId,
    masterApplied: state.masterApplied,
    syncStatus: state.syncStatus,
    syncError: state.syncError,
    version: state.version,
    syncedAt: dateToIso_(state.syncedAt)
  };
}

function rebuildCurrentStateForAsset_(systemId) {
  assertText_(systemId, '영구 시스템 ID');
  var ss = getSpreadsheet_();
  var asset = readMasterAssetBySystemId_(ss, systemId);
  if (!asset) throw new Error('비품마스터에서 비품을 찾을 수 없습니다: ' + systemId);

  var sessionsById = readSessionMapForCurrentState_(ss);
  var records = readRecordsBySystemId_(ss, systemId);
  var judgmentAtByRecordId = readJudgmentTimesForRecords_(ss, records);
  var previous = readCurrentStateBySystemId_(ss, systemId);
  var state = deriveCurrentState(asset, records, sessionsById, judgmentAtByRecordId, new Date());
  state.version = Number(previous && previous.version || 0) + 1;
  upsertCurrentState_(ss, state);
  return serializeCurrentState_(state);
}

function safeRebuildCurrentStateForAsset_(systemId) {
  try {
    return { ok: true, state: rebuildCurrentStateForAsset_(systemId), error: '' };
  } catch (error) {
    var message = String(error && error.message || error);
    try {
      markCurrentStateSyncError_(systemId, message);
    } catch (markError) {
      message += ' / 동기화 오류 기록 실패: ' + String(markError && markError.message || markError);
    }
    return { ok: false, state: null, error: message };
  }
}

function markCurrentStateSyncError_(systemId, errorMessage) {
  var ss = getSpreadsheet_();
  var previous = readCurrentStateBySystemId_(ss, systemId);
  var asset = readMasterAssetBySystemId_(ss, systemId);
  var now = new Date();
  var state = previous || {
    systemId: String(systemId || ''),
    newAssetNo: asset && asset.newAssetNo || '',
    name: asset && asset.name || '',
    currentLocationCode: asset && asset.locationCode || '',
    currentFloor: asset && asset.floor || '',
    currentSpaceName: asset && asset.spaceName || '',
    currentDetailLocation: asset && asset.detailLocation || '',
    locationSource: asset ? '비품마스터' : '',
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
    version: 0
  };
  state.syncStatus = '오류';
  state.syncError = String(errorMessage || '알 수 없는 현재상태 동기화 오류');
  state.syncedAt = now;
  state.version = Number(state.version || 0) + 1;
  upsertCurrentState_(ss, state);
}

function groupRecordsBySystemId_(records) {
  var groups = {};
  (records || []).forEach(function (record) {
    if (!groups[record.systemId]) groups[record.systemId] = [];
    groups[record.systemId].push(record);
  });
  return groups;
}

function makeCurrentStateErrorRow_(asset, previous, error, now) {
  var state = previous || {
    systemId: asset.systemId,
    newAssetNo: asset.newAssetNo,
    name: asset.name,
    currentLocationCode: asset.locationCode,
    currentFloor: asset.floor,
    currentSpaceName: asset.spaceName,
    currentDetailLocation: asset.detailLocation,
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
    version: 0
  };
  state.syncStatus = '오류';
  state.syncError = String(error && error.message || error);
  state.syncedAt = now;
  state.version = Number(state.version || 0) + 1;
  return state;
}

function replaceAllCurrentStateRows_(ss, states) {
  var sheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.CURRENT_STATE);
  var headers = getHeaders_(sheet);
  requireHeaders_(headers, CURRENT_STATE_HEADERS, sheet.getName());
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  }
  if (!states.length) return;
  var rows = states.map(function (state) { return buildCurrentStateRow_(headers, state); });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function rebuildAllCurrentStates() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSpreadsheet_();
    var assets = readAllMasterAssetsForCurrentState_(ss);
    var sessionsById = readSessionMapForCurrentState_(ss);
    var records = readAllRegisteredRecordsForCurrentState_(ss);
    var recordsBySystemId = groupRecordsBySystemId_(records);
    var judgmentAtByRecordId = readJudgmentTimesForRecords_(ss, records);
    var previousMap = readCurrentStateMap_(ss);
    var now = new Date();
    var states = [];
    var failed = [];

    assets.forEach(function (asset) {
      try {
        var state = deriveCurrentState(
          asset,
          recordsBySystemId[asset.systemId] || [],
          sessionsById,
          judgmentAtByRecordId,
          now
        );
        state.version = Number(previousMap[asset.systemId] && previousMap[asset.systemId].version || 0) + 1;
        states.push(state);
      } catch (error) {
        failed.push({ systemId: asset.systemId, error: String(error && error.message || error) });
        states.push(makeCurrentStateErrorRow_(asset, previousMap[asset.systemId], error, now));
      }
    });

    replaceAllCurrentStateRows_(ss, states);
    return {
      expected: assets.length,
      expectedRegisteredCount: ASSET_QR_EXPECTED_ASSET_COUNT,
      expectedCountMatches: assets.length === ASSET_QR_EXPECTED_ASSET_COUNT,
      succeeded: states.length - failed.length,
      failed: failed
    };
  } finally {
    lock.releaseLock();
  }
}

function auditCurrentState() {
  var ss = getSpreadsheet_();
  var assets = readAllMasterAssetsForCurrentState_(ss);
  var states = readAllCurrentStates_(ss);
  var assetIds = assets.map(function (asset) { return asset.systemId; });
  var stateIds = states.map(function (state) { return state.systemId; });
  var assetSet = {};
  var stateCounts = {};
  assetIds.forEach(function (id) { assetSet[id] = true; });
  stateIds.forEach(function (id) { stateCounts[id] = Number(stateCounts[id] || 0) + 1; });

  var duplicateIds = Object.keys(stateCounts).filter(function (id) { return stateCounts[id] > 1; }).sort();
  var missingIds = assetIds.filter(function (id) { return !stateCounts[id]; }).sort();
  var extraIds = Object.keys(stateCounts).filter(function (id) { return !assetSet[id]; }).sort();
  var syncErrorIds = states.filter(function (state) { return state.syncStatus === '오류'; })
    .map(function (state) { return state.systemId; }).sort();
  var registeredCount = assets.length;
  var stateCount = states.length;
  var expectedCountMatches = registeredCount === ASSET_QR_EXPECTED_ASSET_COUNT &&
    stateCount === ASSET_QR_EXPECTED_ASSET_COUNT;

  return {
    expectedRegisteredCount: ASSET_QR_EXPECTED_ASSET_COUNT,
    registeredCount: registeredCount,
    stateCount: stateCount,
    expectedCountMatches: expectedCountMatches,
    duplicateIds: duplicateIds,
    missingIds: missingIds,
    extraIds: extraIds,
    syncErrorIds: syncErrorIds,
    ok: expectedCountMatches && !duplicateIds.length && !missingIds.length &&
      !extraIds.length && !syncErrorIds.length
  };
}

function repairCurrentState(systemId) {
  assertText_(systemId, '영구 시스템 ID');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return rebuildCurrentStateForAsset_(systemId);
  } finally {
    lock.releaseLock();
  }
}
