var INVENTORY_ISSUE_TYPES = [
  '파손', '고장', '수리필요', '사용불가', '불용검토',
  '라벨없음', '라벨훼손', '번호불일치', '정보수정필요', '기타'
];

function getSelectableLocations() {
  var locationMap = buildLocationMap(readLocationRows_());
  var unique = {};

  Object.keys(locationMap).forEach(function (code) {
    var item = locationMap[code];
    var representative = item.representative || item;
    if (!representative.locationCode || representative.displayStatus === '숨김') return;
    if (unique[representative.locationCode]) return;

    unique[representative.locationCode] = {
      locationCode: representative.locationCode,
      floor: representative.floor || '미정',
      spaceName: representative.spaceName || representative.locationCode,
      displayStatus: representative.displayStatus || '표시',
      sortOrder: Number(representative.sortOrder || 9999)
    };
  });

  var floorOrder = ['지하 1층', '1층', '2층', '3층', '옥상', '외부', '미정'];
  return Object.keys(unique).map(function (code) {
    return unique[code];
  }).sort(function (a, b) {
    var af = floorOrder.indexOf(a.floor);
    var bf = floorOrder.indexOf(b.floor);
    af = af < 0 ? 999 : af;
    bf = bf < 0 ? 999 : bf;
    return af - bf || a.sortOrder - b.sortOrder || String(a.spaceName).localeCompare(String(b.spaceName), 'ko');
  });
}

function applyInspectionActionFromMobile(payload) {
  payload = payload || {};
  assertText_(payload.sessionId, '세션ID');
  assertText_(payload.recordId, '기록ID');
  assertText_(payload.type, '작업유형');
  assertText_(payload.actionUuid, '작업UUID');

  var allowed = ['정상확인', '위치변경', '상태이상', '미발견'];
  if (allowed.indexOf(payload.type) < 0) {
    throw new Error('지원하지 않는 현장 작업입니다: ' + payload.type);
  }
  if (payload.type === '상태이상' && INVENTORY_ISSUE_TYPES.indexOf(String(payload.issueType || '')) < 0) {
    throw new Error('허용되지 않은 이상유형입니다.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = getSpreadsheet_();
    var recordSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.RECORD);
    var logSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.CHANGE_LOG);

    var duplicateLog = findChangeLogByActionUuid_(logSheet, payload.actionUuid);
    if (duplicateLog) {
      var duplicateRecord = findRecord_(recordSheet, payload.recordId).record;
      return buildInspectionResponse_(duplicateRecord, payload.sessionId, duplicateLog.changeId, true);
    }

    var found = findRecord_(recordSheet, payload.recordId);
    var record = found.record;
    if (record.sessionId !== payload.sessionId) {
      throw new Error('선택한 기록이 현재 세션에 속하지 않습니다.');
    }

    var beforeSnapshot = createInspectionSnapshot(record);
    var action = {
      type: payload.type,
      issueType: String(payload.issueType || '').trim(),
      memo: String(payload.memo || '').trim(),
      inspector: normalizeInspector_(payload.inspector),
      actionUuid: payload.actionUuid,
      now: new Date()
    };

    if (payload.type === '위치변경' || payload.type === '상태이상') {
      var location = resolveSelectableLocation_(String(payload.locationCode || '').trim());
      action.locationCode = location.locationCode;
      action.floor = location.floor;
      action.spaceName = location.spaceName;

      var originalRepresentative = representativeLocationCode_(record.originalLocationCode);
      var confirmedRepresentative = representativeLocationCode_(location.locationCode);
      var sameRepresentative = originalRepresentative === confirmedRepresentative;

      if (payload.type === '위치변경' && sameRepresentative) {
        throw new Error('선택한 위치는 등록 위치와 같은 대표 공간입니다. 위치가 실제로 다를 때만 위치변경으로 처리하세요.');
      }
      if (payload.type === '상태이상') {
        action.locationMatches = sameRepresentative;
      }
    }

    var previousResult = record.result || '미확인';
    var nextRecord = applyInspectionAction(record, action);
    writeInspectionRecord_(recordSheet, found.rowNumber, nextRecord);

    var changeId = appendChangeLog_(logSheet, {
      sessionId: payload.sessionId,
      recordId: payload.recordId,
      systemId: record.systemId,
      changedAt: action.now,
      changedBy: action.inspector,
      actionType: payload.type,
      targetField: '전수조사기록 상태',
      beforeValue: JSON.stringify(beforeSnapshot),
      afterValue: JSON.stringify(createInspectionSnapshot(nextRecord)),
      reason: inspectionReason_(payload.type, payload.issueType, payload.memo),
      actionUuid: payload.actionUuid
    });

    applySessionMetricDelta_(payload.sessionId, previousResult, nextRecord.result);
    return buildInspectionResponse_(nextRecord, payload.sessionId, changeId, false);
  } finally {
    lock.releaseLock();
  }
}

