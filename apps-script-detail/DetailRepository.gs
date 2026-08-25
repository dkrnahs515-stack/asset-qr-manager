var DETAIL_APPROVED_RUNTIME = {
  TEST_SPREADSHEET_ID: '1jphVHn1W4DpBkeKwi5mZx5rpuMHkQ9oYE4rEI9au3oQ',
  PRODUCTION_SPREADSHEET_ID: '1R5WjwpXtsJwQfIvNnQ_D5PLD6TTLXqTlQ7CSjbUa274',
  CONFIG_VERSION: '2026-08-25-v1'
};

var DETAIL_CONFIG = {
  SHEETS: {
    ASSET_MASTER: '비품마스터',
    CURRENT_STATE: '비품현재상태',
    QR_ISSUE: 'QR발급관리',
    SESSION: '전수조사세션',
    RECORD: '전수조사기록',
    CHANGE_LOG: '변경이력'
  }
};

var DETAIL_REQUIRED_SHEETS = [
  '비품마스터', '비품현재상태', 'QR발급관리',
  '전수조사세션', '전수조사기록', '변경이력'
];

var DETAIL_JUDGMENT_ACTIONS = [
  '정상확인', '위치변경', '상태이상', '미발견', '보류', '판정수정', '작업취소'
];

function getDetailRuntimeConfig_() {
  return resolveDetailRuntimeConfig(
    PropertiesService.getScriptProperties().getProperties()
  );
}

function getDetailSpreadsheet_() {
  var config = getDetailRuntimeConfig_();
  var spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  validateDetailSpreadsheet_(spreadsheet, config);
  return spreadsheet;
}

function validateDetailSpreadsheet_(spreadsheet, config) {
  if (!spreadsheet || String(spreadsheet.getId()) !== String(config.spreadsheetId)) {
    throw new Error('상세조회 환경에 연결된 스프레드시트가 올바르지 않습니다.');
  }
  var missing = DETAIL_REQUIRED_SHEETS.filter(function (sheetName) {
    return !spreadsheet.getSheetByName(sheetName);
  });
  if (missing.length) {
    throw new Error('상세조회 필수 시트가 없습니다: ' + missing.join(', '));
  }
  return true;
}

function setupApprovedDetailTestRuntime() {
  var candidate = {
    ASSET_DETAIL_APP_ENV: 'TEST',
    ASSET_DETAIL_PROJECT_ROLE: 'TEST',
    ASSET_DETAIL_TEST_SPREADSHEET_ID: DETAIL_APPROVED_RUNTIME.TEST_SPREADSHEET_ID,
    ASSET_DETAIL_PRODUCTION_SPREADSHEET_ID: DETAIL_APPROVED_RUNTIME.PRODUCTION_SPREADSHEET_ID,
    ASSET_DETAIL_CONFIG_VERSION: DETAIL_APPROVED_RUNTIME.CONFIG_VERSION
  };
  var config = resolveDetailRuntimeConfig(candidate);
  validateDetailSpreadsheet_(SpreadsheetApp.openById(config.spreadsheetId), config);
  PropertiesService.getScriptProperties().setProperties(candidate, false);
  return getDetailRuntimeStatus_();
}

function setupApprovedDetailProductionRuntime(confirmation) {
  if (String(confirmation || '') !== 'INITIALIZE_DETAIL_PRODUCTION_PROJECT') {
    throw new Error('상세조회 운영 프로젝트 초기화 확인문구가 올바르지 않습니다.');
  }
  var candidate = {
    ASSET_DETAIL_APP_ENV: 'PRODUCTION',
    ASSET_DETAIL_PROJECT_ROLE: 'PRODUCTION',
    ASSET_DETAIL_TEST_SPREADSHEET_ID: DETAIL_APPROVED_RUNTIME.TEST_SPREADSHEET_ID,
    ASSET_DETAIL_PRODUCTION_SPREADSHEET_ID: DETAIL_APPROVED_RUNTIME.PRODUCTION_SPREADSHEET_ID,
    ASSET_DETAIL_CONFIG_VERSION: DETAIL_APPROVED_RUNTIME.CONFIG_VERSION
  };
  var config = resolveDetailRuntimeConfig(candidate);
  validateDetailSpreadsheet_(SpreadsheetApp.openById(config.spreadsheetId), config);
  PropertiesService.getScriptProperties().setProperties(candidate, false);
  return getDetailRuntimeStatus_();
}

