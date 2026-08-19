var INVENTORY_PHOTO_TYPES = ['파손', '고장', '라벨', '위치', '미등록', '규격', '기타'];
var INVENTORY_PHOTO_ROOT_NAME = '강서청소년회관 비품 전수조사 사진';

function getRoomInventoryData(sessionId, representativeLocationCode) {
  assertText_(sessionId, '세션ID');
  assertText_(representativeLocationCode, '대표위치코드');

  var records = readSessionRecords_(sessionId);
  var locationMap = buildLocationMap(readLocationRows_());
  var registered = getAssetsForLocation(sessionId, representativeLocationCode);
  var unregistered = records.filter(function (record) {
    return record.targetType === '미등록비품' &&
      fieldRepresentativeCode_(record.confirmedLocationCode, locationMap) === representativeLocationCode;
  }).map(serializeRecord_);

  return {
    assets: registered.concat(unregistered),
    summary: summarizeLocationCloseout(records, representativeLocationCode, locationMap),
    closeout: findLatestRoomCloseout_(sessionId, representativeLocationCode)
  };
}

function registerUnregisteredAsset(payload) {
  payload = payload || {};
  assertText_(payload.sessionId, '세션ID');
  assertText_(payload.locationCode, '발견위치');
  assertText_(payload.name, '품명');
  assertText_(payload.actionUuid, '작업UUID');
  requirePhotoPayload_(payload.photo);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = getSpreadsheet_();
    var recordSheet = getRequiredSheet_(ss, '전수조사기록');
    var logSheet = getRequiredSheet_(ss, '변경이력');
    var photoSheet = getRequiredSheet_(ss, '사진');

    var duplicateLog = findChangeLogByActionUuid_(logSheet, payload.actionUuid);
    if (duplicateLog && duplicateLog.recordId) {
      var duplicateRecord = findRecord_(recordSheet, duplicateLog.recordId).record;
      return {
        duplicate: true,
        record: serializeRecord_(duplicateRecord),
        summary: getSessionSummary_(payload.sessionId)
      };
    }

    var session = findSessionById_(payload.sessionId);
    if (!session || session.status !== '진행중') {
      throw new Error('진행 중인 전수조사 세션에서만 미등록 비품을 추가할 수 있습니다.');
    }

    var location = resolveSelectableLocation_(String(payload.locationCode));
    var existingTempIds = readColumnValuesByHeader_(recordSheet, '임시비품ID');
    var tempAssetId = makeTempAssetId(session.year || new Date().getFullYear(), existingTempIds);
    var sessionRecords = readSessionRecords_(payload.sessionId);
    var unregisteredIndex = sessionRecords.filter(function (record) {
      return record.targetType === '미등록비품';
    }).length + 1;
    var recordId = makeUnregisteredRecordId(payload.sessionId, unregisteredIndex);
    var now = new Date();

    var record = buildUnregisteredRecord({
      sessionId: payload.sessionId,
      recordId: recordId,
      tempAssetId: tempAssetId,
      name: payload.name,
      spec: payload.spec,
      locationCode: location.locationCode,
      floor: location.floor,
      spaceName: location.spaceName,
      inspector: normalizeInspector_(payload.inspector),
      memo: payload.memo,
      actionUuid: payload.actionUuid,
      now: now,
      photoCount: 1
    });

    var savedPhoto = null;
    var appendedRow = null;
    try {
      savedPhoto = saveInventoryPhoto_(payload.photo, {
        sessionId: payload.sessionId,
        recordId: recordId,
        systemId: '',
        tempAssetId: tempAssetId,
        photoType: '미등록',
        locationCode: location.locationCode,
        inspector: normalizeInspector_(payload.inspector),
        memo: payload.memo,
        takenAt: now
      });

      var headers = getHeaders_(recordSheet);
      appendedRow = recordSheet.getLastRow() + 1;
      recordSheet.getRange(appendedRow, 1, 1, headers.length)
        .setValues([buildRecordRow_(headers, record)]);
      appendPhotoRow_(photoSheet, savedPhoto);

      appendChangeLog_(logSheet, {
        sessionId: payload.sessionId,
        recordId: recordId,
        systemId: '',
        changedAt: now,
        changedBy: normalizeInspector_(payload.inspector),
        actionType: '미등록발견',
        targetField: '전수조사기록 신규',
        beforeValue: '',
        afterValue: JSON.stringify({ tempAssetId: tempAssetId, name: record.name, locationCode: location.locationCode }),
        reason: String(payload.memo || '').trim() || '현장 미등록 비품 발견',
        actionUuid: payload.actionUuid
      });
      incrementSessionUnregistered_(payload.sessionId, 1);
    } catch (error) {
      if (appendedRow && recordSheet.getLastRow() >= appendedRow) {
        try { recordSheet.deleteRow(appendedRow); } catch (ignoreDeleteRow) {}
      }
      if (savedPhoto && savedPhoto.fileId) {
        try { DriveApp.getFileById(savedPhoto.fileId).setTrashed(true); } catch (ignoreTrash) {}
      }
      throw error;
    }

    return {
      duplicate: false,
      record: serializeRecord_(record),
      photo: serializePhoto_(savedPhoto),
      summary: getSessionSummary_(payload.sessionId)
    };
  } finally {
    lock.releaseLock();
  }
}

