var INVENTORY_COMPLETED_RESULTS = ['정상', '위치변경', '상태이상', '미발견', '보류'];
var INSPECTION_SNAPSHOT_FIELDS = [
  'confirmedLocationCode',
  'confirmedFloor',
  'confirmedSpaceName',
  'result',
  'issueType',
  'physicalConfirmed',
  'locationMatches',
  'labelStatus',
  'fieldMemo',
  'inspector',
  'firstInspectedAt'
];

function padNumber_(value, width) {
  return String(Number(value) || 0).padStart(width, '0');
}

function round2_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function makeSessionId(year, existingIds) {
  var normalizedYear = String(year);
  var regex = new RegExp('^INV-' + normalizedYear + '-(\\d{3})$');
  var maxSequence = (existingIds || []).reduce(function (max, id) {
    var match = String(id || '').match(regex);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return 'INV-' + normalizedYear + '-' + padNumber_(maxSequence + 1, 3);
}

function makeRecordId(sessionId, index) {
  var match = String(sessionId || '').match(/^INV-(\d{4})-(\d{3})$/);
  if (!match) throw new Error('유효하지 않은 세션ID입니다: ' + sessionId);
  if (!Number.isInteger(Number(index)) || Number(index) < 1) {
    throw new Error('기록 순번은 1 이상의 정수여야 합니다.');
  }
  return 'INVR-' + match[1] + '-' + match[2] + '-' + padNumber_(index, 4);
}

function makeTempAssetId(year, existingIds) {
  var normalizedYear = String(year);
  var regex = new RegExp('^TMP-' + normalizedYear + '-(\\d{4})$');
  var maxSequence = (existingIds || []).reduce(function (max, id) {
    var match = String(id || '').match(regex);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);
  return 'TMP-' + normalizedYear + '-' + padNumber_(maxSequence + 1, 4);
}

function makeUnregisteredRecordId(sessionId, index) {
  var match = String(sessionId || '').match(/^INV-(\d{4})-(\d{3})$/);
  if (!match) throw new Error('유효하지 않은 세션ID입니다: ' + sessionId);
  if (!Number.isInteger(Number(index)) || Number(index) < 1) {
    throw new Error('미등록 기록 순번은 1 이상의 정수여야 합니다.');
  }
  return 'INVR-' + match[1] + '-' + match[2] + '-U' + padNumber_(index, 3);
}

function buildInventoryRecords(sessionId, assets, errorMap) {
  var errors = errorMap || {};
  return (assets || []).map(function (asset, index) {
    return {
      recordId: makeRecordId(sessionId, index + 1),
      sessionId: sessionId,
      targetType: '등록비품',
      systemId: asset.systemId || '',
      tempAssetId: '',
      oldAssetNo: normalizeAssetNumber(asset.oldAssetNo),
      newAssetNo: asset.newAssetNo || '',
      name: asset.name || '',
      spec: asset.spec || '',
      originalLocationCode: asset.locationCode || '',
      originalFloor: asset.floor || '',
      originalSpaceName: asset.spaceName || '',
      confirmedLocationCode: '',
      confirmedFloor: '',
      confirmedSpaceName: '',
      result: '미확인',
      issueType: '',
      physicalConfirmed: 'N',
      locationMatches: '',
      labelStatus: '',
      fieldMemo: '',
      inspector: '',
      firstInspectedAt: '',
      lastModifiedAt: '',
      photoCount: 0,
      errorReviewId: errors[asset.systemId] || '',
      adminReviewStatus: '미검토',
      masterApplied: 'N',
      masterAppliedAt: '',
      version: 0,
      lastActionUuid: '',
      memo: ''
    };
  });
}

function buildUnregisteredRecord(input) {
  var data = input || {};
  if (!data.sessionId || !data.recordId || !data.tempAssetId || !data.name) {
    throw new Error('미등록 비품 생성에 필요한 식별정보와 품명이 부족합니다.');
  }
  if (!data.locationCode || !data.floor || !data.spaceName) {
    throw new Error('미등록 비품의 발견 위치가 필요합니다.');
  }
  var now = data.now || new Date();
  var actionUuid = String(data.actionUuid || '').trim();
  if (!actionUuid) throw new Error('작업UUID가 필요합니다.');

  return {
    recordId: String(data.recordId),
    sessionId: String(data.sessionId),
    targetType: '미등록비품',
    systemId: '',
    tempAssetId: String(data.tempAssetId),
    oldAssetNo: '',
    newAssetNo: '',
    name: String(data.name).trim(),
    spec: String(data.spec || '').trim(),
    originalLocationCode: '',
    originalFloor: '',
    originalSpaceName: '',
    confirmedLocationCode: String(data.locationCode),
    confirmedFloor: String(data.floor),
    confirmedSpaceName: String(data.spaceName),
    result: '미등록발견',
    issueType: '',
    physicalConfirmed: 'Y',
    locationMatches: '',
    labelStatus: '',
    fieldMemo: String(data.memo || '').trim(),
    inspector: String(data.inspector || '').trim() || '미지정',
    firstInspectedAt: now,
    lastModifiedAt: now,
    photoCount: Number(data.photoCount || 0),
    errorReviewId: '',
    adminReviewStatus: '미검토',
    masterApplied: 'N',
    masterAppliedAt: '',
    version: 1,
    lastActionUuid: actionUuid,
    memo: ''
  };
}

function buildLocationMap(locationRows) {
  var map = {};

  (locationRows || []).forEach(function (row) {
    if (!row || !row.locationCode) return;
    map[row.locationCode] = {
      locationCode: row.locationCode,
      floor: row.floor || '미정',
      spaceName: row.spaceName || row.locationCode,
      displayStatus: row.displayStatus || '표시',
      sortOrder: Number(row.sortOrder) || 9999,
      representativeLocationCode: row.representativeLocationCode || row.locationCode
    };
  });

  Object.keys(map).forEach(function (code) {
    var item = map[code];
    var representative = map[item.representativeLocationCode] || item;
    item.representative = {
      locationCode: representative.locationCode,
      floor: representative.floor,
      spaceName: representative.spaceName,
      displayStatus: representative.displayStatus,
      sortOrder: representative.sortOrder
    };
  });

  return map;
}

function resultMetricVector_(result) {
  var value = String(result || '미확인');
  return {
    completed: INVENTORY_COMPLETED_RESULTS.indexOf(value) >= 0 ? 1 : 0,
    normal: value === '정상' ? 1 : 0,
    locationChanged: value === '위치변경' ? 1 : 0,
    issue: value === '상태이상' ? 1 : 0,
    missing: value === '미발견' ? 1 : 0,
    unregisteredFound: value === '미등록발견' ? 1 : 0,
    unconfirmed: value === '미확인' ? 1 : 0
  };
}

function computeMetricDelta(previousResult, nextResult) {
  var before = resultMetricVector_(previousResult);
  var after = resultMetricVector_(nextResult);
  return {
    completed: after.completed - before.completed,
    normal: after.normal - before.normal,
    locationChanged: after.locationChanged - before.locationChanged,
    issue: after.issue - before.issue,
    missing: after.missing - before.missing,
    unregisteredFound: after.unregisteredFound - before.unregisteredFound,
    unconfirmed: after.unconfirmed - before.unconfirmed
  };
}

function aggregateProgress(records, locationMap) {
  var map = locationMap || {};
  var result = {
    total: 0,
    completed: 0,
    unconfirmed: 0,
    normal: 0,
    locationChanged: 0,
    issue: 0,
    missing: 0,
    unregisteredFound: 0,
    progress: 0,
    floors: {},
    locations: {}
  };

  (records || []).forEach(function (record) {
    if (record.targetType === '미등록비품' || record.result === '미등록발견') {
      result.unregisteredFound += 1;
      return;
    }
    if (record.targetType !== '등록비품') return;

    var metric = resultMetricVector_(record.result);
    result.total += 1;
    result.completed += metric.completed;
    result.unconfirmed += metric.unconfirmed;
    result.normal += metric.normal;
    result.locationChanged += metric.locationChanged;
    result.issue += metric.issue;
    result.missing += metric.missing;

    var locationInfo = map[record.originalLocationCode] || null;
    var representative = locationInfo && locationInfo.representative
      ? locationInfo.representative
      : {
          locationCode: record.originalLocationCode || 'UNASSIGNED',
          floor: record.originalFloor || '미정',
          spaceName: record.originalSpaceName || '위치 미정',
          displayStatus: '검토',
          sortOrder: 9999
        };

    var locationCode = representative.locationCode || 'UNASSIGNED';
    var floor = representative.floor || record.originalFloor || '미정';

    if (!result.locations[locationCode]) {
      result.locations[locationCode] = {
        locationCode: locationCode,
        floor: floor,
        spaceName: representative.spaceName || record.originalSpaceName || '위치 미정',
        displayStatus: representative.displayStatus || '표시',
        sortOrder: Number(representative.sortOrder) || 9999,
        reviewRequired: (representative.displayStatus || '') === '검토',
        total: 0,
        completed: 0,
        unconfirmed: 0,
        progress: 0
      };
    }

    var locationBucket = result.locations[locationCode];
    locationBucket.total += 1;
    locationBucket.completed += metric.completed;
    locationBucket.unconfirmed += metric.unconfirmed;

    if (!result.floors[floor]) {
      result.floors[floor] = {
        floor: floor,
        total: 0,
        completed: 0,
        unconfirmed: 0,
        progress: 0
      };
    }

    result.floors[floor].total += 1;
    result.floors[floor].completed += metric.completed;
    result.floors[floor].unconfirmed += metric.unconfirmed;
  });

  Object.keys(result.locations).forEach(function (code) {
    var bucket = result.locations[code];
    bucket.progress = bucket.total ? round2_(bucket.completed / bucket.total * 100) : 0;
  });

  Object.keys(result.floors).forEach(function (floor) {
    var bucket = result.floors[floor];
    bucket.progress = bucket.total ? round2_(bucket.completed / bucket.total * 100) : 0;
  });

  result.progress = result.total ? round2_(result.completed / result.total * 100) : 0;
  return result;
}

function normalizeAssetNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value.getFullYear() + '-' + (value.getMonth() + 1);
  }

  var text = String(value).trim();
  if (!text) return '';
  var match = text.match(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(\d{4})\s+\d{2}:\d{2}:\d{2}\s+GMT[+-]\d{4}/);
  if (!match) return text;

  var months = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12
  };
  return match[2] + '-' + months[match[1]];
}