function detailMask_(value) {
  var text = String(value || '').trim();
  if (text.length <= 10) return text;
  return text.slice(0, 5) + '…' + text.slice(-5);
}

function getDetailRuntimeStatus_() {
  var config = getDetailRuntimeConfig_();
  var spreadsheet = getDetailSpreadsheet_();
  return {
    environment: config.environment,
    displayLabel: config.displayLabel,
    isProduction: config.isProduction,
    projectRole: config.projectRole,
    spreadsheetTitle: spreadsheet.getName(),
    spreadsheetIdMasked: detailMask_(config.spreadsheetId),
    configVersion: config.configVersion || ''
  };
}

function detailRequiredSheet_(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('상세조회 필수 시트를 찾을 수 없습니다: ' + sheetName);
  return sheet;
}

function detailHeaders_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error(sheet.getName() + ' 시트에 헤더가 없습니다.');
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(function (value) { return String(value || '').trim(); });
}

function detailHeaderIndex_(headers) {
  var index = {};
  (headers || []).forEach(function (header, position) {
    if (header) index[header] = position;
  });
  return index;
}

function detailRequireHeaders_(headers, required, sheetName) {
  var index = detailHeaderIndex_(headers);
  (required || []).forEach(function (header) {
    if (index[header] === undefined) {
      throw new Error(sheetName + ' 시트에 필수 헤더가 없습니다: ' + header);
    }
  });
  return index;
}

function detailExactCells_(sheet, header, target) {
  var headers = detailHeaders_(sheet);
  var index = detailRequireHeaders_(headers, [header], sheet.getName());
  if (sheet.getLastRow() <= 1) return { headers: headers, cells: [] };
  var cells = sheet.getRange(2, index[header] + 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(target)).matchEntireCell(true).findAll();
  return { headers: headers, cells: cells };
}

function detailRowValue_(headers, row, header) {
  var index = detailHeaderIndex_(headers);
  return index[header] === undefined ? '' : row[index[header]];
}

function readActiveQrIssueByKey_(key) {
  var spreadsheet = getDetailSpreadsheet_();
  var sheet = detailRequiredSheet_(spreadsheet, DETAIL_CONFIG.SHEETS.QR_ISSUE);
  var found = detailExactCells_(sheet, 'QR접근키', key);
  var matches = found.cells.map(function (cell) {
    var row = sheet.getRange(cell.getRow(), 1, 1, found.headers.length).getValues()[0];
    return {
      rowNumber: cell.getRow(),
      systemId: String(detailRowValue_(found.headers, row, '영구 시스템 ID') || '').trim(),
      accessKey: String(detailRowValue_(found.headers, row, 'QR접근키') || '').trim(),
      accessKeyStatus: String(detailRowValue_(found.headers, row, 'QR접근키상태') || '').trim(),
      lookupUrl: String(detailRowValue_(found.headers, row, 'QR조회URL') || '').trim()
    };
  });
  var active = matches.filter(function (issue) { return issue.accessKeyStatus === '사용'; });
  if (active.length > 1) throw new Error('사용 중인 QR 접근키가 중복되었습니다.');
  return active[0] || null;
}

