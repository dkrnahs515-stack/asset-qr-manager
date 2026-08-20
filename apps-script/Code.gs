var INVENTORY_CONFIG = {
  SPREADSHEET_ID: '1R5WjwpXtsJwQfIvNnQ_D5PLD6TTLXqTlQ7CSjbUa274',
  SHEETS: {
    ASSET_MASTER: '비품마스터',
    LOCATION_MASTER: '위치마스터',
    ERROR_REVIEW: '오류검토',
    SESSION: '전수조사세션',
    RECORD: '전수조사기록',
    CHANGE_LOG: '변경이력'
  }
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('강서청소년회관 비품 전수조사')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function getBootstrapData() {
  var active = findActiveSession_();
  if (!active) {
    return {
      activeSession: null,
      summary: null,
      floors: [],
      reviewLocations: 0
    };
  }
  return buildBootstrapForSession_(active.sessionId);
}

function startInventorySession(inspector) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var active = findActiveSession_();
    if (active) {
      if (active.status === '준비') {
        recoverPreparedSession_(active);
      }
      return buildBootstrapForSession_(active.sessionId);
    }

    var ss = getSpreadsheet_();
    var assetSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.ASSET_MASTER);
    var sessionSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.SESSION);
    var recordSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.RECORD);

    var assets = readAssetMaster_(assetSheet);
    if (!assets.length) throw new Error('조사 대상 비품이 없습니다.');

    var existingSessionIds = readColumnValuesByHeader_(sessionSheet, '세션ID');
    var year = new Date().getFullYear();
    var sessionId = makeSessionId(year, existingSessionIds);
    var now = new Date();

    var sessionRow = buildRowForHeaders_(getHeaders_(sessionSheet), {
      '세션ID': sessionId,
      '조사명': year + '년 정기 전수조사',
      '기준연도': year,
      '조사유형': '정기',
      '조사범위': '전체',
      '기준시점': now,
      '기준비품수': assets.length,
      '시작일시': now,
      '종료일시': '',
      '세션상태': '준비',
      '생성자': normalizeInspector_(inspector),
      '완료건수': 0,
      '정상건수': 0,
      '위치변경건수': 0,
      '상태이상건수': 0,
      '미발견건수': 0,
      '미등록발견건수': 0,
      '미확인건수': assets.length,
      '진행률': 0,
      '최종검토자': '',
      '최종마감일시': '',
      '비고': ''
    });
    sessionSheet.getRange(sessionSheet.getLastRow() + 1, 1, 1, sessionRow.length).setValues([sessionRow]);

    var errorMap = readErrorMap_(getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.ERROR_REVIEW));
    var records = buildInventoryRecords(sessionId, assets, errorMap);
    var recordHeaders = getHeaders_(recordSheet);
    var rows = records.map(function (record) {
      return buildRecordRow_(recordHeaders, record);
    });

    if (rows.length) {
      recordSheet.getRange(recordSheet.getLastRow() + 1, 1, rows.length, recordHeaders.length).setValues(rows);
    }

    updateSessionFields_(sessionId, {
      '세션상태': '진행중'
    });

    return buildBootstrapForSession_(sessionId);
  } finally {
    lock.releaseLock();
  }
}

function getLocationsForFloor(sessionId, floorKey) {
  assertText_(sessionId, '세션ID');
  var data = getSessionProgress_(sessionId);
  var list = Object.keys(data.progress.locations).map(function (code) {
    return data.progress.locations[code];
  }).filter(function (location) {
    if (floorKey === '__REVIEW__') return location.reviewRequired;
    return !location.reviewRequired && location.floor === floorKey;
  });

  list.sort(function (a, b) {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return String(a.spaceName).localeCompare(String(b.spaceName), 'ko');
  });
  return list;
}

function getAssetsForLocation(sessionId, representativeLocationCode) {
  assertText_(sessionId, '세션ID');
  assertText_(representativeLocationCode, '대표위치코드');

  var data = getSessionProgress_(sessionId);
  var records = data.records.filter(function (record) {
    if (record.targetType !== '등록비품') return false;
    var location = data.locationMap[record.originalLocationCode];
    var representative = location && location.representative
      ? location.representative.locationCode
      : (record.originalLocationCode || 'UNASSIGNED');
    return representative === representativeLocationCode;
  });

  records.sort(function (a, b) {
    var aPending = a.result === '미확인' ? 0 : 1;
    var bPending = b.result === '미확인' ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return String(a.newAssetNo || a.oldAssetNo || a.systemId).localeCompare(
      String(b.newAssetNo || b.oldAssetNo || b.systemId), 'ko'
    );
  });

  return records.map(serializeRecord_);
}

