var INVENTORY_COMPLETED_RESULTS = ['정상', '위치변경', '상태이상', '미발견', '보류'];

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

function buildInventoryRecords(sessionId, assets, errorMap) {
  var errors = errorMap || {};
  return (assets || []).map(function (asset, index) {
    return {
      recordId: makeRecordId(sessionId, index + 1),
      sessionId: sessionId,
      targetType: '등록비품',
      systemId: asset.systemId || '',
      tempAssetId: '',
      oldAssetNo: asset.oldAssetNo || '',
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    makeSessionId: makeSessionId,
    makeRecordId: makeRecordId,
    buildInventoryRecords: buildInventoryRecords,
    buildLocationMap: buildLocationMap,
    aggregateProgress: aggregateProgress,
    computeMetricDelta: computeMetricDelta
  };
}
