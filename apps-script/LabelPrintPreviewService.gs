var LABEL_PRINT_PREVIEW_CACHE_TTL_SECONDS = 21600;
var LABEL_PRINT_PREVIEW_PAGE_SIZE = 24;

function uniqueLabelPrintSystemIds_(values) {
  var seen = {};
  return (values || []).map(function (value) { return String(value || '').trim(); })
    .filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
}

function makeNextLabelPrintBatchId_(now) {
  var timestamp = now || new Date();
  var dateKey = Utilities.formatDate(timestamp, 'Asia/Seoul', 'yyyyMMdd');
  var propertyKey = 'ASSET_LABEL_BATCH_SEQUENCE_' + dateKey;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var properties = PropertiesService.getScriptProperties();
    var next = Number(properties.getProperty(propertyKey) || 0) + 1;
    properties.setProperty(propertyKey, String(next));
    return makeLabelPrintBatchId(dateKey, next);
  } finally {
    lock.releaseLock();
  }
}

function makeLabelPrintPreviewToken_() {
  var token = String(Utilities.getUuid() || '').replace(/-/g, '');
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
    throw new Error('라벨 미리보기 토큰을 생성하지 못했습니다.');
  }
  return token;
}

function buildLabelPrintSettingsSnapshot_(settings) {
  return {
    labelType: settings.labelType,
    labelVersion: settings.labelVersion,
    labelTitle: settings.labelTitle,
    labelWidthMm: settings.labelWidthMm,
    labelHeightMm: settings.labelHeightMm,
    columns: settings.columns,
    rows: settings.rows,
    pageSize: settings.pageSize,
    leftMarginMm: settings.leftMarginMm,
    topMarginMm: settings.topMarginMm,
    columnGapMm: settings.columnGapMm,
    rowGapMm: settings.rowGapMm,
    qrSizeMm: settings.qrSizeMm,
    xCorrectionMm: settings.xCorrectionMm,
    yCorrectionMm: settings.yCorrectionMm,
    thirdColumnXCorrectionMm: settings.thirdColumnXCorrectionMm,
    printScale: settings.printScale,
    primaryManager: settings.primaryManager,
    secondaryManager: settings.secondaryManager,
    managerVersion: settings.managerVersion
  };
}

function resolveLabelPrintFloorOrderFromMap_(locationMap, floor) {
  var targetFloor = String(floor || '').trim();
  if (!targetFloor) return null;
  var minOrder = null;
  var byCode = locationMap && locationMap.byCode ? locationMap.byCode : {};
  Object.keys(byCode).forEach(function (code) {
    var entry = byCode[code] || {};
    if (String(entry.floor || '').trim() !== targetFloor) return;
    if (entry.sortOrder === null || entry.sortOrder === '') return;
    var order = Number(entry.sortOrder);
    if (!Number.isFinite(order)) return;
    if (minOrder === null || order < minOrder) minOrder = order;
  });
  return minOrder;
}

