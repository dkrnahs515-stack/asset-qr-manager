function qrAdminUniqueStrings_(values) {
  var seen = {};
  return (values || []).map(function (value) { return String(value || '').trim(); })
    .filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
}

function readRequiredLabelSetting_(settingName) {
  var ss = getSpreadsheet_();
  var sheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.LABEL_SETTINGS);
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['설정항목', '설정값'], sheet.getName());
  if (sheet.getLastRow() <= 1) throw new Error('라벨설정 값이 없습니다: ' + settingName);

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][index['설정항목']] || '').trim() !== settingName) continue;
    var value = String(values[i][index['설정값']] || '').trim();
    if (!value) throw new Error('라벨설정 값이 비어 있습니다: ' + settingName);
    return value;
  }
  throw new Error('라벨설정 항목을 찾을 수 없습니다: ' + settingName);
}

function qrIssueRowToObject_(headers, row, rowNumber) {
  var index = headerIndex_(headers);
  function value(header) {
    return index[header] === undefined ? '' : row[index[header]];
  }
  return {
    rowNumber: rowNumber || 0,
    systemId: String(value('영구 시스템 ID') || '').trim(),
    accessKey: String(value('QR접근키') || '').trim(),
    accessKeyStatus: String(value('QR접근키상태') || '').trim(),
    lookupUrl: String(value('QR조회URL') || '').trim(),
    issueStatus: String(value('QR발급상태') || '').trim(),
    labelType: String(value('라벨유형') || '').trim(),
    labelVersion: String(value('라벨버전') || '').trim(),
    printedPrimaryManager: String(value('인쇄책임자 정') || '').trim(),
    printedSecondaryManager: String(value('인쇄책임자 부') || '').trim(),
    managerVersion: String(value('책임자버전') || '').trim(),
    labelInspectionDate: value('라벨기준조사일') || '',
    firstIssuedAt: value('최초발급일시') || '',
    lastPrintedAt: value('최종출력일시') || '',
    reprintRequired: String(value('재출력필요여부') || '').trim(),
    reprintReason: String(value('재출력사유') || '').trim(),
    reprintCount: Number(value('재출력횟수') || 0),
    lastPrintBatchId: String(value('최종출력배치ID') || '').trim(),
    memo: String(value('비고') || '').trim()
  };
}

function buildQrIssueSheetRow_(headers, issue) {
  return buildRowForHeaders_(headers, {
    '영구 시스템 ID': issue.systemId,
    'QR접근키': issue.accessKey,
    'QR접근키상태': issue.accessKeyStatus,
    'QR조회URL': issue.lookupUrl,
    'QR발급상태': issue.issueStatus,
    '라벨유형': issue.labelType,
    '라벨버전': issue.labelVersion,
    '인쇄책임자 정': issue.printedPrimaryManager,
    '인쇄책임자 부': issue.printedSecondaryManager,
    '책임자버전': issue.managerVersion,
    '라벨기준조사일': issue.labelInspectionDate,
    '최초발급일시': issue.firstIssuedAt,
    '최종출력일시': issue.lastPrintedAt,
    '재출력필요여부': issue.reprintRequired,
    '재출력사유': issue.reprintReason,
    '재출력횟수': Number(issue.reprintCount || 0),
    '최종출력배치ID': issue.lastPrintBatchId,
    '비고': issue.memo
  });
}

function readAllQrIssueRows_(ss) {
  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.QR_ISSUE);
  var headers = getHeaders_(sheet);
  requireHeaders_(headers, QR_ISSUE_HEADERS, sheet.getName());
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map(function (row, index) { return qrIssueRowToObject_(headers, row, index + 2); })
    .filter(function (issue) { return !!issue.systemId || !!issue.accessKey; });
}

function appendQrIssue_(ss, issue) {
  var sheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.QR_ISSUE);
  var headers = getHeaders_(sheet);
  requireHeaders_(headers, QR_ISSUE_HEADERS, sheet.getName());
  var rowNumber = sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([
    buildQrIssueSheetRow_(headers, issue)
  ]);
  issue.rowNumber = rowNumber;
  return issue;
}

function updateQrIssue_(ss, issue) {
  if (!issue || !issue.rowNumber) throw new Error('수정할 QR 발급 행을 찾을 수 없습니다.');
  var sheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.QR_ISSUE);
  var headers = getHeaders_(sheet);
  requireHeaders_(headers, QR_ISSUE_HEADERS, sheet.getName());
  sheet.getRange(issue.rowNumber, 1, 1, headers.length).setValues([
    buildQrIssueSheetRow_(headers, issue)
  ]);
  return issue;
}