function markAssetNormal(payload) {
  payload = payload || {};
  assertText_(payload.sessionId, '세션ID');
  assertText_(payload.recordId, '기록ID');
  assertText_(payload.actionUuid, '작업UUID');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = getSpreadsheet_();
    var recordSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.RECORD);
    var logSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.CHANGE_LOG);

    if (hasActionUuid_(logSheet, payload.actionUuid)) {
      var duplicateRecord = findRecord_(recordSheet, payload.recordId);
      return {
        duplicate: true,
        record: serializeRecord_(duplicateRecord.record),
        summary: getSessionSummary_(payload.sessionId)
      };
    }

    var found = findRecord_(recordSheet, payload.recordId);
    var record = found.record;
    if (record.sessionId !== payload.sessionId) {
      throw new Error('선택한 기록이 현재 세션에 속하지 않습니다.');
    }

    if (record.result === '정상') {
      return {
        duplicate: true,
        record: serializeRecord_(record),
        summary: getSessionSummary_(payload.sessionId)
      };
    }

    var previousResult = record.result || '미확인';
    var now = new Date();
    var inspector = normalizeInspector_(payload.inspector);

    record.confirmedLocationCode = record.originalLocationCode;
    record.confirmedFloor = record.originalFloor;
    record.confirmedSpaceName = record.originalSpaceName;
    record.result = '정상';
    record.issueType = '';
    record.physicalConfirmed = 'Y';
    record.locationMatches = 'Y';
    record.labelStatus = '정상';
    record.inspector = inspector;
    record.firstInspectedAt = record.firstInspectedAt || now;
    record.lastModifiedAt = now;
    record.version = Number(record.version || 0) + 1;
    record.lastActionUuid = payload.actionUuid;

    var recordHeaders = getHeaders_(recordSheet);
    var updatedRow = buildRecordRow_(recordHeaders, record);
    recordSheet.getRange(found.rowNumber, 1, 1, recordHeaders.length).setValues([updatedRow]);

    appendChangeLog_(logSheet, {
      sessionId: payload.sessionId,
      recordId: payload.recordId,
      systemId: record.systemId,
      changedAt: now,
      changedBy: inspector,
      actionType: '정상확인',
      targetField: '조사결과',
      beforeValue: previousResult,
      afterValue: '정상',
      reason: '모바일 현장 실물 및 위치 정상 확인',
      actionUuid: payload.actionUuid
    });

    applySessionMetricDelta_(payload.sessionId, previousResult, '정상');

    return {
      duplicate: false,
      record: serializeRecord_(record),
      summary: getSessionSummary_(payload.sessionId)
    };
  } finally {
    lock.releaseLock();
  }
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(INVENTORY_CONFIG.SPREADSHEET_ID);
}

function getRequiredSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('필수 시트를 찾을 수 없습니다: ' + name);
  return sheet;
}

function getHeaders_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error(sheet.getName() + ' 시트에 헤더가 없습니다.');
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (value) {
    return String(value || '').trim();
  });
}

function headerIndex_(headers) {
  var map = {};
  headers.forEach(function (header, index) {
    if (header) map[header] = index;
  });
  return map;
}

function requireHeaders_(headers, required, sheetName) {
  var index = headerIndex_(headers);
  required.forEach(function (header) {
    if (index[header] === undefined) {
      throw new Error(sheetName + ' 시트에 필수 헤더가 없습니다: ' + header);
    }
  });
  return index;
}

function buildRowForHeaders_(headers, valuesByHeader) {
  return headers.map(function (header) {
    return Object.prototype.hasOwnProperty.call(valuesByHeader, header)
      ? valuesByHeader[header]
      : '';
  });
}

function readColumnValuesByHeader_(sheet, header) {
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, [header], sheet.getName());
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, index[header] + 1, sheet.getLastRow() - 1, 1)
    .getValues()
    .map(function (row) { return row[0]; })
    .filter(String);
}