function validateChangeLogPayload(change) {
  var input = change || {};
  var requiredText = [
    ['sessionId', '세션ID'],
    ['changedBy', '변경자'],
    ['actionType', '작업유형'],
    ['targetField', '대상필드'],
    ['reason', '변경사유'],
    ['actionUuid', '작업UUID']
  ];

  requiredText.forEach(function (entry) {
    var key = entry[0];
    var label = entry[1];
    if (!Object.prototype.hasOwnProperty.call(input, key) || !String(input[key] || '').trim()) {
      throw new Error('변경이력 ' + label + ' 값이 필요합니다.');
    }
  });

  if (!Object.prototype.hasOwnProperty.call(input, 'changedAt') || !input.changedAt || isNaN(new Date(input.changedAt).getTime())) {
    throw new Error('변경이력 변경일시 값이 필요합니다.');
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'beforeValue') || input.beforeValue === undefined || input.beforeValue === null) {
    throw new Error('변경이력 변경전값 값이 필요합니다.');
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'afterValue') || input.afterValue === undefined || input.afterValue === null) {
    throw new Error('변경이력 변경후값 값이 필요합니다.');
  }
  if (!String(input.beforeValue).trim() && !String(input.afterValue).trim()) {
    throw new Error('변경이력 변경전값 또는 변경후값 중 하나는 필요합니다.');
  }
  if (String(input.actionType) !== '공간마감' && !String(input.recordId || '').trim()) {
    throw new Error('변경이력 기록ID 값이 필요합니다.');
  }
  return input;
}