function readQrAdminMasterAssets_(ss) {
  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.ASSET_MASTER);
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['영구 시스템 ID', 'New 비품번호', '품명', 'QR조회URL'], sheet.getName());
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map(function (row, rowIndex) {
      return {
        rowNumber: rowIndex + 2,
        systemId: String(row[index['영구 시스템 ID']] || '').trim(),
        newAssetNo: String(row[index['New 비품번호']] || '').trim(),
        name: String(row[index['품명']] || '').trim(),
        qrLookupUrl: String(row[index['QR조회URL']] || '').trim()
      };
    })
    .filter(function (asset) { return !!asset.systemId; });
}

function readQrAdminMasterAssetById_(ss, systemId) {
  var sheet = getRequiredSheet_(ss || getSpreadsheet_(), INVENTORY_CONFIG.SHEETS.ASSET_MASTER);
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['영구 시스템 ID', 'New 비품번호', '품명', 'QR조회URL'], sheet.getName());
  if (sheet.getLastRow() <= 1) return null;
  var cell = sheet.getRange(2, index['영구 시스템 ID'] + 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(systemId)).matchEntireCell(true).findNext();
  if (!cell) return null;
  var row = sheet.getRange(cell.getRow(), 1, 1, headers.length).getValues()[0];
  return {
    rowNumber: cell.getRow(),
    systemId: String(row[index['영구 시스템 ID']] || '').trim(),
    newAssetNo: String(row[index['New 비품번호']] || '').trim(),
    name: String(row[index['품명']] || '').trim(),
    qrLookupUrl: String(row[index['QR조회URL']] || '').trim()
  };
}

function updateMasterQrUrl_(systemId, lookupUrl, ss) {
  var spreadsheet = ss || getSpreadsheet_();
  var sheet = getRequiredSheet_(spreadsheet, INVENTORY_CONFIG.SHEETS.ASSET_MASTER);
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['영구 시스템 ID', 'QR조회URL'], sheet.getName());
  var cell = sheet.getRange(2, index['영구 시스템 ID'] + 1, Math.max(0, sheet.getLastRow() - 1), 1)
    .createTextFinder(String(systemId)).matchEntireCell(true).findNext();
  if (!cell) throw new Error('비품마스터에서 비품을 찾을 수 없습니다: ' + systemId);
  sheet.getRange(cell.getRow(), index['QR조회URL'] + 1).setValue(String(lookupUrl || ''));
}

function generateQrAccessKey_() {
  var seed = Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + new Date().getTime();
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    seed,
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '').slice(0, 32);
}

function qrAccessKeyExists_(ss, accessKey) {
  var sheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.QR_ISSUE);
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, ['QR접근키'], sheet.getName());
  if (sheet.getLastRow() <= 1) return false;
  return !!sheet.getRange(2, index['QR접근키'] + 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(accessKey)).matchEntireCell(true).findNext();
}

function generateUniqueQrAccessKey_(ss) {
  for (var attempt = 0; attempt < 5; attempt += 1) {
    var key = generateQrAccessKey_();
    if (isValidQrAccessKey(key) && !qrAccessKeyExists_(ss, key)) return key;
  }
  throw new Error('중복되지 않는 QR 접근키를 생성하지 못했습니다. 다시 시도하세요.');
}

function createNewQrIssueRow_(ss, asset, baseUrl, options) {
  options = options || {};
  var accessKey = generateUniqueQrAccessKey_(ss);
  var lookupUrl = buildQrLookupUrl(baseUrl, accessKey);
  var issue = buildInitialQrIssueRecord(asset, accessKey, lookupUrl, new Date());
  if (options.issueStatus) issue.issueStatus = options.issueStatus;
  if (options.reprintReason) {
    issue.reprintRequired = 'Y';
    issue.reprintReason = String(options.reprintReason);
  }
  return appendQrIssue_(ss, issue);
}

function ensureActiveQrIssueForAsset_(ss, asset, baseUrl) {
  var allRows = readAllQrIssueRows_(ss);
  var active = findActiveQrIssue(allRows, asset.systemId);
  if (!active) {
    var created = createNewQrIssueRow_(ss, asset, baseUrl, {});
    created.reused = false;
    return created;
  }

  if (!isValidQrAccessKey(active.accessKey)) {
    throw new Error('사용 중인 QR 접근키 형식이 올바르지 않습니다: ' + asset.systemId);
  }
  var expectedUrl = buildQrLookupUrl(baseUrl, active.accessKey);
  if (active.lookupUrl && active.lookupUrl !== expectedUrl) {
    throw new Error('사용 중인 QR URL이 상세조회배포URL과 다릅니다: ' + asset.systemId);
  }
  if (!active.lookupUrl) {
    active.lookupUrl = expectedUrl;
    updateQrIssue_(ss, active);
  }
  active.reused = true;
  return active;
}