function readAssetMaster_(sheet) {
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, [
    '영구 시스템 ID', 'Old 비품번호', 'New 비품번호', '품명', '규격',
    '위치코드', '층', '공간명'
  ], sheet.getName());
  if (sheet.getLastRow() <= 1) return [];

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.filter(function (row) {
    return String(row[index['영구 시스템 ID']] || '').trim();
  }).map(function (row) {
    return {
      systemId: String(row[index['영구 시스템 ID']] || '').trim(),
      oldAssetNo: String(row[index['Old 비품번호']] || '').trim(),
      newAssetNo: String(row[index['New 비품번호']] || '').trim(),
      name: String(row[index['품명']] || '').trim(),
      spec: String(row[index['규격']] || '').trim(),
      locationCode: String(row[index['위치코드']] || '').trim(),
      floor: String(row[index['층']] || '').trim(),
      spaceName: String(row[index['공간명']] || '').trim()
    };
  });
}

function readErrorMap_(sheet) {
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['검토ID', '영구 시스템 ID', '처리상태'], sheet.getName());
  var map = {};
  if (sheet.getLastRow() <= 1) return map;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().forEach(function (row) {
    var systemId = String(row[index['영구 시스템 ID']] || '').trim();
    var reviewId = String(row[index['검토ID']] || '').trim();
    var status = String(row[index['처리상태']] || '').trim();
    if (!systemId || !reviewId || status === '수정완료' || status === '오류아님') return;
    if (!map[systemId]) map[systemId] = [];
    map[systemId].push(reviewId);
  });

  Object.keys(map).forEach(function (systemId) {
    map[systemId] = map[systemId].join(', ');
  });
  return map;
}

function readLocationRows_() {
  var sheet = getRequiredSheet_(getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.LOCATION_MASTER);
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, [
    '위치코드', '층', '공간명', '조사표시여부', '모바일정렬순서', '대표위치코드'
  ], sheet.getName());
  if (sheet.getLastRow() <= 1) return [];

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .filter(function (row) { return String(row[index['위치코드']] || '').trim(); })
    .map(function (row) {
      return {
        locationCode: String(row[index['위치코드']] || '').trim(),
        floor: String(row[index['층']] || '').trim() || '미정',
        spaceName: String(row[index['공간명']] || '').trim(),
        displayStatus: String(row[index['조사표시여부']] || '').trim() || '표시',
        sortOrder: Number(row[index['모바일정렬순서']] || 9999),
        representativeLocationCode: String(row[index['대표위치코드']] || '').trim()
      };
    });
}

function buildRecordRow_(headers, record) {
  return buildRowForHeaders_(headers, {
    '기록ID': record.recordId,
    '세션ID': record.sessionId,
    '대상구분': record.targetType,
    '영구 시스템 ID': record.systemId,
    '임시비품ID': record.tempAssetId,
    'Old 비품번호': record.oldAssetNo,
    'New 비품번호': record.newAssetNo,
    '품명': record.name,
    '규격': record.spec,
    '기존위치코드': record.originalLocationCode,
    '기존층': record.originalFloor,
    '기존공간명': record.originalSpaceName,
    '확인위치코드': record.confirmedLocationCode,
    '확인층': record.confirmedFloor,
    '확인공간명': record.confirmedSpaceName,
    '조사결과': record.result,
    '이상유형': record.issueType,
    '실물확인여부': record.physicalConfirmed,
    '위치일치여부': record.locationMatches,
    '라벨상태': record.labelStatus,
    '현장메모': record.fieldMemo,
    '조사자': record.inspector,
    '최초조사일시': record.firstInspectedAt,
    '최종수정일시': record.lastModifiedAt,
    '사진건수': record.photoCount,
    '오류검토ID': record.errorReviewId,
    '관리자검토상태': record.adminReviewStatus,
    '마스터반영여부': record.masterApplied,
    '마스터반영일시': record.masterAppliedAt,
    '수정버전': record.version,
    '최근작업UUID': record.lastActionUuid,
    '비고': record.memo
  });
}