function uploadInventoryPhoto(payload) {
  payload = payload || {};
  assertText_(payload.sessionId, '세션ID');
  assertText_(payload.recordId, '기록ID');
  assertText_(payload.photoType, '사진유형');
  assertText_(payload.actionUuid, '작업UUID');
  if (INVENTORY_PHOTO_TYPES.indexOf(String(payload.photoType)) < 0) {
    throw new Error('지원하지 않는 사진유형입니다.');
  }
  requirePhotoPayload_(payload.photo);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = getSpreadsheet_();
    var recordSheet = getRequiredSheet_(ss, '전수조사기록');
    var logSheet = getRequiredSheet_(ss, '변경이력');
    var photoSheet = getRequiredSheet_(ss, '사진');

    var duplicateLog = findChangeLogByActionUuid_(logSheet, payload.actionUuid);
    if (duplicateLog) {
      var duplicate = findRecord_(recordSheet, payload.recordId).record;
      return { duplicate: true, record: serializeRecord_(duplicate), summary: getSessionSummary_(payload.sessionId) };
    }

    var found = findRecord_(recordSheet, payload.recordId);
    var record = found.record;
    if (record.sessionId !== payload.sessionId) throw new Error('사진을 추가할 기록이 현재 세션과 일치하지 않습니다.');

    var locationCode = record.confirmedLocationCode || record.originalLocationCode || '';
    var now = new Date();
    var savedPhoto = saveInventoryPhoto_(payload.photo, {
      sessionId: payload.sessionId,
      recordId: record.recordId,
      systemId: record.systemId,
      tempAssetId: record.tempAssetId,
      photoType: String(payload.photoType),
      locationCode: locationCode,
      inspector: normalizeInspector_(payload.inspector),
      memo: payload.memo,
      takenAt: now
    });

    try {
      appendPhotoRow_(photoSheet, savedPhoto);
      var beforeCount = Number(record.photoCount || 0);
      record.photoCount = beforeCount + 1;
      record.lastModifiedAt = now;
      record.version = Number(record.version || 0) + 1;
      record.lastActionUuid = payload.actionUuid;
      writeInspectionRecord_(recordSheet, found.rowNumber, record);

      appendChangeLog_(logSheet, {
        sessionId: payload.sessionId,
        recordId: record.recordId,
        systemId: record.systemId,
        changedAt: now,
        changedBy: normalizeInspector_(payload.inspector),
        actionType: '사진추가',
        targetField: '사진건수',
        beforeValue: String(beforeCount),
        afterValue: String(record.photoCount),
        reason: String(payload.photoType) + (payload.memo ? ' · ' + String(payload.memo) : ''),
        actionUuid: payload.actionUuid
      });
    } catch (error) {
      try { DriveApp.getFileById(savedPhoto.fileId).setTrashed(true); } catch (ignoreTrash) {}
      throw error;
    }

    return {
      duplicate: false,
      record: serializeRecord_(record),
      photo: serializePhoto_(savedPhoto),
      summary: getSessionSummary_(payload.sessionId)
    };
  } finally {
    lock.releaseLock();
  }
}