function issueQrAccessKeys(request) {
  request = request || {};
  var systemIds = qrAdminUniqueStrings_(request.systemIds || []);
  if (!systemIds.length) throw new Error('QR을 발급할 비품을 선택하세요.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var baseUrl = readRequiredLabelSetting_('상세조회배포URL');
    var ss = getSpreadsheet_();
    var results = systemIds.map(function (systemId) {
      try {
        var asset = readQrAdminMasterAssetById_(ss, systemId);
        if (!asset) return { systemId: systemId, ok: false, error: '비품마스터 누락' };
        var issue = ensureActiveQrIssueForAsset_(ss, asset, baseUrl);
        updateMasterQrUrl_(asset.systemId, issue.lookupUrl, ss);
        return {
          systemId: systemId,
          ok: true,
          accessKey: issue.accessKey,
          lookupUrl: issue.lookupUrl,
          reused: !!issue.reused
        };
      } catch (error) {
        return { systemId: systemId, ok: false, error: String(error && error.message || error) };
      }
    });
    return {
      requested: systemIds.length,
      succeeded: results.filter(function (result) { return result.ok; }).length,
      results: results
    };
  } finally {
    lock.releaseLock();
  }
}

function stopAndReissueQrAccessKey(request) {
  request = request || {};
  assertText_(request.systemId, '영구 시스템 ID');
  assertText_(request.reason, '재발급 사유');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSpreadsheet_();
    var baseUrl = readRequiredLabelSetting_('상세조회배포URL');
    var asset = readQrAdminMasterAssetById_(ss, request.systemId);
    if (!asset) throw new Error('비품마스터에서 비품을 찾을 수 없습니다: ' + request.systemId);

    var rows = readAllQrIssueRows_(ss);
    var activeRows = rows.filter(function (row) {
      return row.systemId === request.systemId && row.accessKeyStatus === '사용';
    });
    if (!activeRows.length) throw new Error('중지할 사용 중 QR 접근키가 없습니다: ' + request.systemId);
    if (activeRows.length > 1) throw new Error('사용 중 QR 접근키가 중복되었습니다: ' + request.systemId);

    activeRows.forEach(function (row) {
      row.accessKeyStatus = '중지';
      row.reprintRequired = 'Y';
      row.reprintReason = String(request.reason);
      updateQrIssue_(ss, row);
    });

    var issue = createNewQrIssueRow_(ss, asset, baseUrl, {
      issueStatus: '재발급필요',
      reprintReason: request.reason
    });
    updateMasterQrUrl_(asset.systemId, issue.lookupUrl, ss);
    return {
      systemId: issue.systemId,
      accessKey: issue.accessKey,
      lookupUrl: issue.lookupUrl,
      stoppedCount: activeRows.length,
      issueStatus: issue.issueStatus
    };
  } finally {
    lock.releaseLock();
  }
}

function auditQrIssues() {
  var ss = getSpreadsheet_();
  var issues = readAllQrIssueRows_(ss);
  var assets = readQrAdminMasterAssets_(ss);
  var masterById = {};
  assets.forEach(function (asset) { masterById[asset.systemId] = asset; });

  var activeRows = issues.filter(function (issue) { return issue.accessKeyStatus === '사용'; });
  var activeBySystem = {};
  var keyCounts = {};
  issues.forEach(function (issue) {
    if (issue.accessKey) keyCounts[issue.accessKey] = Number(keyCounts[issue.accessKey] || 0) + 1;
  });
  activeRows.forEach(function (issue) {
    if (!activeBySystem[issue.systemId]) activeBySystem[issue.systemId] = [];
    activeBySystem[issue.systemId].push(issue);
  });

  var duplicateActiveSystemIds = Object.keys(activeBySystem)
    .filter(function (systemId) { return activeBySystem[systemId].length > 1; }).sort();
  var duplicateKeys = Object.keys(keyCounts).filter(function (key) { return keyCounts[key] > 1; }).sort();
  var invalidKeyRows = issues.filter(function (issue) {
    return !!issue.accessKey && !isValidQrAccessKey(issue.accessKey);
  }).map(function (issue) { return issue.rowNumber; });
  var missingMasterIds = issues.filter(function (issue) {
    return !!issue.systemId && !masterById[issue.systemId];
  }).map(function (issue) { return issue.systemId; });
  var masterUrlMismatches = activeRows.filter(function (issue) {
    var master = masterById[issue.systemId];
    return !!master && master.qrLookupUrl !== issue.lookupUrl;
  }).map(function (issue) { return issue.systemId; });

  return {
    activeCount: activeRows.length,
    totalIssueRows: issues.length,
    duplicateActiveSystemIds: qrAdminUniqueStrings_(duplicateActiveSystemIds),
    duplicateKeys: duplicateKeys,
    invalidKeyRows: invalidKeyRows,
    missingMasterIds: qrAdminUniqueStrings_(missingMasterIds),
    masterUrlMismatches: qrAdminUniqueStrings_(masterUrlMismatches),
    ok: !duplicateActiveSystemIds.length && !duplicateKeys.length && !invalidKeyRows.length &&
      !missingMasterIds.length && !masterUrlMismatches.length
  };
}