function rowToRecord_(headers, row) {
  var index = headerIndex_(headers);
  function value(header) {
    return index[header] === undefined ? '' : row[index[header]];
  }
  return {
    recordId: String(value('기록ID') || ''),
    sessionId: String(value('세션ID') || ''),
    targetType: String(value('대상구분') || ''),
    systemId: String(value('영구 시스템 ID') || ''),
    tempAssetId: String(value('임시비품ID') || ''),
    oldAssetNo: String(value('Old 비품번호') || ''),
    newAssetNo: String(value('New 비품번호') || ''),
    name: String(value('품명') || ''),
    spec: String(value('규격') || ''),
    originalLocationCode: String(value('기존위치코드') || ''),
    originalFloor: String(value('기존층') || ''),
    originalSpaceName: String(value('기존공간명') || ''),
    confirmedLocationCode: String(value('확인위치코드') || ''),
    confirmedFloor: String(value('확인층') || ''),
    confirmedSpaceName: String(value('확인공간명') || ''),
    result: String(value('조사결과') || '미확인'),
    issueType: String(value('이상유형') || ''),
    physicalConfirmed: String(value('실물확인여부') || ''),
    locationMatches: String(value('위치일치여부') || ''),
    labelStatus: String(value('라벨상태') || ''),
    fieldMemo: String(value('현장메모') || ''),
    inspector: String(value('조사자') || ''),
    firstInspectedAt: value('최초조사일시') || '',
    lastModifiedAt: value('최종수정일시') || '',
    photoCount: Number(value('사진건수') || 0),
    errorReviewId: String(value('오류검토ID') || ''),
    adminReviewStatus: String(value('관리자검토상태') || ''),
    masterApplied: String(value('마스터반영여부') || ''),
    masterAppliedAt: value('마스터반영일시') || '',
    version: Number(value('수정버전') || 0),
    lastActionUuid: String(value('최근작업UUID') || ''),
    memo: String(value('비고') || '')
  };
}

function readSessionRecords_(sessionId) {
  var sheet = getRequiredSheet_(getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.RECORD);
  var headers = getHeaders_(sheet);
  requireHeaders_(headers, ['기록ID', '세션ID', '조사결과'], sheet.getName());
  if (sheet.getLastRow() <= 1) return [];

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map(function (row) { return rowToRecord_(headers, row); })
    .filter(function (record) { return record.sessionId === sessionId; });
}

function getSessionProgress_(sessionId) {
  var records = readSessionRecords_(sessionId);
  var locationMap = buildLocationMap(readLocationRows_());
  return {
    records: records,
    locationMap: locationMap,
    progress: aggregateProgress(records, locationMap)
  };
}

function buildBootstrapForSession_(sessionId) {
  var session = findSessionById_(sessionId);
  if (!session) throw new Error('세션을 찾을 수 없습니다: ' + sessionId);
  var data = getSessionProgress_(sessionId);
  var floorOrder = ['지하 1층', '1층', '2층', '3층', '옥상', '외부', '미정'];
  var floors = Object.keys(data.progress.floors).map(function (floor) {
    return data.progress.floors[floor];
  }).sort(function (a, b) {
    var ai = floorOrder.indexOf(a.floor);
    var bi = floorOrder.indexOf(b.floor);
    ai = ai < 0 ? 999 : ai;
    bi = bi < 0 ? 999 : bi;
    return ai - bi || String(a.floor).localeCompare(String(b.floor), 'ko');
  });

  var reviewLocations = Object.keys(data.progress.locations).filter(function (code) {
    return data.progress.locations[code].reviewRequired;
  }).length;

  return {
    activeSession: serializeSession_(session),
    summary: {
      total: data.progress.total,
      completed: data.progress.completed,
      unconfirmed: data.progress.unconfirmed,
      normal: data.progress.normal,
      locationChanged: data.progress.locationChanged,
      issue: data.progress.issue,
      missing: data.progress.missing,
      unregisteredFound: data.progress.unregisteredFound,
      progress: data.progress.progress
    },
    floors: floors,
    reviewLocations: reviewLocations
  };
}

function findActiveSession_() {
  var sheet = getRequiredSheet_(getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.SESSION);
  if (sheet.getLastRow() <= 1) return null;
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['세션ID', '세션상태', '기준비품수'], sheet.getName());
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  for (var i = values.length - 1; i >= 0; i -= 1) {
    var status = String(values[i][index['세션상태']] || '');
    if (status === '준비' || status === '진행중') {
      return {
        rowNumber: i + 2,
        sessionId: String(values[i][index['세션ID']] || ''),
        status: status,
        baselineCount: Number(values[i][index['기준비품수']] || 0)
      };
    }
  }
  return null;
}