function reviseInspectionActionFromMobile(payload) {
  payload = payload || {};
  assertText_(payload.sessionId, '세션ID');
  assertText_(payload.recordId, '기록ID');
  assertText_(payload.type, '작업유형');
  assertText_(payload.memo, '판정 수정 사유');
  assertText_(payload.actionUuid, '작업UUID');

  var allowed = ['정상확인', '위치변경', '상태이상', '미발견', '미확인복원'];
  if (allowed.indexOf(payload.type) < 0) {
    throw new Error('지원하지 않는 판정 수정 작업입니다: ' + payload.type);
  }
  if (payload.type === '상태이상' && INVENTORY_ISSUE_TYPES.indexOf(String(payload.issueType || '')) < 0) {
    throw new Error('허용되지 않은 이상유형입니다.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSpreadsheet_();
    var recordSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.RECORD);
    var logSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.CHANGE_LOG);
    var duplicateLog = findChangeLogByActionUuid_(logSheet, payload.actionUuid);
    if (duplicateLog) {
      var duplicateRecord = findRecord_(recordSheet, payload.recordId).record;
      return buildInspectionResponse_(duplicateRecord, payload.sessionId, duplicateLog.changeId, true);
    }

    var found = findRecord_(recordSheet, payload.recordId);
    var record = found.record;
    if (record.sessionId !== payload.sessionId) throw new Error('선택한 기록이 현재 세션에 속하지 않습니다.');
    if (record.targetType !== '등록비품') throw new Error('등록비품만 판정을 수정할 수 있습니다.');
    if (record.result === '미확인') throw new Error('미확인 비품은 최초 판정 기능을 사용하세요.');

    var beforeSnapshot = createInspectionSnapshot(record);
    var action = {
      type: payload.type,
      issueType: String(payload.issueType || '').trim(),
      memo: String(payload.memo || '').trim(),
      inspector: normalizeInspector_(payload.inspector),
      actionUuid: payload.actionUuid,
      now: new Date()
    };

    if (payload.type === '위치변경' || payload.type === '상태이상') {
      var location = resolveSelectableLocation_(String(payload.locationCode || '').trim());
      action.locationCode = location.locationCode;
      action.floor = location.floor;
      action.spaceName = location.spaceName;
      var originalRepresentative = representativeLocationCode_(record.originalLocationCode);
      var confirmedRepresentative = representativeLocationCode_(location.locationCode);
      var sameRepresentative = originalRepresentative === confirmedRepresentative;
      if (payload.type === '위치변경' && sameRepresentative) {
        throw new Error('등록 위치와 같은 공간이면 정상으로 수정하세요.');
      }
      if (payload.type === '상태이상') action.locationMatches = sameRepresentative;
    }

    var previousResult = record.result || '미확인';
    var nextRecord = reviseInspectionAction(record, action);
    var changeEntry = {
      sessionId: payload.sessionId,
      recordId: payload.recordId,
      systemId: record.systemId,
      changedAt: action.now,
      changedBy: action.inspector,
      actionType: '판정수정',
      targetField: '전수조사기록 상태',
      beforeValue: JSON.stringify(beforeSnapshot),
      afterValue: JSON.stringify(createInspectionSnapshot(nextRecord)),
      reason: previousResult + ' → ' + nextRecord.result + ' · ' + action.memo,
      actionUuid: payload.actionUuid
    };
    validateChangeLogPayload(changeEntry);
    writeInspectionRecord_(recordSheet, found.rowNumber, nextRecord);

    var changeId = appendChangeLog_(logSheet, changeEntry);

    applySessionMetricDelta_(payload.sessionId, previousResult, nextRecord.result);
    return buildInspectionResponse_(nextRecord, payload.sessionId, changeId, false);
  } finally {
    lock.releaseLock();
  }
}