function prepareLabelPrintPreview(request) {
  request = request || {};
  var systemIds = uniqueLabelPrintSystemIds_(request.systemIds || []);
  if (!systemIds.length) throw new Error('출력할 비품을 선택하세요.');

  var ss = getSpreadsheet_();
  var config = getRuntimeConfig_();
  var masterAssets = readLabelPrintMasterAssets_(
    getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.ASSET_MASTER)
  );
  var currentStateMap = readCurrentStateMap_(ss);
  var issueMap = groupLabelPrintIssuesBySystemId_(readAllQrIssueRows_(ss));
  var locationMap = readLabelPrintLocationOrderMap_(
    getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.LOCATION_MASTER)
  );
  var settings = normalizeLabelPrintSettings(readLabelSettingsMap_(
    getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.LABEL_SETTINGS)
  ));

  var masterMap = {};
  var duplicateMasterIds = {};
  masterAssets.forEach(function (asset) {
    if (masterMap[asset.systemId]) duplicateMasterIds[asset.systemId] = true;
    masterMap[asset.systemId] = asset;
  });

  var failures = [];
  var items = [];
  systemIds.forEach(function (systemId) {
    var asset = masterMap[systemId];
    if (!asset) {
      failures.push({ systemId: systemId, assetNo: '', reason: '비품마스터 누락' });
      return;
    }
    if (duplicateMasterIds[systemId]) {
      failures.push({ systemId: systemId, assetNo: asset.newAssetNo, reason: '비품마스터 시스템 ID 중복' });
      return;
    }

    var state = currentStateMap[systemId] || null;
    var issueRows = issueMap[systemId] || [];
    var validation = validateLabelPrintCandidate(asset, state, issueRows, settings);
    if (!validation.ok) {
      failures.push({ systemId: systemId, assetNo: asset.newAssetNo, reason: validation.reason });
      return;
    }

    var currentFloor = String(state && state.currentFloor || asset.floor || '').trim();
    var currentSpaceName = String(state && state.currentSpaceName || asset.spaceName || '').trim();
    var currentLocationCode = String(state && state.currentLocationCode || asset.locationCode || '').trim();
    var currentResult = String(state && state.currentResult || '').trim();
    var issue = validation.issue;
    var locationSortOrder = resolveLabelPrintLocationOrder_(
      locationMap, currentLocationCode, currentFloor, currentSpaceName
    );
    var floorSortOrder = resolveLabelPrintFloorOrderFromMap_(locationMap, currentFloor);

    items.push({
      systemId: systemId,
      accessKey: String(issue.accessKey || '').trim(),
      qrUrl: String(issue.lookupUrl || '').trim(),
      issueStateFingerprint: buildLabelPrintIssueStateFingerprint(issue),
      newAssetNo: asset.newAssetNo,
      name: asset.name,
      currentFloor: currentFloor,
      currentSpaceName: currentSpaceName,
      currentResult: currentResult,
      inspectionDate: formatLabelInspectionDate_(state && state.latestJudgedAt || ''),
      printType: validation.printType,
      floorSortOrder: floorSortOrder,
      locationSortOrder: locationSortOrder
    });
  });

  if (failures.length) {
    var details = failures.map(function (failure) {
      return (failure.assetNo || failure.systemId) + ': ' + failure.reason;
    }).join(' / ');
    throw new Error(systemIds.length + '개 중 ' + failures.length + '개 출력 불가 — ' + details);
  }

  items = sortLabelPrintItems(items);
  var batchId = makeNextLabelPrintBatchId_();
  var token = makeLabelPrintPreviewToken_();
  var printSettings = buildLabelPrintSettingsSnapshot_(settings);
  var createdAt = new Date().toISOString();
  var pageCount = Math.ceil(items.length / LABEL_PRINT_PREVIEW_PAGE_SIZE);

  return {
    token: token,
    batchId: batchId,
    environment: config.environment,
    createdAt: createdAt,
    pageCount: pageCount,
    itemCount: items.length,
    printSettings: printSettings,
    items: items
  };
}

function labelPrintPreviewManifestKey_(token) {
  return 'LPV:' + token + ':manifest';
}

function labelPrintPreviewPageKey_(token, pageNumber) {
  return 'LPV:' + token + ':page:' + pageNumber;
}

function storeLabelPrintPreviewSnapshot_(snapshot) {
  if (!snapshot || !snapshot.token) throw new Error('저장할 라벨 미리보기 스냅샷이 없습니다.');
  var cache = CacheService.getScriptCache();
  var pages = paginateLabelPrintItems(snapshot.items || [], LABEL_PRINT_PREVIEW_PAGE_SIZE);
  var manifest = {
    token: snapshot.token,
    batchId: snapshot.batchId,
    environment: snapshot.environment,
    createdAt: snapshot.createdAt,
    pageCount: pages.length,
    itemCount: snapshot.itemCount,
    printSettings: snapshot.printSettings
  };

  cache.put(
    labelPrintPreviewManifestKey_(snapshot.token),
    JSON.stringify(manifest),
    LABEL_PRINT_PREVIEW_CACHE_TTL_SECONDS
  );
  pages.forEach(function (page, index) {
    var compactPage = page.filter(function (item) { return !!item; });
    if (compactPage.length > 24) throw new Error('라벨 미리보기 페이지가 24개를 초과했습니다.');
    cache.put(
      labelPrintPreviewPageKey_(snapshot.token, index + 1),
      JSON.stringify(compactPage),
      21600
    );
  });
  return manifest;
}