function representativeCode_(locationCode, locationMap) {
  var item = (locationMap || {})[locationCode];
  return item && item.representative && item.representative.locationCode
    ? item.representative.locationCode
    : (locationCode || 'UNASSIGNED');
}

function buildRoomDisplayRecords(records, representativeLocationCode, locationMap) {
  var target = String(representativeLocationCode || '');
  var output = [];

  (records || []).forEach(function (record) {
    if (record.targetType === '미등록비품' || record.result === '미등록발견') {
      if (representativeCode_(record.confirmedLocationCode, locationMap) !== target) return;
      var unregistered = cloneRecord_(record);
      unregistered.displayRole = 'unregistered';
      output.push(unregistered);
      return;
    }
    if (record.targetType !== '등록비품') return;

    var originalRepresentative = representativeCode_(record.originalLocationCode, locationMap);
    var confirmedRepresentative = representativeCode_(record.confirmedLocationCode, locationMap);
    if (originalRepresentative === target) {
      var original = cloneRecord_(record);
      original.displayRole = 'original';
      output.push(original);
      return;
    }

    if (record.confirmedLocationCode && record.physicalConfirmed === 'Y' && confirmedRepresentative === target) {
      var inbound = cloneRecord_(record);
      inbound.displayRole = 'inbound';
      output.push(inbound);
    }
  });

  return output.sort(function (a, b) {
    var aPending = a.result === '미확인' ? 0 : 1;
    var bPending = b.result === '미확인' ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    var roleOrder = { original: 0, inbound: 1, unregistered: 2 };
    var ar = roleOrder[a.displayRole] === undefined ? 9 : roleOrder[a.displayRole];
    var br = roleOrder[b.displayRole] === undefined ? 9 : roleOrder[b.displayRole];
    if (ar !== br) return ar - br;
    return String(a.newAssetNo || a.oldAssetNo || a.tempAssetId || a.systemId || '')
      .localeCompare(String(b.newAssetNo || b.oldAssetNo || b.tempAssetId || b.systemId || ''), 'ko');
  });
}

