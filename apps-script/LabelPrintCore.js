'use strict';

function labelPrintText_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function labelPrintNumber_(value, name) {
  var number = Number(value);
  if (!Number.isFinite(number)) throw new Error('라벨설정 숫자값이 올바르지 않습니다: ' + name);
  return number;
}

function labelPrintRoundMm_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
}

function normalizeLabelPrintSettings(raw) {
  var source = raw || {};
  var settings = {
    labelType: labelPrintText_(source['기본 라벨규격']),
    labelVersion: labelPrintText_(source['라벨버전']),
    labelTitle: labelPrintText_(source['라벨제목']) || '강서청소년회관 물품조사',
    labelWidthMm: labelPrintNumber_(source['라벨가로mm'], '라벨가로mm'),
    labelHeightMm: labelPrintNumber_(source['라벨세로mm'], '라벨세로mm'),
    columns: labelPrintNumber_(source['페이지열수'], '페이지열수'),
    rows: labelPrintNumber_(source['페이지행수'], '페이지행수'),
    leftMarginMm: labelPrintNumber_(source['페이지왼쪽여백mm'], '페이지왼쪽여백mm'),
    topMarginMm: labelPrintNumber_(source['페이지위쪽여백mm'], '페이지위쪽여백mm'),
    columnGapMm: labelPrintNumber_(source['열간격mm'], '열간격mm'),
    rowGapMm: labelPrintNumber_(source['행간격mm'], '행간격mm'),
    qrSizeMm: labelPrintNumber_(source['QR크기mm'], 'QR크기mm'),
    xCorrectionMm: labelPrintNumber_(source['가로보정mm'], '가로보정mm'),
    yCorrectionMm: labelPrintNumber_(source['세로보정mm'], '세로보정mm'),
    thirdColumnXCorrectionMm: labelPrintNumber_(source['3열가로보정mm'] || 0, '3열가로보정mm'),
    printScale: labelPrintNumber_(source['인쇄배율'], '인쇄배율'),
    primaryManager: labelPrintText_(source['관리책임자 정']),
    secondaryManager: labelPrintText_(source['관리책임자 부']),
    managerVersion: labelPrintText_(source['책임자버전']),
    detailDeploymentUrl: labelPrintText_(source['상세조회배포URL'])
  };
  settings.pageSize = settings.columns * settings.rows;

  if (settings.labelType !== 'FORMTEC_LS3106') {
    throw new Error('지원하지 않는 라벨규격입니다: ' + settings.labelType);
  }
  if (!settings.labelVersion) throw new Error('라벨버전이 필요합니다.');
  if (!settings.primaryManager || !settings.secondaryManager) throw new Error('관리책임자 설정이 필요합니다.');
  if (!settings.managerVersion) throw new Error('책임자버전이 필요합니다.');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(settings.detailDeploymentUrl)) {
    throw new Error('상세조회배포URL이 올바른 /exec URL이 아닙니다.');
  }
  if (settings.columns !== 3 || settings.rows !== 8 || settings.pageSize !== 24) {
    throw new Error('Formtec LS3106 페이지 구조는 3열 × 8행이어야 합니다.');
  }
  return settings;
}

function calculateLabelSlotPosition(settings, slotIndex) {
  var index = Number(slotIndex);
  if (!Number.isInteger(index) || index < 0 || index >= settings.pageSize) {
    throw new Error('라벨 슬롯 번호가 범위를 벗어났습니다.');
  }
  var row = Math.floor(index / settings.columns);
  var column = index % settings.columns;
  var xMm = settings.leftMarginMm + settings.xCorrectionMm +
    column * (settings.labelWidthMm + settings.columnGapMm) +
    (column === 2 ? settings.thirdColumnXCorrectionMm : 0);
  var topMm = settings.topMarginMm - settings.yCorrectionMm +
    row * (settings.labelHeightMm + settings.rowGapMm);
  return {
    row: row,
    column: column,
    xMm: labelPrintRoundMm_(xMm),
    topMm: labelPrintRoundMm_(topMm)
  };
}

function paginateLabelPrintItems(items, pageSize) {
  var size = Number(pageSize || 24);
  if (!Number.isInteger(size) || size < 1) throw new Error('페이지 크기가 올바르지 않습니다.');
  var source = Array.isArray(items) ? items : [];
  var pages = [];
  for (var i = 0; i < source.length; i += size) {
    var page = source.slice(i, i + size);
    while (page.length < size) page.push(null);
    pages.push(page);
  }
  return pages;
}