function loadLabelPrintPreviewSnapshot_(token) {
  var normalizedToken = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(normalizedToken)) {
    throw new Error('유효하지 않은 라벨 미리보기 토큰입니다.');
  }
  var cache = CacheService.getScriptCache();
  var rawManifest = cache.get(labelPrintPreviewManifestKey_(normalizedToken));
  if (!rawManifest) throw new Error('라벨 미리보기가 만료되었거나 존재하지 않습니다. 다시 생성하세요.');
  var manifest = JSON.parse(rawManifest);
  var items = [];
  for (var pageNumber = 1; pageNumber <= Number(manifest.pageCount || 0); pageNumber += 1) {
    var rawPage = cache.get(labelPrintPreviewPageKey_(normalizedToken, pageNumber));
    if (!rawPage) throw new Error('라벨 미리보기 일부가 만료되었습니다. 다시 생성하세요.');
    var pageItems = JSON.parse(rawPage);
    if (!Array.isArray(pageItems) || pageItems.length > 24) {
      throw new Error('라벨 미리보기 페이지 데이터가 손상되었습니다.');
    }
    items = items.concat(pageItems);
  }
  manifest.items = items;
  return manifest;
}

function validateLabelPrintPreviewSnapshot_(snapshot) {
  if (!snapshot) throw new Error('라벨 미리보기 스냅샷이 없습니다.');
  var config = getRuntimeConfig_();
  if (String(snapshot.environment || '') !== String(config.environment || '')) {
    throw new Error('미리보기 생성 환경과 현재 실행 환경이 다릅니다.');
  }

  var issueMap = groupLabelPrintIssuesBySystemId_(readAllQrIssueRows_(getSpreadsheet_()));
  var failures = [];
  (snapshot.items || []).forEach(function (item) {
    var active = (issueMap[item.systemId] || []).filter(function (issue) {
      return String(issue.accessKeyStatus || '').trim() === '사용';
    });
    if (active.length !== 1) {
      failures.push(item.newAssetNo + ': 현재 활성 QR ' + (active.length ? '중복' : '없음'));
      return;
    }
    var current = active[0];
    if (String(current.accessKey || '').trim() !== String(item.accessKey || '').trim()) {
      failures.push(item.newAssetNo + ': QR 접근키 변경');
      return;
    }
    if (String(current.lookupUrl || '').trim() !== String(item.qrUrl || '').trim()) {
      failures.push(item.newAssetNo + ': QR URL 변경');
      return;
    }
    var sameBatch = String(current.lastPrintBatchId || '').trim() === String(snapshot.batchId || '').trim();
    if (!sameBatch && !labelPrintIssueStateMatchesFingerprint(current, item.issueStateFingerprint)) {
      failures.push(item.newAssetNo + ': 출력 이력 상태 변경');
    }
  });

  if (failures.length) {
    throw new Error('미리보기 생성 후 QR 또는 출력 상태가 변경되었습니다 — ' + failures.join(' / '));
  }
  return true;
}

function getLabelPrintPreviewModel(token) {
  var snapshot = loadLabelPrintPreviewSnapshot_(token);
  validateLabelPrintPreviewSnapshot_(snapshot);
  var sortedItems = sortLabelPrintItems(snapshot.items || []);
  var pages = paginateLabelPrintItems(sortedItems, snapshot.printSettings.pageSize);
  var renderedPages = pages.map(function (page) {
    return page.map(function (item, slotIndex) {
      if (!item) return null;
      var view = {};
      Object.keys(item).forEach(function (key) {
        if (key !== 'issueStateFingerprint') view[key] = item[key];
      });
      view.slot = calculateLabelSlotPosition(snapshot.printSettings, slotIndex);
      return view;
    });
  });
  return {
    token: snapshot.token,
    batchId: snapshot.batchId,
    environment: snapshot.environment,
    createdAt: snapshot.createdAt,
    itemCount: snapshot.itemCount,
    pageCount: renderedPages.length,
    printSettings: snapshot.printSettings,
    pages: renderedPages
  };
}

function createSelectedLabelPrintPreview() {
  var systemIds = getSelectedLabelPrintSystemIds();
  if (!systemIds.length) throw new Error('라벨출력 시트에서 출력할 비품을 선택하세요.');
  var snapshot = prepareLabelPrintPreview({ systemIds: systemIds });
  storeLabelPrintPreviewSnapshot_(snapshot);
  var serviceUrl = ScriptApp.getService().getUrl() || '';
  if (!serviceUrl) throw new Error('웹 앱 배포 URL을 확인할 수 없습니다.');
  return {
    token: snapshot.token,
    batchId: snapshot.batchId,
    itemCount: snapshot.itemCount,
    pageCount: snapshot.pageCount,
    url: serviceUrl + '?view=label-print&token=' + encodeURIComponent(snapshot.token)
  };
}