function closeLocationInspection(payload) {
  payload = payload || {};
  assertText_(payload.sessionId, '세션ID');
  assertText_(payload.locationCode, '대표위치코드');
  assertText_(payload.actionUuid, '작업UUID');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = getSpreadsheet_();
    var logSheet = getRequiredSheet_(ss, '변경이력');
    var duplicateLog = findChangeLogByActionUuid_(logSheet, payload.actionUuid);
    if (duplicateLog) {
      return {
        duplicate: true,
        summary: getRoomCloseoutSummary_(payload.sessionId, payload.locationCode),
        closeout: findLatestRoomCloseout_(payload.sessionId, payload.locationCode)
      };
    }

    var summary = getRoomCloseoutSummary_(payload.sessionId, payload.locationCode);
    if (summary.unconfirmed > 0 && payload.allowIncomplete !== true) {
      throw new Error('미확인 비품 ' + summary.unconfirmed + '개가 남아 있습니다. 다시 확인하거나 현재 상태로 마감을 선택하세요.');
    }

    var now = new Date();
    var reason = summary.unconfirmed > 0
      ? '미확인 ' + summary.unconfirmed + '개를 남기고 공간 마감'
      : '공간 전수조사 마감';
    var changeId = appendChangeLog_(logSheet, {
      sessionId: payload.sessionId,
      recordId: '',
      systemId: '',
      changedAt: now,
      changedBy: normalizeInspector_(payload.inspector),
      actionType: '공간마감',
      targetField: '대표위치코드',
      beforeValue: JSON.stringify(summary),
      afterValue: JSON.stringify({ locationCode: payload.locationCode, closedAt: now.toISOString(), allowIncomplete: payload.allowIncomplete === true }),
      reason: reason,
      actionUuid: payload.actionUuid
    });

    return {
      duplicate: false,
      summary: summary,
      closeout: {
        changeId: changeId,
        locationCode: payload.locationCode,
        closedAt: now.toISOString(),
        inspector: normalizeInspector_(payload.inspector),
        incompleteAccepted: summary.unconfirmed > 0
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function getRoomCloseoutSummary_(sessionId, locationCode) {
  var records = readSessionRecords_(sessionId);
  var map = buildLocationMap(readLocationRows_());
  return summarizeLocationCloseout(records, locationCode, map);
}

function findLatestRoomCloseout_(sessionId, locationCode) {
  var sheet = getRequiredSheet_(getSpreadsheet_(), '변경이력');
  if (sheet.getLastRow() <= 1) return null;
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['변경ID', '세션ID', '변경일시', '변경자', '작업유형', '대상필드', '변경후값', '취소여부'], sheet.getName());
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  for (var i = rows.length - 1; i >= 0; i -= 1) {
    if (String(rows[i][index['세션ID']] || '') !== sessionId) continue;
    if (String(rows[i][index['작업유형']] || '') !== '공간마감') continue;
    if (String(rows[i][index['취소여부']] || '') === 'Y') continue;
    var data;
    try { data = JSON.parse(String(rows[i][index['변경후값']] || '{}')); } catch (error) { data = {}; }
    if (String(data.locationCode || '') !== locationCode) continue;
    return {
      changeId: String(rows[i][index['변경ID']] || ''),
      locationCode: locationCode,
      closedAt: dateToIso_(rows[i][index['변경일시']]),
      inspector: String(rows[i][index['변경자']] || ''),
      incompleteAccepted: data.allowIncomplete === true
    };
  }
  return null;
}

function fieldRepresentativeCode_(locationCode, locationMap) {
  var item = (locationMap || {})[locationCode];
  return item && item.representative ? item.representative.locationCode : locationCode;
}

function incrementSessionUnregistered_(sessionId, delta) {
  var sheet = getRequiredSheet_(getSpreadsheet_(), '전수조사세션');
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['미등록발견건수'], sheet.getName());
  var session = findSessionById_(sessionId);
  if (!session) throw new Error('세션을 찾을 수 없습니다: ' + sessionId);
  var row = sheet.getRange(session.rowNumber, 1, 1, headers.length).getValues()[0];
  row[index['미등록발견건수']] = Math.max(0, Number(row[index['미등록발견건수']] || 0) + Number(delta || 0));
  sheet.getRange(session.rowNumber, 1, 1, headers.length).setValues([row]);
}

function requirePhotoPayload_(photo) {
  if (!photo || !String(photo.base64 || '').trim()) throw new Error('현장 사진을 첨부하세요.');
  if (!String(photo.clientPhotoUuid || '').trim()) throw new Error('사진 UUID가 없습니다.');
  var mime = String(photo.mimeType || '').toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) < 0) throw new Error('JPEG, PNG, WebP 사진만 업로드할 수 있습니다.');
  if (String(photo.base64).length > 7000000) throw new Error('사진 용량이 너무 큽니다. 다시 촬영하거나 더 작은 사진을 선택하세요.');
}