function readDetailMasterAsset_(systemId) {
  var spreadsheet = getDetailSpreadsheet_();
  var sheet = detailRequiredSheet_(spreadsheet, DETAIL_CONFIG.SHEETS.ASSET_MASTER);
  var found = detailExactCells_(sheet, '영구 시스템 ID', systemId);
  if (!found.cells.length) return null;
  if (found.cells.length > 1) throw new Error('비품마스터 영구 시스템 ID가 중복되었습니다: ' + systemId);
  var row = sheet.getRange(found.cells[0].getRow(), 1, 1, found.headers.length).getValues()[0];
  return {
    systemId: String(detailRowValue_(found.headers, row, '영구 시스템 ID') || '').trim(),
    newAssetNo: String(detailRowValue_(found.headers, row, 'New 비품번호') || '').trim(),
    name: String(detailRowValue_(found.headers, row, '품명') || '').trim(),
    spec: String(detailRowValue_(found.headers, row, '규격') || '').trim(),
    unit: String(detailRowValue_(found.headers, row, '단위') || '').trim(),
    quantity: detailRowValue_(found.headers, row, '수량'),
    unitPrice: detailRowValue_(found.headers, row, '단가'),
    acquisitionAmount: detailRowValue_(found.headers, row, '취득금액'),
    purchaseYear: detailRowValue_(found.headers, row, '구입연도'),
    usefulLife: detailRowValue_(found.headers, row, '내용연수'),
    locationCode: String(detailRowValue_(found.headers, row, '위치코드') || '').trim(),
    floor: String(detailRowValue_(found.headers, row, '층') || '').trim(),
    spaceName: String(detailRowValue_(found.headers, row, '공간명') || '').trim(),
    detailLocation: String(detailRowValue_(found.headers, row, '세부위치') || '').trim()
  };
}

function readDetailCurrentState_(systemId) {
  var spreadsheet = getDetailSpreadsheet_();
  var sheet = detailRequiredSheet_(spreadsheet, DETAIL_CONFIG.SHEETS.CURRENT_STATE);
  var found = detailExactCells_(sheet, '영구 시스템 ID', systemId);
  if (!found.cells.length) return null;
  if (found.cells.length > 1) throw new Error('비품현재상태 영구 시스템 ID가 중복되었습니다: ' + systemId);
  var row = sheet.getRange(found.cells[0].getRow(), 1, 1, found.headers.length).getValues()[0];
  return {
    currentLocationCode: String(detailRowValue_(found.headers, row, '현재위치코드') || '').trim(),
    currentFloor: String(detailRowValue_(found.headers, row, '현재층') || '').trim(),
    currentSpaceName: String(detailRowValue_(found.headers, row, '현재공간명') || '').trim(),
    currentDetailLocation: String(detailRowValue_(found.headers, row, '현재세부위치') || '').trim(),
    locationSource: String(detailRowValue_(found.headers, row, '위치출처') || '').trim(),
    currentResult: String(detailRowValue_(found.headers, row, '현재조사결과') || '').trim(),
    latestSessionId: String(detailRowValue_(found.headers, row, '최근조사세션ID') || '').trim(),
    latestSessionName: String(detailRowValue_(found.headers, row, '최근조사명') || '').trim(),
    latestSessionCategory: String(detailRowValue_(found.headers, row, '최근조사구분') || '').trim(),
    latestSessionRound: detailRowValue_(found.headers, row, '최근조사차수'),
    latestJudgedAt: detailRowValue_(found.headers, row, '최근판정일시'),
    latestJudgedBy: String(detailRowValue_(found.headers, row, '최근판정자') || '').trim(),
    lastPhysicalConfirmedAt: detailRowValue_(found.headers, row, '마지막실물확인일시'),
    lastPhysicalConfirmedBy: String(detailRowValue_(found.headers, row, '마지막실물확인자') || '').trim(),
    lastLocationChangedAt: detailRowValue_(found.headers, row, '마지막위치변경일시'),
    lastLocationChangedBy: String(detailRowValue_(found.headers, row, '마지막위치변경자') || '').trim(),
    masterApplied: String(detailRowValue_(found.headers, row, '마스터반영여부') || '').trim(),
    syncStatus: String(detailRowValue_(found.headers, row, '동기화상태') || '').trim(),
    syncError: String(detailRowValue_(found.headers, row, '동기화오류') || '').trim()
  };
}