function classifyLabelPrintType(issue) {
  var source = issue || {};
  var issueStatus = labelPrintText_(source.issueStatus || source['QR발급상태']);
  var reprintRequired = labelPrintText_(source.reprintRequired || source['재출력필요여부']);
  var lastPrintedAt = source.lastPrintedAt || source['최종출력일시'] || '';
  return issueStatus === '미발급' && reprintRequired !== 'Y' && !lastPrintedAt
    ? '최초발급'
    : '재출력';
}

function labelPrintIssueValue_(issue, camelName, headerName) {
  if (!issue) return '';
  if (Object.prototype.hasOwnProperty.call(issue, camelName)) return issue[camelName];
  return issue[headerName];
}

function buildLabelPrintIssueStateFingerprint(issue) {
  var source = issue || {};
  var rawCount = labelPrintIssueValue_(source, 'reprintCount', '재출력횟수');
  var count = Number(rawCount || 0);
  if (!Number.isFinite(count)) count = 0;
  return {
    issueStatus: labelPrintText_(labelPrintIssueValue_(source, 'issueStatus', 'QR발급상태')),
    reprintRequired: labelPrintText_(labelPrintIssueValue_(source, 'reprintRequired', '재출력필요여부')),
    reprintCount: count,
    lastPrintBatchId: labelPrintText_(labelPrintIssueValue_(source, 'lastPrintBatchId', '최종출력배치ID'))
  };
}

function labelPrintIssueStateMatchesFingerprint(issue, fingerprint) {
  var current = buildLabelPrintIssueStateFingerprint(issue);
  var expected = fingerprint || {};
  var expectedCount = Number(expected.reprintCount || 0);
  if (!Number.isFinite(expectedCount)) expectedCount = 0;
  return current.issueStatus === labelPrintText_(expected.issueStatus) &&
    current.reprintRequired === labelPrintText_(expected.reprintRequired) &&
    current.reprintCount === expectedCount &&
    current.lastPrintBatchId === labelPrintText_(expected.lastPrintBatchId);
}

function labelPrintExpectedQrUrl_(settings, accessKey) {
  return settings.detailDeploymentUrl + '?k=' + accessKey;
}

function validateLabelPrintCandidate(asset, currentState, issueRows, settings) {
  var source = asset || {};
  var usageStatus = labelPrintText_(source.usageStatus || source['사용여부']);
  var newAssetNo = labelPrintText_(source.newAssetNo || source['New 비품번호']);
  var name = labelPrintText_(source.name || source['품명']);
  var masterQrUrl = labelPrintText_(source.qrLookupUrl || source['QR조회URL']);

  function fail(reason, issue) {
    return { ok: false, reason: reason, issue: issue || null, printType: '' };
  }

  if (usageStatus !== '사용') return fail('사용 중지 비품');
  if (!newAssetNo) return fail('비품번호 없음');
  if (!name) return fail('품명 없음');

  var active = (issueRows || []).filter(function (issue) {
    return labelPrintText_(labelPrintIssueValue_(issue, 'accessKeyStatus', 'QR접근키상태')) === '사용';
  });
  if (!active.length) return fail('활성 QR 없음');
  if (active.length > 1) return fail('활성 QR 중복');

  var issue = active[0];
  var accessKey = labelPrintText_(labelPrintIssueValue_(issue, 'accessKey', 'QR접근키'));
  var lookupUrl = labelPrintText_(labelPrintIssueValue_(issue, 'lookupUrl', 'QR조회URL'));
  if (!/^[A-Za-z0-9_-]{32}$/.test(accessKey)) return fail('QR 접근키 형식 오류', issue);

  var expectedUrl = labelPrintExpectedQrUrl_(settings, accessKey);
  if (lookupUrl !== expectedUrl) return fail('QR URL 불일치', issue);
  if (masterQrUrl !== lookupUrl) return fail('마스터 QR URL 불일치', issue);

  return {
    ok: true,
    reason: '',
    issue: issue,
    printType: classifyLabelPrintType(issue)
  };
}

function labelPrintMappedSortValue_(item, fieldName) {
  if (!item || item[fieldName] === null || item[fieldName] === '') return { mapped: false, value: 0 };
  var value = Number(item[fieldName]);
  return Number.isFinite(value) ? { mapped: true, value: value } : { mapped: false, value: 0 };
}