function saveInventoryPhoto_(photo, context) {
  requirePhotoPayload_(photo);
  var bytes = Utilities.base64Decode(String(photo.base64));
  var mime = String(photo.mimeType || 'image/jpeg');
  var key = context.systemId || context.tempAssetId || context.recordId;
  var extension = mime === 'image/png' ? '.png' : (mime === 'image/webp' ? '.webp' : '.jpg');
  var fileName = sanitizeFileName_(key + '_' + Utilities.formatDate(context.takenAt || new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss') + extension);
  var blob = Utilities.newBlob(bytes, mime, fileName);
  var folder = getInventoryPhotoFolder_(context.sessionId);
  var file = folder.createFile(blob);
  var photoSheet = getRequiredSheet_(getSpreadsheet_(), '사진');
  var photoId = nextPhotoId_(photoSheet, context.takenAt || new Date());

  return {
    photoId: photoId,
    sessionId: context.sessionId,
    recordId: context.recordId,
    systemId: context.systemId || '',
    tempAssetId: context.tempAssetId || '',
    photoType: context.photoType,
    fileId: file.getId(),
    url: file.getUrl(),
    fileName: fileName,
    locationCode: context.locationCode || '',
    inspector: context.inspector || '미지정',
    takenAt: context.takenAt || new Date(),
    memo: String(context.memo || '').trim(),
    clientPhotoUuid: String(photo.clientPhotoUuid),
    active: '사용'
  };
}

function appendPhotoRow_(sheet, photo) {
  var headers = getHeaders_(sheet);
  var row = buildRowForHeaders_(headers, {
    '사진ID': photo.photoId,
    '세션ID': photo.sessionId,
    '기록ID': photo.recordId,
    '영구 시스템 ID': photo.systemId,
    '임시비품ID': photo.tempAssetId,
    '사진유형': photo.photoType,
    'Drive 파일ID': photo.fileId,
    'Drive URL': photo.url,
    '파일명': photo.fileName,
    '촬영위치코드': photo.locationCode,
    '촬영자': photo.inspector,
    '촬영일시': photo.takenAt,
    '사진메모': photo.memo,
    '클라이언트사진UUID': photo.clientPhotoUuid,
    '사용여부': photo.active
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
}

function nextPhotoId_(sheet, date) {
  var year = new Date(date || new Date()).getFullYear();
  var ids = readColumnValuesByHeader_(sheet, '사진ID');
  var max = ids.reduce(function (current, id) {
    var match = String(id || '').match(new RegExp('^PHOTO-' + year + '-(\\d{6})$'));
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return 'PHOTO-' + year + '-' + String(max + 1).padStart(6, '0');
}

function getInventoryPhotoFolder_(sessionId) {
  var properties = PropertiesService.getScriptProperties();
  var rootId = properties.getProperty('INVENTORY_PHOTO_ROOT_ID');
  var root;
  if (rootId) {
    try { root = DriveApp.getFolderById(rootId); } catch (error) { root = null; }
  }
  if (!root) {
    root = DriveApp.createFolder(INVENTORY_PHOTO_ROOT_NAME);
    properties.setProperty('INVENTORY_PHOTO_ROOT_ID', root.getId());
  }

  var key = 'INVENTORY_PHOTO_SESSION_' + sessionId;
  var sessionFolderId = properties.getProperty(key);
  if (sessionFolderId) {
    try { return DriveApp.getFolderById(sessionFolderId); } catch (error2) {}
  }
  var folder = root.createFolder(sessionId);
  properties.setProperty(key, folder.getId());
  return folder;
}

function sanitizeFileName_(value) {
  return String(value || 'photo').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

function serializePhoto_(photo) {
  return {
    photoId: photo.photoId,
    fileId: photo.fileId,
    url: photo.url,
    fileName: photo.fileName,
    photoType: photo.photoType,
    locationCode: photo.locationCode,
    takenAt: dateToIso_(photo.takenAt)
  };
}