function findSessionById_(sessionId) {
  var sheet = getRequiredSheet_(getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.SESSION);
  var headers = getHeaders_(sheet);
  if (sheet.getLastRow() <= 1) return null;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  var index = headerIndex_(headers);

  for (var i = values.length - 1; i >= 0; i -= 1) {
    if (String(values[i][index['세션ID']] || '') !== sessionId) continue;
    function value(header) { return values[i][index[header]]; }
    return {
      rowNumber: i + 2,
      sessionId: String(value('세션ID') || ''),
      name: String(value('조사명') || ''),
      year: Number(value('기준연도') || 0),
      baselineCount: Number(value('기준비품수') || 0),
      startedAt: value('시작일시') || '',
      status: String(value('세션상태') || ''),
      creator: String(value('생성자') || '')
    };
  }
  return null;
}

function recoverPreparedSession_(active) {
  var count = readSessionRecords_(active.sessionId).filter(function (record) {
    return record.targetType === '등록비품';
  }).length;
  if (count !== active.baselineCount) {
    throw new Error('준비 중인 세션의 기록 수가 기준비품수와 다릅니다. 관리자 확인이 필요합니다.');
  }
  updateSessionFields_(active.sessionId, { '세션상태': '진행중' });
  active.status = '진행중';
}

function updateSessionFields_(sessionId, fields) {
  var sheet = getRequiredSheet_(getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.SESSION);
  var headers = getHeaders_(sheet);
  var index = headerIndex_(headers);
  var session = findSessionById_(sessionId);
  if (!session) throw new Error('세션을 찾을 수 없습니다: ' + sessionId);

  var row = sheet.getRange(session.rowNumber, 1, 1, headers.length).getValues()[0];
  Object.keys(fields).forEach(function (header) {
    if (index[header] === undefined) throw new Error('전수조사세션 헤더 누락: ' + header);
    row[index[header]] = fields[header];
  });
  sheet.getRange(session.rowNumber, 1, 1, headers.length).setValues([row]);
}

function findRecord_(sheet, recordId) {
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['기록ID', '세션ID'], sheet.getName());
  if (sheet.getLastRow() <= 1) throw new Error('전수조사기록이 비어 있습니다.');
  var idRange = sheet.getRange(2, index['기록ID'] + 1, sheet.getLastRow() - 1, 1);
  var cell = idRange.createTextFinder(recordId).matchEntireCell(true).findNext();
  if (!cell) throw new Error('기록을 찾을 수 없습니다: ' + recordId);
  var rowNumber = cell.getRow();
  var row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  return { rowNumber: rowNumber, record: rowToRecord_(headers, row) };
}

function hasActionUuid_(logSheet, actionUuid) {
  if (logSheet.getLastRow() <= 1) return false;
  var headers = getHeaders_(logSheet);
  var index = requireHeaders_(headers, ['작업UUID'], logSheet.getName());
  var range = logSheet.getRange(2, index['작업UUID'] + 1, logSheet.getLastRow() - 1, 1);
  return !!range.createTextFinder(actionUuid).matchEntireCell(true).findNext();
}