function summarizeLocationCloseout(records, representativeLocationCode, locationMap) {
  var target = String(representativeLocationCode || '');
  var result = {
    total: 0,
    completed: 0,
    unconfirmed: 0,
    normal: 0,
    locationChanged: 0,
    issue: 0,
    missing: 0,
    unregisteredFound: 0,
    canCloseCleanly: false
  };

  (records || []).forEach(function (record) {
    if (record.targetType === '미등록비품' || record.result === '미등록발견') {
      if (representativeCode_(record.confirmedLocationCode, locationMap) === target) {
        result.unregisteredFound += 1;
      }
      return;
    }
    if (record.targetType !== '등록비품') return;
    if (representativeCode_(record.originalLocationCode, locationMap) !== target) return;

    var metric = resultMetricVector_(record.result);
    result.total += 1;
    result.completed += metric.completed;
    result.unconfirmed += metric.unconfirmed;
    result.normal += metric.normal;
    result.locationChanged += metric.locationChanged;
    result.issue += metric.issue;
    result.missing += metric.missing;
  });

  result.canCloseCleanly = result.unconfirmed === 0;
  return result;
}

function sortLocationBuckets(buckets) {
  return (buckets || []).slice().sort(function (a, b) {
    var aDone = Number(a && a.unconfirmed || 0) > 0 ? 0 : 1;
    var bDone = Number(b && b.unconfirmed || 0) > 0 ? 0 : 1;
    if (aDone !== bDone) return aDone - bDone;
    var aOrder = Number(a && a.sortOrder || 9999);
    var bOrder = Number(b && b.sortOrder || 9999);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a && a.spaceName || '').localeCompare(String(b && b.spaceName || ''), 'ko');
  });
}

function createInspectionSnapshot(record) {
  var snapshot = {};
  INSPECTION_SNAPSHOT_FIELDS.forEach(function (field) {
    snapshot[field] = record && Object.prototype.hasOwnProperty.call(record, field)
      ? record[field]
      : '';
  });
  return snapshot;
}

function cloneRecord_(record) {
  var copy = {};
  Object.keys(record || {}).forEach(function (key) {
    copy[key] = record[key];
  });
  return copy;
}

function labelStatusForIssue_(issueType) {
  if (issueType === '라벨없음') return '없음';
  if (issueType === '라벨훼손') return '훼손';
  if (issueType === '번호불일치') return '번호불일치';
  return '정상';
}

function applyInspectionAction(record, action) {
  var source = record || {};
  var input = action || {};
  if (String(source.result || '미확인') !== '미확인') {
    throw new Error('현장 판정은 미확인 상태의 비품에서만 처리할 수 있습니다.');
  }

  var type = String(input.type || '').trim();
  var now = input.now || new Date();
  var inspector = String(input.inspector || '').trim() || '미지정';
  var actionUuid = String(input.actionUuid || '').trim();
  if (!type) throw new Error('작업유형이 필요합니다.');
  if (!actionUuid) throw new Error('작업UUID가 필요합니다.');

  var next = cloneRecord_(source);
  next.issueType = '';
  next.fieldMemo = String(input.memo || '').trim();
  next.inspector = inspector;
  next.firstInspectedAt = next.firstInspectedAt || now;
  next.lastModifiedAt = now;
  next.version = Number(next.version || 0) + 1;
  next.lastActionUuid = actionUuid;

  if (type === '정상확인') {
    next.confirmedLocationCode = source.originalLocationCode || '';
    next.confirmedFloor = source.originalFloor || '';
    next.confirmedSpaceName = source.originalSpaceName || '';
    next.result = '정상';
    next.physicalConfirmed = 'Y';
    next.locationMatches = 'Y';
    next.labelStatus = '정상';
    return next;
  }

  if (type === '위치변경') {
    if (!input.locationCode || !input.floor || !input.spaceName) {
      throw new Error('발견 위치 정보가 필요합니다.');
    }
    next.confirmedLocationCode = String(input.locationCode);
    next.confirmedFloor = String(input.floor);
    next.confirmedSpaceName = String(input.spaceName);
    next.result = '위치변경';
    next.physicalConfirmed = 'Y';
    next.locationMatches = 'N';
    next.labelStatus = '정상';
    return next;
  }

  if (type === '상태이상') {
    if (!input.issueType) throw new Error('이상유형이 필요합니다.');
    if (!input.locationCode || !input.floor || !input.spaceName) {
      throw new Error('실물 확인 위치 정보가 필요합니다.');
    }
    next.confirmedLocationCode = String(input.locationCode);
    next.confirmedFloor = String(input.floor);
    next.confirmedSpaceName = String(input.spaceName);
    next.result = '상태이상';
    next.issueType = String(input.issueType);
    next.physicalConfirmed = 'Y';
    next.locationMatches = input.locationMatches === false ? 'N' : 'Y';
    next.labelStatus = labelStatusForIssue_(next.issueType);
    return next;
  }

  if (type === '미발견') {
    next.confirmedLocationCode = '';
    next.confirmedFloor = '';
    next.confirmedSpaceName = '';
    next.result = '미발견';
    next.issueType = '';
    next.physicalConfirmed = 'N';
    next.locationMatches = '';
    next.labelStatus = '';
    return next;
  }

  throw new Error('지원하지 않는 작업유형입니다: ' + type);
}

