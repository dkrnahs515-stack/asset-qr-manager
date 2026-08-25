var DETAIL_APPROVED_RUNTIME = {
  TEST_SPREADSHEET_ID: '1jphVHn1W4DpBkeKwi5mZx5rpuMHkQ9oYE4rEI9au3oQ',
  PRODUCTION_SPREADSHEET_ID: '1R5WjwpXtsJwQfIvNnQ_D5PLD6TTLXqTlQ7CSjbUa274',
  CONFIG_VERSION: '2026-08-25-v2'
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

var DETAIL_SHEETS_SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
var DETAIL_KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;

function getDetailRuntimeConfig_() {
  return resolveDetailRuntimeConfig(
    PropertiesService.getScriptProperties().getProperties()
  );
}

function detailSpreadsheetMetadataById_(spreadsheetId) {
  var resource = Sheets.Spreadsheets.get(String(spreadsheetId), {
    includeGridData: false,
    fields: 'spreadsheetId,properties(title,timeZone),sheets(properties(title,gridProperties(rowCount,columnCount)))'
  });
  var sheetMap = {};
  (resource.sheets || []).forEach(function (sheet) {
    var properties = sheet.properties || {};
    if (!properties.title) return;
    sheetMap[properties.title] = {
      title: properties.title,
      rowCount: properties.gridProperties && properties.gridProperties.rowCount || 0,
      columnCount: properties.gridProperties && properties.gridProperties.columnCount || 0
    };
  });
  return {
    id: String(resource.spreadsheetId || spreadsheetId),
    title: String(resource.properties && resource.properties.title || ''),
    timeZone: String(resource.properties && resource.properties.timeZone || 'Asia/Seoul'),
    sheets: sheetMap
  };
}

function getDetailSpreadsheet_() {
  var config = getDetailRuntimeConfig_();
  var spreadsheet = detailSpreadsheetMetadataById_(config.spreadsheetId);
  validateDetailSpreadsheet_(spreadsheet, config);
  return spreadsheet;
}

function validateDetailSpreadsheet_(spreadsheet, config) {
  if (!spreadsheet || String(spreadsheet.id) !== String(config.spreadsheetId)) {
    throw new Error('상세조회 환경에 연결된 스프레드시트가 올바르지 않습니다.');
  }
  var missing = DETAIL_REQUIRED_SHEETS.filter(function (sheetName) {
    return !spreadsheet.sheets || !spreadsheet.sheets[sheetName];
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
  validateDetailSpreadsheet_(detailSpreadsheetMetadataById_(config.spreadsheetId), config);
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
  validateDetailSpreadsheet_(detailSpreadsheetMetadataById_(config.spreadsheetId), config);
  PropertiesService.getScriptProperties().setProperties(candidate, false);
  return getDetailRuntimeStatus_();
}

function detailMask_(value) {
  var text = String(value || '').trim();
  if (text.length <= 10) return text;
  return text.slice(0, 5) + '…' + text.slice(-5);
}

function detailRuntimeStatusFrom_(config, spreadsheet) {
  return {
    environment: config.environment,
    displayLabel: config.displayLabel,
    isProduction: config.isProduction,
    projectRole: config.projectRole,
    spreadsheetTitle: spreadsheet.title,
    spreadsheetIdMasked: detailMask_(config.spreadsheetId),
    configVersion: config.configVersion || ''
  };
}

function getDetailRuntimeStatus_() {
  var config = getDetailRuntimeConfig_();
  var spreadsheet = getDetailSpreadsheet_();
  return detailRuntimeStatusFrom_(config, spreadsheet);
}

function detailRequiredSheet_(spreadsheet, sheetName) {
  if (!spreadsheet || !spreadsheet.sheets || !spreadsheet.sheets[sheetName]) {
    throw new Error('상세조회 필수 시트를 찾을 수 없습니다: ' + sheetName);
  }
  return spreadsheet.sheets[sheetName];
}

function detailQuoteSheetName_(sheetName) {
  return "'" + String(sheetName || '').replace(/'/g, "''") + "'";
}

function detailReadTable_(spreadsheet, sheetName) {
  detailRequiredSheet_(spreadsheet, sheetName);
  var response = Sheets.Spreadsheets.Values.get(
    spreadsheet.id,
    detailQuoteSheetName_(sheetName) + '!A:ZZ',
    {
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
      majorDimension: 'ROWS'
    }
  );
  var values = response.values || [];
  var headers = (values[0] || []).map(function (value) {
    return String(value === undefined || value === null ? '' : value).trim();
  });
  if (!headers.length) throw new Error(sheetName + ' 시트에 헤더가 없습니다.');
  var rows = values.slice(1).map(function (row) {
    var normalized = row ? row.slice() : [];
    while (normalized.length < headers.length) normalized.push('');
    return normalized;
  });
  return {
    name: sheetName,
    headers: headers,
    rows: rows
  };
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

function detailExactRows_(table, header, target) {
  var index = detailRequireHeaders_(table.headers, [header], table.name);
  var expected = String(target === undefined || target === null ? '' : target).trim();
  return table.rows.map(function (row, rowIndex) {
    return { rowNumber: rowIndex + 2, row: row };
  }).filter(function (entry) {
    return String(entry.row[index[header]] === undefined || entry.row[index[header]] === null
      ? ''
      : entry.row[index[header]]).trim() === expected;
  });
}

function detailRowValue_(headers, row, header) {
  var index = detailHeaderIndex_(headers);
  return index[header] === undefined ? '' : row[index[header]];
}

function readActiveQrIssueByKey_(key, spreadsheet) {
  var context = spreadsheet || getDetailSpreadsheet_();
  var table = detailReadTable_(context, DETAIL_CONFIG.SHEETS.QR_ISSUE);
  var matches = detailExactRows_(table, 'QR접근키', key).map(function (entry) {
    return {
      rowNumber: entry.rowNumber,
      systemId: String(detailRowValue_(table.headers, entry.row, '영구 시스템 ID') || '').trim(),
      accessKey: String(detailRowValue_(table.headers, entry.row, 'QR접근키') || '').trim(),
      accessKeyStatus: String(detailRowValue_(table.headers, entry.row, 'QR접근키상태') || '').trim(),
      lookupUrl: String(detailRowValue_(table.headers, entry.row, 'QR조회URL') || '').trim()
    };
  });
  var active = matches.filter(function (issue) { return issue.accessKeyStatus === '사용'; });
  if (active.length > 1) throw new Error('사용 중인 QR 접근키가 중복되었습니다.');
  return active[0] || null;
}

function readDetailMasterAsset_(systemId, spreadsheet) {
  var context = spreadsheet || getDetailSpreadsheet_();
  var table = detailReadTable_(context, DETAIL_CONFIG.SHEETS.ASSET_MASTER);
  var found = detailExactRows_(table, '영구 시스템 ID', systemId);
  if (!found.length) return null;
  if (found.length > 1) throw new Error('비품마스터 영구 시스템 ID가 중복되었습니다: ' + systemId);
  var row = found[0].row;
  return {
    systemId: String(detailRowValue_(table.headers, row, '영구 시스템 ID') || '').trim(),
    newAssetNo: String(detailRowValue_(table.headers, row, 'New 비품번호') || '').trim(),
    name: String(detailRowValue_(table.headers, row, '품명') || '').trim(),
    spec: String(detailRowValue_(table.headers, row, '규격') || '').trim(),
    unit: String(detailRowValue_(table.headers, row, '단위') || '').trim(),
    quantity: detailRowValue_(table.headers, row, '수량'),
    unitPrice: detailRowValue_(table.headers, row, '단가'),
    acquisitionAmount: detailRowValue_(table.headers, row, '취득금액'),
    purchaseYear: detailRowValue_(table.headers, row, '구입연도'),
    usefulLife: detailRowValue_(table.headers, row, '내용연수'),
    locationCode: String(detailRowValue_(table.headers, row, '위치코드') || '').trim(),
    floor: String(detailRowValue_(table.headers, row, '층') || '').trim(),
    spaceName: String(detailRowValue_(table.headers, row, '공간명') || '').trim(),
    detailLocation: String(detailRowValue_(table.headers, row, '세부위치') || '').trim()
  };
}

function readDetailCurrentState_(systemId, spreadsheet) {
  var context = spreadsheet || getDetailSpreadsheet_();
  var table = detailReadTable_(context, DETAIL_CONFIG.SHEETS.CURRENT_STATE);
  var found = detailExactRows_(table, '영구 시스템 ID', systemId);
  if (!found.length) return null;
  if (found.length > 1) throw new Error('비품현재상태 영구 시스템 ID가 중복되었습니다: ' + systemId);
  var row = found[0].row;
  return {
    currentLocationCode: String(detailRowValue_(table.headers, row, '현재위치코드') || '').trim(),
    currentFloor: String(detailRowValue_(table.headers, row, '현재층') || '').trim(),
    currentSpaceName: String(detailRowValue_(table.headers, row, '현재공간명') || '').trim(),
    currentDetailLocation: String(detailRowValue_(table.headers, row, '현재세부위치') || '').trim(),
    locationSource: String(detailRowValue_(table.headers, row, '위치출처') || '').trim(),
    currentResult: String(detailRowValue_(table.headers, row, '현재조사결과') || '').trim(),
    latestSessionId: String(detailRowValue_(table.headers, row, '최근조사세션ID') || '').trim(),
    latestSessionName: String(detailRowValue_(table.headers, row, '최근조사명') || '').trim(),
    latestSessionCategory: String(detailRowValue_(table.headers, row, '최근조사구분') || '').trim(),
    latestSessionRound: detailRowValue_(table.headers, row, '최근조사차수'),
    latestJudgedAt: detailRowValue_(table.headers, row, '최근판정일시'),
    latestJudgedBy: String(detailRowValue_(table.headers, row, '최근판정자') || '').trim(),
    lastPhysicalConfirmedAt: detailRowValue_(table.headers, row, '마지막실물확인일시'),
    lastPhysicalConfirmedBy: String(detailRowValue_(table.headers, row, '마지막실물확인자') || '').trim(),
    lastLocationChangedAt: detailRowValue_(table.headers, row, '마지막위치변경일시'),
    lastLocationChangedBy: String(detailRowValue_(table.headers, row, '마지막위치변경자') || '').trim(),
    masterApplied: String(detailRowValue_(table.headers, row, '마스터반영여부') || '').trim(),
    syncStatus: String(detailRowValue_(table.headers, row, '동기화상태') || '').trim(),
    syncError: String(detailRowValue_(table.headers, row, '동기화오류') || '').trim()
  };
}

function detailDateTimestamp_(value) {
  if (!value) return 0;
  if (typeof value === 'number' && isFinite(value)) {
    if (value > 10000) {
      return Math.round(DETAIL_SHEETS_SERIAL_EPOCH_MS + value * 86400000 - DETAIL_KOREA_OFFSET_MS);
    }
    return 0;
  }
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
  var table = detailReadTable_(spreadsheet, DETAIL_CONFIG.SHEETS.SESSION);
  var index = detailRequireHeaders_(table.headers, ['세션ID'], table.name);
  var map = {};
  table.rows.forEach(function (row) {
    var sessionId = String(row[index['세션ID']] || '').trim();
    if (!sessionId) return;
    map[sessionId] = {
      name: String(detailRowValue_(table.headers, row, '조사표기명') || detailRowValue_(table.headers, row, '조사명') || '').trim(),
      category: String(detailRowValue_(table.headers, row, '조사구분') || detailRowValue_(table.headers, row, '조사유형') || '').trim(),
      round: detailRowValue_(table.headers, row, '조사차수'),
      startedAt: detailRowValue_(table.headers, row, '시작일시') || ''
    };
  });
  return map;
}

function readDetailJudgmentMap_(spreadsheet, recordIds) {
  var requested = {};
  (recordIds || []).forEach(function (recordId) { if (recordId) requested[recordId] = true; });
  var result = {};
  if (!Object.keys(requested).length) return result;

  var table = detailReadTable_(spreadsheet, DETAIL_CONFIG.SHEETS.CHANGE_LOG);
  var index = detailRequireHeaders_(table.headers, ['기록ID', '변경일시', '작업유형', '취소여부'], table.name);
  table.rows.forEach(function (row) {
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

function readDetailHistory_(systemId, offset, limit, spreadsheet) {
  var context = spreadsheet || getDetailSpreadsheet_();
  var table = detailReadTable_(context, DETAIL_CONFIG.SHEETS.RECORD);
  var records = detailExactRows_(table, '영구 시스템 ID', systemId).map(function (entry) {
    var row = entry.row;
    return {
      recordId: String(detailRowValue_(table.headers, row, '기록ID') || '').trim(),
      sessionId: String(detailRowValue_(table.headers, row, '세션ID') || '').trim(),
      targetType: String(detailRowValue_(table.headers, row, '대상구분') || '').trim(),
      result: String(detailRowValue_(table.headers, row, '조사결과') || '').trim(),
      issueType: String(detailRowValue_(table.headers, row, '이상유형') || '').trim(),
      inspector: String(detailRowValue_(table.headers, row, '조사자') || '').trim(),
      confirmedFloor: String(detailRowValue_(table.headers, row, '확인층') || '').trim(),
      confirmedSpaceName: String(detailRowValue_(table.headers, row, '확인공간명') || '').trim(),
      originalFloor: String(detailRowValue_(table.headers, row, '기존층') || '').trim(),
      originalSpaceName: String(detailRowValue_(table.headers, row, '기존공간명') || '').trim(),
      firstInspectedAt: detailRowValue_(table.headers, row, '최초조사일시') || '',
      lastModifiedAt: detailRowValue_(table.headers, row, '최종수정일시') || ''
    };
  }).filter(function (record) {
    return record.targetType === '등록비품' && record.result && record.result !== '미확인';
  });

  var sessions = readDetailSessionMap_(context);
  var judgmentMap = readDetailJudgmentMap_(context, records.map(function (record) { return record.recordId; }));
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
    var config = getDetailRuntimeConfig_();
    var spreadsheet = getDetailSpreadsheet_();
    var issue = readActiveQrIssueByKey_(validated.key, spreadsheet);
    if (!issue) return { ok: false, error: buildDetailError('INACTIVE_KEY') };
    var asset = readDetailMasterAsset_(issue.systemId, spreadsheet);
    if (!asset) return { ok: false, error: buildDetailError('ASSET_NOT_FOUND') };
    var state = readDetailCurrentState_(issue.systemId, spreadsheet);
    var history = readDetailHistory_(issue.systemId, 0, Math.min(20, Math.max(1, Number(historyLimit || 10))), spreadsheet);
    return {
      ok: true,
      detail: buildAssetDetailModel(asset, state, history.items),
      historyTotal: history.total,
      nextOffset: history.nextOffset,
      runtime: detailRuntimeStatusFrom_(config, spreadsheet)
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
    var spreadsheet = getDetailSpreadsheet_();
    var issue = readActiveQrIssueByKey_(validated.key, spreadsheet);
    if (!issue) return { ok: false, error: buildDetailError('INACTIVE_KEY') };
    var history = readDetailHistory_(issue.systemId, offset, limit, spreadsheet);
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
