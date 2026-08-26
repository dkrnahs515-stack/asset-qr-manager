function readLabelSettingsMap_(sheet) {
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['설정항목', '설정값'], sheet.getName());
  var map = {};
  if (sheet.getLastRow() <= 1) return map;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().forEach(function (row) {
    var key = String(row[index['설정항목']] || '').trim();
    if (!key) return;
    map[key] = row[index['설정값']];
  });
  return map;
}

function readLabelPrintMasterAssets_(sheet) {
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, [
    '영구 시스템 ID', 'New 비품번호', '품명', '위치코드', '층', '공간명', '사용여부', 'QR조회URL'
  ], sheet.getName());
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map(function (row) {
      return {
        systemId: String(row[index['영구 시스템 ID']] || '').trim(),
        newAssetNo: String(row[index['New 비품번호']] || '').trim(),
        name: String(row[index['품명']] || '').trim(),
        locationCode: String(row[index['위치코드']] || '').trim(),
        floor: String(row[index['층']] || '').trim(),
        spaceName: String(row[index['공간명']] || '').trim(),
        usageStatus: String(row[index['사용여부']] || '').trim(),
        qrLookupUrl: String(row[index['QR조회URL']] || '').trim()
      };
    })
    .filter(function (asset) { return !!asset.systemId; });
}

function readLabelPrintLocationOrderMap_(sheet) {
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['위치코드', '층', '공간명', '모바일정렬순서'], sheet.getName());
  var result = { byCode: {}, byName: {} };
  if (sheet.getLastRow() <= 1) return result;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().forEach(function (row) {
    var code = String(row[index['위치코드']] || '').trim();
    var floor = String(row[index['층']] || '').trim();
    var spaceName = String(row[index['공간명']] || '').trim();
    var rawOrder = row[index['모바일정렬순서']];
    var order = rawOrder === '' || rawOrder === null ? null : Number(rawOrder);
    if (!Number.isFinite(order)) order = null;
    var entry = { locationCode: code, floor: floor, spaceName: spaceName, sortOrder: order };
    if (code) result.byCode[code] = entry;
    if (floor || spaceName) result.byName[floor + '\u0000' + spaceName] = entry;
  });
  return result;
}

function groupLabelPrintIssuesBySystemId_(rows) {
  var map = {};
  (rows || []).forEach(function (issue) {
    var systemId = String(issue.systemId || '').trim();
    if (!systemId) return;
    if (!map[systemId]) map[systemId] = [];
    map[systemId].push(issue);
  });
  return map;
}

function formatLabelInspectionDate_(value) {
  if (!value) return '미조사';
  var date = Object.prototype.toString.call(value) === '[object Date]' ? value : new Date(value);
  if (isNaN(date.getTime())) return '미조사';
  return Utilities.formatDate(date, 'Asia/Seoul', 'yyyy.MM.dd');
}

function resolveLabelPrintLocationOrder_(locationMap, locationCode, floor, spaceName) {
  var byCode = locationCode ? locationMap.byCode[locationCode] : null;
  if (byCode && byCode.sortOrder !== null) return byCode.sortOrder;
  var byName = locationMap.byName[String(floor || '') + '\u0000' + String(spaceName || '')];
  if (byName && byName.sortOrder !== null) return byName.sortOrder;
  return null;
}

function buildLabelPrintBrowseItem_(asset, currentState, issueRows, settings, locationMap) {
  var state = currentState || {};
  var currentFloor = String(state.currentFloor || asset.floor || '').trim();
  var currentSpaceName = String(state.currentSpaceName || asset.spaceName || '').trim();
  var currentLocationCode = String(state.currentLocationCode || asset.locationCode || '').trim();
  var currentResult = String(state.currentResult || '').trim();
  var inspectionDate = formatLabelInspectionDate_(state.latestJudgedAt || '');
  var validation = validateLabelPrintCandidate(asset, currentState, issueRows, settings);
  var activeRows = (issueRows || []).filter(function (issue) {
    return String(issue.accessKeyStatus || '').trim() === '사용';
  });
  var displayIssue = activeRows.length === 1 ? activeRows[0] : null;
  var qrState = activeRows.length > 1 ? '중복' : (displayIssue ? '사용' : ((issueRows || []).length ? '중지' : '없음'));
  var printType = displayIssue ? classifyLabelPrintType(displayIssue) : '';
  var locationSortOrder = resolveLabelPrintLocationOrder_(
    locationMap, currentLocationCode, currentFloor, currentSpaceName
  );

  return {
    selected: false,
    printType: printType,
    newAssetNo: asset.newAssetNo,
    name: asset.name,
    currentFloor: currentFloor,
    currentSpaceName: currentSpaceName,
    currentResult: currentResult,
    qrState: qrState,
    issueStatus: displayIssue ? String(displayIssue.issueStatus || '') : '',
    reprintRequired: displayIssue ? String(displayIssue.reprintRequired || 'N') : 'N',
    inspectionDate: inspectionDate,
    printability: validation.ok ? '출력가능' : validation.reason,
    systemId: asset.systemId,
    qrLookupUrl: displayIssue ? String(displayIssue.lookupUrl || '') : '',
    locationSortOrder: locationSortOrder,
    validation: validation
  };
}