function appendChangeLog_(sheet, change) {
  var headers = getHeaders_(sheet);
  var year = new Date(change.changedAt).getFullYear();
  var ids = readColumnValuesByHeader_(sheet, '변경ID');
  var max = ids.reduce(function (current, id) {
    var match = String(id || '').match(new RegExp('^CHG-' + year + '-(\\d{6})$'));
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  var changeId = 'CHG-' + year + '-' + String(max + 1).padStart(6, '0');

  var row = buildRowForHeaders_(headers, {
    '변경ID': changeId,
    '세션ID': change.sessionId,
    '기록ID': change.recordId,
    '영구 시스템 ID': change.systemId,
    '변경일시': change.changedAt,
    '변경자': change.changedBy,
    '작업유형': change.actionType,
    '대상필드': change.targetField,
    '변경전값': change.beforeValue,
    '변경후값': change.afterValue,
    '변경사유': change.reason,
    '작업UUID': change.actionUuid,
    '이전변경ID': '',
    '취소여부': 'N',
    '동기화일시': change.changedAt,
    '비고': ''
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
  return changeId;
}

function applySessionMetricDelta_(sessionId, previousResult, nextResult) {
  var delta = computeMetricDelta(previousResult, nextResult);
  var sheet = getRequiredSheet_(getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.SESSION);
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, [
    '세션ID', '기준비품수', '완료건수', '정상건수', '위치변경건수', '상태이상건수',
    '미발견건수', '미등록발견건수', '미확인건수', '진행률'
  ], sheet.getName());
  var session = findSessionById_(sessionId);
  if (!session) throw new Error('세션을 찾을 수 없습니다: ' + sessionId);
  var row = sheet.getRange(session.rowNumber, 1, 1, headers.length).getValues()[0];

  var mappings = [
    ['완료건수', 'completed'],
    ['정상건수', 'normal'],
    ['위치변경건수', 'locationChanged'],
    ['상태이상건수', 'issue'],
    ['미발견건수', 'missing'],
    ['미등록발견건수', 'unregisteredFound'],
    ['미확인건수', 'unconfirmed']
  ];

  mappings.forEach(function (mapping) {
    var header = mapping[0];
    var key = mapping[1];
    row[index[header]] = Math.max(0, Number(row[index[header]] || 0) + Number(delta[key] || 0));
  });

  var baseline = Number(row[index['기준비품수']] || 0);
  var completed = Number(row[index['완료건수']] || 0);
  row[index['진행률']] = baseline ? Math.round((completed / baseline * 100 + Number.EPSILON) * 100) / 100 : 0;
  sheet.getRange(session.rowNumber, 1, 1, headers.length).setValues([row]);
}

function getSessionSummary_(sessionId) {
  var data = getSessionProgress_(sessionId).progress;
  return {
    total: data.total,
    completed: data.completed,
    unconfirmed: data.unconfirmed,
    normal: data.normal,
    locationChanged: data.locationChanged,
    issue: data.issue,
    missing: data.missing,
    unregisteredFound: data.unregisteredFound,
    progress: data.progress
  };
}

function serializeRecord_(record) {
  return {
    recordId: record.recordId,
    sessionId: record.sessionId,
    targetType: record.targetType,
    displayRole: record.displayRole || (record.targetType === '미등록비품' ? 'unregistered' : 'original'),
    systemId: record.systemId,
    oldAssetNo: record.oldAssetNo,
    newAssetNo: record.newAssetNo,
    name: record.name,
    spec: record.spec,
    originalLocationCode: record.originalLocationCode,
    originalFloor: record.originalFloor,
    originalSpaceName: record.originalSpaceName,
    confirmedLocationCode: record.confirmedLocationCode,
    confirmedFloor: record.confirmedFloor,
    confirmedSpaceName: record.confirmedSpaceName,
    result: record.result,
    issueType: record.issueType,
    physicalConfirmed: record.physicalConfirmed,
    locationMatches: record.locationMatches,
    labelStatus: record.labelStatus,
    fieldMemo: record.fieldMemo,
    inspector: record.inspector,
    firstInspectedAt: dateToIso_(record.firstInspectedAt),
    lastModifiedAt: dateToIso_(record.lastModifiedAt),
    photoCount: record.photoCount,
    errorReviewId: record.errorReviewId,
    adminReviewStatus: record.adminReviewStatus,
    masterApplied: record.masterApplied,
    version: record.version,
    lastActionUuid: record.lastActionUuid,
    memo: record.memo
  };
}

function serializeSession_(session) {
  return {
    sessionId: session.sessionId,
    name: session.name,
    year: session.year,
    baselineCount: session.baselineCount,
    startedAt: dateToIso_(session.startedAt),
    status: session.status,
    creator: session.creator
  };
}

function dateToIso_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
  var date = new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function requireInspector_(value) {
  var text = String(value || '').trim();
  if (!text || text === '미지정') {
    throw new Error('조사자 이름을 먼저 입력하세요.');
  }
  return text;
}

function normalizeInspector_(value) {
  return requireInspector_(value);
}

function assertText_(value, label) {
  if (!String(value || '').trim()) throw new Error(label + ' 값이 필요합니다.');
}