function sortLabelPrintItems(items) {
  return (items || []).slice().sort(function (a, b) {
    var aFloor = labelPrintMappedSortValue_(a, 'floorSortOrder');
    var bFloor = labelPrintMappedSortValue_(b, 'floorSortOrder');
    if (aFloor.mapped || bFloor.mapped) {
      if (aFloor.mapped !== bFloor.mapped) return aFloor.mapped ? -1 : 1;
      if (aFloor.value !== bFloor.value) return aFloor.value - bFloor.value;
      var mappedFloorCompare = labelPrintText_(a && a.currentFloor).localeCompare(
        labelPrintText_(b && b.currentFloor), 'ko', { numeric: true }
      );
      if (mappedFloorCompare) return mappedFloorCompare;
    }

    var aLocation = labelPrintMappedSortValue_(a, 'locationSortOrder');
    var bLocation = labelPrintMappedSortValue_(b, 'locationSortOrder');
    if (aLocation.mapped !== bLocation.mapped) return aLocation.mapped ? -1 : 1;
    if (aLocation.mapped && aLocation.value !== bLocation.value) return aLocation.value - bLocation.value;

    if (!aFloor.mapped && !bFloor.mapped) {
      var fallbackFloorCompare = labelPrintText_(a && a.currentFloor).localeCompare(
        labelPrintText_(b && b.currentFloor), 'ko', { numeric: true }
      );
      if (fallbackFloorCompare) return fallbackFloorCompare;
    }
    var spaceCompare = labelPrintText_(a && a.currentSpaceName).localeCompare(
      labelPrintText_(b && b.currentSpaceName), 'ko', { numeric: true }
    );
    if (spaceCompare) return spaceCompare;
    return labelPrintText_(a && a.newAssetNo).localeCompare(labelPrintText_(b && b.newAssetNo), 'ko', { numeric: true });
  });
}

function makeLabelPrintBatchId(dateKey, sequence) {
  var date = labelPrintText_(dateKey);
  var seq = Number(sequence);
  if (!/^\d{8}$/.test(date)) throw new Error('출력 배치 날짜는 yyyyMMdd 형식이어야 합니다.');
  if (!Number.isInteger(seq) || seq < 1) throw new Error('출력 배치 순번이 올바르지 않습니다.');
  return 'LABEL-' + date + '-' + String(seq).padStart(3, '0');
}

function buildLabelPrintCompletionPatch(issue, context) {
  var source = issue || {};
  var ctx = context || {};
  var batchId = labelPrintText_(ctx.batchId);
  if (!batchId) throw new Error('출력 배치ID가 필요합니다.');

  var currentBatchId = labelPrintText_(source.lastPrintBatchId || source['최종출력배치ID']);
  var currentCount = Number(source.reprintCount !== undefined ? source.reprintCount : source['재출력횟수'] || 0);
  if (currentBatchId === batchId) {
    return Object.assign({}, source, {
      duplicate: true,
      reprintCount: currentCount,
      lastPrintBatchId: currentBatchId
    });
  }

  var printType = labelPrintText_(ctx.printType);
  if (printType !== '최초발급' && printType !== '재출력') {
    throw new Error('출력구분이 올바르지 않습니다.');
  }
  var reprintReason = labelPrintText_(source.reprintReason || source['재출력사유']);
  return {
    duplicate: false,
    issueStatus: '발급완료',
    labelType: labelPrintText_(ctx.labelType),
    labelVersion: labelPrintText_(ctx.labelVersion),
    printedPrimaryManager: labelPrintText_(ctx.primaryManager),
    printedSecondaryManager: labelPrintText_(ctx.secondaryManager),
    managerVersion: labelPrintText_(ctx.managerVersion),
    labelInspectionDate: ctx.inspectionDate || '',
    lastPrintedAt: ctx.printedAt || new Date(),
    reprintRequired: 'N',
    reprintReason: reprintReason,
    reprintCount: currentCount + (printType === '재출력' ? 1 : 0),
    lastPrintBatchId: batchId
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeLabelPrintSettings: normalizeLabelPrintSettings,
    classifyLabelPrintType: classifyLabelPrintType,
    validateLabelPrintCandidate: validateLabelPrintCandidate,
    buildLabelPrintIssueStateFingerprint: buildLabelPrintIssueStateFingerprint,
    labelPrintIssueStateMatchesFingerprint: labelPrintIssueStateMatchesFingerprint,
    sortLabelPrintItems: sortLabelPrintItems,
    paginateLabelPrintItems: paginateLabelPrintItems,
    calculateLabelSlotPosition: calculateLabelSlotPosition,
    makeLabelPrintBatchId: makeLabelPrintBatchId,
    buildLabelPrintCompletionPatch: buildLabelPrintCompletionPatch
  };
}