function labelPrintBrowseItemToRow_(item) {
  return [
    false,
    item.printType,
    item.newAssetNo,
    item.name,
    item.currentFloor,
    item.currentSpaceName,
    item.currentResult,
    item.qrState,
    item.issueStatus,
    item.reprintRequired,
    item.inspectionDate,
    item.printability,
    item.systemId,
    item.qrLookupUrl,
    item.locationSortOrder === null ? '' : item.locationSortOrder
  ];
}

function ensureLabelPrintSheetExists_(ss) {
  var sheet = ss.getSheetByName(INVENTORY_CONFIG.SHEETS.LABEL_PRINT);
  if (sheet) return sheet;
  var report = { createdSheets: [], addedHeaders: {}, seededSettings: [] };
  return ensureLabelPrintWorkSheet_(ss, report);
}

function refreshLabelPrintSheet() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSpreadsheet_();
    var masterSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.ASSET_MASTER);
    var currentStateSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.CURRENT_STATE);
    var qrIssueSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.QR_ISSUE);
    var locationSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.LOCATION_MASTER);
    var labelSettingsSheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.LABEL_SETTINGS);
    var workSheet = ensureLabelPrintSheetExists_(ss);

    // Resolve every source explicitly here so the refresh boundary remains easy to audit.
    if (!masterSheet || !currentStateSheet || !qrIssueSheet || !locationSheet || !labelSettingsSheet) {
      throw new Error('라벨출력 원장 시트를 모두 읽을 수 없습니다.');
    }

    var settingsMap = readLabelSettingsMap_(labelSettingsSheet);
    var settings = normalizeLabelPrintSettings(settingsMap);
    var currentStateMap = readCurrentStateMap_(ss);
    var issueMap = groupLabelPrintIssuesBySystemId_(readAllQrIssueRows_(ss));
    var locationMap = readLabelPrintLocationOrderMap_(locationSheet);

    var items = readLabelPrintMasterAssets_(masterSheet)
      .filter(function (asset) { return asset.usageStatus === '사용'; })
      .map(function (asset) {
        return buildLabelPrintBrowseItem_(
          asset,
          currentStateMap[asset.systemId] || null,
          issueMap[asset.systemId] || [],
          settings,
          locationMap
        );
      });

    items = sortLabelPrintItems(items);

    var dataStartRow = 5;
    var maxDataRows = Math.max(0, workSheet.getMaxRows() - dataStartRow + 1);
    if (maxDataRows) {
      workSheet.getRange(dataStartRow, 1, maxDataRows, LABEL_PRINT_HEADERS.length)
        .clearContent()
        .clearDataValidations();
    }
    workSheet.getRange(4, 1, 1, LABEL_PRINT_HEADERS.length).setValues([LABEL_PRINT_HEADERS]);

    if (items.length) {
      if (workSheet.getMaxRows() < dataStartRow + items.length - 1) {
        workSheet.insertRowsAfter(
          workSheet.getMaxRows(),
          dataStartRow + items.length - 1 - workSheet.getMaxRows()
        );
      }
      var rows = items.map(labelPrintBrowseItemToRow_);
      workSheet.getRange(dataStartRow, 1, rows.length, LABEL_PRINT_HEADERS.length).setValues(rows);
      var checkbox = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build();
      var validations = items.map(function (item) {
        var validation = item.validation;
        return [validation.ok ? checkbox : null];
      });
      workSheet.getRange(dataStartRow, 1, validations.length, 1).setDataValidations(validations);
    }

    var printable = items.filter(function (item) { return item.validation.ok; }).length;
    workSheet.getRange(2, 1).setValue(
      '전체 ' + items.length + ' · 출력가능 ' + printable + ' · 선택 0 · 예상 0페이지'
    );
    workSheet.getRange(3, 1).setValue(
      '출력 순서: 층 → 공간 → 비품번호 · Formtec LS3106 · 실제 크기 100%'
    );
    SpreadsheetApp.flush();

    return {
      total: items.length,
      printable: printable,
      selected: 0,
      estimatedPages: 0,
      refreshedAt: new Date().toISOString()
    };
  } finally {
    lock.releaseLock();
  }
}

function getLabelPrintSheetStatus() {
  var ss = getSpreadsheet_();
  var sheet = ensureLabelPrintSheetExists_(ss);
  if (sheet.getLastRow() < 5) {
    return { total: 0, printable: 0, selected: 0, estimatedPages: 0 };
  }
  var rowCount = sheet.getLastRow() - 4;
  var values = sheet.getRange(5, 1, rowCount, LABEL_PRINT_HEADERS.length).getValues();
  var total = 0;
  var printable = 0;
  var selected = 0;
  values.forEach(function (row) {
    var systemId = String(row[12] || '').trim();
    if (!systemId) return;
    total += 1;
    if (String(row[11] || '') === '출력가능') printable += 1;
    if (row[0] === true) selected += 1;
  });
  return {
    total: total,
    printable: printable,
    selected: selected,
    estimatedPages: selected ? Math.ceil(selected / 24) : 0
  };
}