function detailDateTimestamp_(value) {
  if (!value) return 0;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? 0 : value.getTime();
  }
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function detailDateIso_(value) {
  var timestamp = detailDateTimestamp_(value);
  return timestamp ? new Date(timestamp).toISOString() : '';
}

function readDetailSessionMap_(spreadsheet) {
  var sheet = detailRequiredSheet_(spreadsheet, DETAIL_CONFIG.SHEETS.SESSION);
  var headers = detailHeaders_(sheet);
  var index = detailRequireHeaders_(headers, ['세션ID'], sheet.getName());
  var map = {};
  if (sheet.getLastRow() <= 1) return map;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().forEach(function (row) {
    var sessionId = String(row[index['세션ID']] || '').trim();
    if (!sessionId) return;
    map[sessionId] = {
      name: String(detailRowValue_(headers, row, '조사표기명') || detailRowValue_(headers, row, '조사명') || '').trim(),
      category: String(detailRowValue_(headers, row, '조사구분') || detailRowValue_(headers, row, '조사유형') || '').trim(),
      round: detailRowValue_(headers, row, '조사차수'),
      startedAt: detailRowValue_(headers, row, '시작일시') || ''
    };
  });
  return map;
}

function readDetailJudgmentMap_(spreadsheet, recordIds) {
  var requested = {};
  (recordIds || []).forEach(function (recordId) { if (recordId) requested[recordId] = true; });
  var result = {};
  if (!Object.keys(requested).length) return result;

  var sheet = detailRequiredSheet_(spreadsheet, DETAIL_CONFIG.SHEETS.CHANGE_LOG);
  var headers = detailHeaders_(sheet);
  var index = detailRequireHeaders_(headers, ['기록ID', '변경일시', '작업유형', '취소여부'], sheet.getName());
  if (sheet.getLastRow() <= 1) return result;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().forEach(function (row) {
    var recordId = String(row[index['기록ID']] || '').trim();
    var actionType = String(row[index['작업유형']] || '').trim();
    var cancelled = String(row[index['취소여부']] || '').trim();
    if (!requested[recordId] || cancelled === 'Y' || DETAIL_JUDGMENT_ACTIONS.indexOf(actionType) < 0) return;
    var changedAt = row[index['변경일시']] || '';
    if (!result[recordId] || detailDateTimestamp_(changedAt) >= detailDateTimestamp_(result[recordId])) {
      result[recordId] = changedAt;
    }
  });
  return result;
}