function undoInspectionAction(payload) {
  payload = payload || {};
  assertText_(payload.sessionId, '세션ID');
  assertText_(payload.recordId, '기록ID');
  assertText_(payload.changeId, '취소할 변경ID');
  assertText_(payload.actionUuid, '작업UUID');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = getSpreadsheet_();
    var recordSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.RECORD);
    var logSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.CHANGE_LOG);

    var duplicateUndo = findChangeLogByActionUuid_(logSheet, payload.actionUuid);
    if (duplicateUndo) {
      var duplicateRecord = findRecord_(recordSheet, payload.recordId).record;
      return buildInspectionResponse_(duplicateRecord, payload.sessionId, duplicateUndo.changeId, true);
    }

    var targetChange = findChangeLogById_(logSheet, payload.changeId);
    if (!targetChange) throw new Error('취소할 변경이력을 찾을 수 없습니다.');
    if (targetChange.sessionId !== payload.sessionId || targetChange.recordId !== payload.recordId) {
      throw new Error('취소할 변경이력이 현재 비품 기록과 일치하지 않습니다.');
    }
    if (targetChange.cancelled === 'Y') {
      throw new Error('이미 취소된 작업입니다.');
    }
    if (targetChange.actionType === '작업취소') {
      throw new Error('작업취소 이력 자체는 다시 취소할 수 없습니다.');
    }

    var found = findRecord_(recordSheet, payload.recordId);
    var record = found.record;
    if (record.sessionId !== payload.sessionId) {
      throw new Error('선택한 기록이 현재 세션에 속하지 않습니다.');
    }
    if (record.lastActionUuid !== targetChange.actionUuid) {
      throw new Error('이 작업 이후 다른 수정이 있어 즉시 취소할 수 없습니다. 최신 상태를 다시 확인하세요.');
    }

    var beforeSnapshot;
    try {
      beforeSnapshot = JSON.parse(targetChange.beforeValue || '{}');
    } catch (error) {
      throw new Error('이 변경이력에는 Undo용 이전 상태가 없습니다.');
    }

    var previousResult = record.result || '미확인';
    var now = new Date();
    var restored = restoreInspectionSnapshot(record, beforeSnapshot, {
      inspector: normalizeInspector_(payload.inspector),
      actionUuid: payload.actionUuid,
      now: now
    });

    writeInspectionRecord_(recordSheet, found.rowNumber, restored);
    setChangeLogFields_(logSheet, targetChange.rowNumber, { '취소여부': 'Y' });

    var undoChangeId = appendChangeLog_(logSheet, {
      sessionId: payload.sessionId,
      recordId: payload.recordId,
      systemId: record.systemId,
      changedAt: now,
      changedBy: normalizeInspector_(payload.inspector),
      actionType: '작업취소',
      targetField: '전수조사기록 상태',
      beforeValue: JSON.stringify(createInspectionSnapshot(record)),
      afterValue: JSON.stringify(createInspectionSnapshot(restored)),
      reason: targetChange.actionType + ' 작업 취소',
      actionUuid: payload.actionUuid
    });
    var undoRow = findChangeLogById_(logSheet, undoChangeId);
    if (undoRow) setChangeLogFields_(logSheet, undoRow.rowNumber, { '이전변경ID': targetChange.changeId });

    applySessionMetricDelta_(payload.sessionId, previousResult, restored.result);
    return buildInspectionResponse_(restored, payload.sessionId, undoChangeId, false);
  } finally {
    lock.releaseLock();
  }
}

function resolveSelectableLocation_(locationCode) {
  if (!locationCode) throw new Error('발견 위치를 선택하세요.');
  var locations = getSelectableLocations();
  for (var i = 0; i < locations.length; i += 1) {
    if (locations[i].locationCode === locationCode) return locations[i];
  }
  throw new Error('선택할 수 없는 위치입니다: ' + locationCode);
}

function representativeLocationCode_(locationCode) {
  var map = buildLocationMap(readLocationRows_());
  var item = map[locationCode];
  return item && item.representative ? item.representative.locationCode : locationCode;
}

function writeInspectionRecord_(sheet, rowNumber, record) {
  var headers = getHeaders_(sheet);
  var row = buildRecordRow_(headers, record);
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}

function inspectionReason_(type, issueType, memo) {
  var detail = String(memo || '').trim();
  if (type === '정상확인') return '모바일 현장 실물 및 위치 정상 확인';
  if (type === '위치변경') return detail || '모바일 현장 위치 불일치 확인';
  if (type === '상태이상') return (String(issueType || '상태이상') + (detail ? ' · ' + detail : ''));
  if (type === '미발견') return detail || '현재 조사 공간에서 실물 미발견';
  return detail || type;
}

function buildInspectionResponse_(record, sessionId, changeId, duplicate) {
  return {
    duplicate: !!duplicate,
    changeId: changeId || '',
    record: serializeRecord_(record),
    summary: getSessionSummary_(sessionId)
  };
}

function findChangeLogById_(sheet, changeId) {
  return findChangeLog_(sheet, '변경ID', changeId);
}

function findChangeLogByActionUuid_(sheet, actionUuid) {
  return findChangeLog_(sheet, '작업UUID', actionUuid);
}

function findChangeLog_(sheet, header, target) {
  if (!target || sheet.getLastRow() <= 1) return null;
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, [
    '변경ID', '세션ID', '기록ID', '작업유형', '변경전값', '변경후값', '작업UUID', '취소여부'
  ], sheet.getName());
  if (index[header] === undefined) throw new Error('변경이력 헤더 누락: ' + header);

  var range = sheet.getRange(2, index[header] + 1, sheet.getLastRow() - 1, 1);
  var cell = range.createTextFinder(String(target)).matchEntireCell(true).findNext();
  if (!cell) return null;

  var rowNumber = cell.getRow();
  var row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  return {
    rowNumber: rowNumber,
    changeId: String(row[index['변경ID']] || ''),
    sessionId: String(row[index['세션ID']] || ''),
    recordId: String(row[index['기록ID']] || ''),
    actionType: String(row[index['작업유형']] || ''),
    beforeValue: String(row[index['변경전값']] || ''),
    afterValue: String(row[index['변경후값']] || ''),
    actionUuid: String(row[index['작업UUID']] || ''),
    cancelled: String(row[index['취소여부']] || '')
  };
}

function setChangeLogFields_(sheet, rowNumber, fields) {
  var headers = getHeaders_(sheet);
  var index = headerIndex_(headers);
  var row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  Object.keys(fields).forEach(function (header) {
    if (index[header] === undefined) throw new Error('변경이력 헤더 누락: ' + header);
    row[index[header]] = fields[header];
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}