function reviseInspectionAction(record, action) {
  var source = record || {};
  var input = action || {};
  if (source.targetType !== '등록비품') {
    throw new Error('등록비품만 판정을 수정할 수 있습니다.');
  }
  if (String(source.result || '미확인') === '미확인') {
    throw new Error('미확인 비품은 최초 판정 기능을 사용하세요.');
  }

  var reason = String(input.memo || '').trim();
  if (!reason) throw new Error('판정 수정 사유가 필요합니다.');
  var type = String(input.type || '').trim();
  var actionUuid = String(input.actionUuid || '').trim();
  var inspector = String(input.inspector || '').trim() || '미지정';
  var now = input.now || new Date();
  if (!type) throw new Error('작업유형이 필요합니다.');
  if (!actionUuid) throw new Error('작업UUID가 필요합니다.');

  if (type === '미확인복원') {
    var reset = cloneRecord_(source);
    reset.confirmedLocationCode = '';
    reset.confirmedFloor = '';
    reset.confirmedSpaceName = '';
    reset.result = '미확인';
    reset.issueType = '';
    reset.physicalConfirmed = 'N';
    reset.locationMatches = '';
    reset.labelStatus = '';
    reset.fieldMemo = reason;
    reset.inspector = inspector;
    reset.lastModifiedAt = now;
    reset.version = Number(reset.version || 0) + 1;
    reset.lastActionUuid = actionUuid;
    return reset;
  }

  var draft = cloneRecord_(source);
  draft.result = '미확인';
  var next = applyInspectionAction(draft, input);
  next.firstInspectedAt = source.firstInspectedAt || next.firstInspectedAt;
  return next;
}

function restoreInspectionSnapshot(record, snapshot, options) {
  var next = cloneRecord_(record || {});
  var before = snapshot || {};
  var opts = options || {};

  INSPECTION_SNAPSHOT_FIELDS.forEach(function (field) {
    next[field] = Object.prototype.hasOwnProperty.call(before, field) ? before[field] : '';
  });

  next.lastModifiedAt = opts.now || new Date();
  next.version = Number(record && record.version || 0) + 1;
  next.lastActionUuid = String(opts.actionUuid || '').trim();
  if (!next.lastActionUuid) throw new Error('작업UUID가 필요합니다.');
  return next;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    makeSessionId: makeSessionId,
    makeRecordId: makeRecordId,
    makeTempAssetId: makeTempAssetId,
    makeUnregisteredRecordId: makeUnregisteredRecordId,
    buildInventoryRecords: buildInventoryRecords,
    buildUnregisteredRecord: buildUnregisteredRecord,
    buildLocationMap: buildLocationMap,
    aggregateProgress: aggregateProgress,
    computeMetricDelta: computeMetricDelta,
    summarizeLocationCloseout: summarizeLocationCloseout,
    sortLocationBuckets: sortLocationBuckets,
    buildRoomDisplayRecords: buildRoomDisplayRecords,
    normalizeAssetNumber: normalizeAssetNumber,
    validateChangeLogPayload: validateChangeLogPayload,
    createInspectionSnapshot: createInspectionSnapshot,
    applyInspectionAction: applyInspectionAction,
    reviseInspectionAction: reviseInspectionAction,
    restoreInspectionSnapshot: restoreInspectionSnapshot
  };
}