function readDetailHistory_(systemId, offset, limit) {
  var spreadsheet = getDetailSpreadsheet_();
  var recordSheet = detailRequiredSheet_(spreadsheet, DETAIL_CONFIG.SHEETS.RECORD);
  var found = detailExactCells_(recordSheet, '영구 시스템 ID', systemId);
  var records = found.cells.map(function (cell) {
    var row = recordSheet.getRange(cell.getRow(), 1, 1, found.headers.length).getValues()[0];
    return {
      recordId: String(detailRowValue_(found.headers, row, '기록ID') || '').trim(),
      sessionId: String(detailRowValue_(found.headers, row, '세션ID') || '').trim(),
      targetType: String(detailRowValue_(found.headers, row, '대상구분') || '').trim(),
      result: String(detailRowValue_(found.headers, row, '조사결과') || '').trim(),
      issueType: String(detailRowValue_(found.headers, row, '이상유형') || '').trim(),
      inspector: String(detailRowValue_(found.headers, row, '조사자') || '').trim(),
      confirmedFloor: String(detailRowValue_(found.headers, row, '확인층') || '').trim(),
      confirmedSpaceName: String(detailRowValue_(found.headers, row, '확인공간명') || '').trim(),
      originalFloor: String(detailRowValue_(found.headers, row, '기존층') || '').trim(),
      originalSpaceName: String(detailRowValue_(found.headers, row, '기존공간명') || '').trim(),
      firstInspectedAt: detailRowValue_(found.headers, row, '최초조사일시') || '',
      lastModifiedAt: detailRowValue_(found.headers, row, '최종수정일시') || ''
    };
  }).filter(function (record) {
    return record.targetType === '등록비품' && record.result && record.result !== '미확인';
  });

  var sessions = readDetailSessionMap_(spreadsheet);
  var judgmentMap = readDetailJudgmentMap_(spreadsheet, records.map(function (record) { return record.recordId; }));
  var items = records.map(function (record) {
    var session = sessions[record.sessionId] || {};
    var judgedAt = judgmentMap[record.recordId] || record.lastModifiedAt || record.firstInspectedAt;
    var location = formatLocation(
      record.confirmedFloor || record.originalFloor,
      record.confirmedSpaceName || record.originalSpaceName,
      ''
    );
    return {
      recordId: record.recordId,
      sessionId: record.sessionId,
      sessionName: session.name || record.sessionId || '정보 없음',
      sessionCategory: session.category || '',
      sessionRound: session.round === undefined ? '' : session.round,
      judgedAt: detailDateIso_(judgedAt),
      sessionStartedAt: detailDateIso_(session.startedAt),
      result: record.result,
      issueType: record.issueType,
      location: location,
      inspector: record.inspector || '정보 없음'
    };
  }).sort(function (a, b) {
    var sessionDifference = detailDateTimestamp_(b.sessionStartedAt) - detailDateTimestamp_(a.sessionStartedAt);
    if (sessionDifference) return sessionDifference;
    var judgmentDifference = detailDateTimestamp_(b.judgedAt) - detailDateTimestamp_(a.judgedAt);
    if (judgmentDifference) return judgmentDifference;
    return String(b.recordId).localeCompare(String(a.recordId));
  });

  var normalizedOffset = Math.max(0, Math.floor(Number(offset || 0)));
  var normalizedLimit = Math.min(20, Math.max(1, Math.floor(Number(limit || 10))));
  return {
    items: items.slice(normalizedOffset, normalizedOffset + normalizedLimit),
    total: items.length,
    nextOffset: normalizedOffset + normalizedLimit < items.length
      ? normalizedOffset + normalizedLimit
      : null
  };
}

function getAssetDetailByKey(key, historyLimit) {
  var validated = validateDetailKey(key);
  if (!validated.ok) return { ok: false, error: buildDetailError(validated.code) };
  try {
    var issue = readActiveQrIssueByKey_(validated.key);
    if (!issue) return { ok: false, error: buildDetailError('INACTIVE_KEY') };
    var asset = readDetailMasterAsset_(issue.systemId);
    if (!asset) return { ok: false, error: buildDetailError('ASSET_NOT_FOUND') };
    var state = readDetailCurrentState_(issue.systemId);
    var history = readDetailHistory_(issue.systemId, 0, Math.min(20, Math.max(1, Number(historyLimit || 10))));
    return {
      ok: true,
      detail: buildAssetDetailModel(asset, state, history.items),
      historyTotal: history.total,
      nextOffset: history.nextOffset,
      runtime: getDetailRuntimeStatus_()
    };
  } catch (error) {
    console.error(error);
    return { ok: false, error: buildDetailError('DATA_ERROR') };
  }
}

function getAssetHistoryByKey(key, offset, limit) {
  var validated = validateDetailKey(key);
  if (!validated.ok) return { ok: false, error: buildDetailError(validated.code) };
  try {
    var issue = readActiveQrIssueByKey_(validated.key);
    if (!issue) return { ok: false, error: buildDetailError('INACTIVE_KEY') };
    var history = readDetailHistory_(issue.systemId, offset, limit);
    return {
      ok: true,
      items: history.items,
      total: history.total,
      nextOffset: history.nextOffset
    };
  } catch (error) {
    console.error(error);
    return { ok: false, error: buildDetailError('DATA_ERROR') };
  }
}
