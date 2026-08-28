var QR_BATCH_SHEET_NAME = 'QR대량발급배치';
var QR_BATCH_ITEM_SHEET_NAME = 'QR대량발급항목';
var QR_BATCH_OPEN_STATES = ['생성중', '준비', '진행중', '일시중단'];

function qrBatchFingerprint_(value) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function readQrBatchMasterAssets_(ss) {
  var sheet = getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.ASSET_MASTER);
  var headers = getHeaders_(sheet);
  var index = requireHeaders_(headers, [
    '영구 시스템 ID', 'New 비품번호', '품명', '사용여부', '물품상태', 'QR조회URL'
  ], sheet.getName());
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map(function (row, rowIndex) {
      return {
        rowNumber: rowIndex + 2,
        systemId: String(row[index['영구 시스템 ID']] || '').trim(),
        newAssetNo: String(row[index['New 비품번호']] || '').trim(),
        name: String(row[index['품명']] || '').trim(),
        usageStatus: String(row[index['사용여부']] || '').trim(),
        itemState: String(row[index['물품상태']] || '').trim(),
        qrLookupUrl: String(row[index['QR조회URL']] || '').trim()
      };
    })
    .filter(function (asset) {
      return !!asset.systemId || !!asset.newAssetNo || !!asset.name ||
        !!asset.usageStatus || !!asset.itemState;
    });
}

function buildCurrentQrBatchSnapshot_(ss) {
  var config = getRuntimeConfig_();
  var baseUrl = readRequiredLabelSetting_('상세조회배포URL');
  var masterAssets = readQrBatchMasterAssets_(ss);
  var issueRows = readAllQrIssueRows_(ss);
  var snapshot = buildQrBatchSnapshot(masterAssets, issueRows);

  snapshot.items.forEach(function (item) {
    if (item.snapshotQrState !== '재사용') return;
    if (!isValidQrAccessKey(item.snapshotAccessKey)) {
      throw new Error('사용 중인 QR 접근키 형식이 올바르지 않습니다: ' + item.systemId);
    }
    var expectedUrl = buildQrLookupUrl(baseUrl, item.snapshotAccessKey);
    if (item.snapshotLookupUrl && item.snapshotLookupUrl !== expectedUrl) {
      throw new Error('사용 중인 QR URL이 상세조회배포URL과 다릅니다: ' + item.systemId);
    }
  });

  return {
    environment: config.environment,
    baseUrl: baseUrl,
    snapshot: snapshot,
    issuanceContext: createQrIssuanceContext_(ss, masterAssets, issueRows),
    previewFingerprint: qrBatchFingerprint_(
      config.environment + '\n' + baseUrl + '\n' + buildQrBatchCanonical(snapshot)
    ),
    targetFingerprint: qrBatchFingerprint_(
      config.environment + '\n' + buildQrBatchTargetCanonical(snapshot)
    )
  };
}

function qrBatchSheet_(ss) {
  var sheet = getRequiredSheet_(ss, QR_BATCH_SHEET_NAME);
  requireHeaders_(getHeaders_(sheet), QR_BATCH_HEADERS, sheet.getName());
  return sheet;
}

function qrBatchItemSheet_(ss) {
  var sheet = getRequiredSheet_(ss, QR_BATCH_ITEM_SHEET_NAME);
  requireHeaders_(getHeaders_(sheet), QR_BATCH_ITEM_HEADERS, sheet.getName());
  return sheet;
}

function qrBatchValue_(index, row, header) {
  return index[header] === undefined ? '' : row[index[header]];
}

function qrBatchRowToObject_(headers, row, rowNumber) {
  var index = headerIndex_(headers);
  return {
    rowNumber: rowNumber,
    batchId: String(qrBatchValue_(index, row, '배치ID') || '').trim(),
    environment: String(qrBatchValue_(index, row, '환경') || '').trim(),
    fingerprint: String(qrBatchValue_(index, row, '대상지문') || '').trim(),
    status: String(qrBatchValue_(index, row, '상태') || '').trim(),
    batchSize: Number(qrBatchValue_(index, row, '배치크기') || QR_BATCH_MAX_SIZE),
    totalTarget: Number(qrBatchValue_(index, row, '전체대상') || 0),
    newIssueTarget: Number(qrBatchValue_(index, row, '신규발급대상') || 0),
    existingActive: Number(qrBatchValue_(index, row, '기존활성QR') || 0),
    succeeded: Number(qrBatchValue_(index, row, '성공') || 0),
    reused: Number(qrBatchValue_(index, row, '재사용') || 0),
    failed: Number(qrBatchValue_(index, row, '실패') || 0),
    pending: Number(qrBatchValue_(index, row, '미처리') || 0),
    nextProcessingOrder: qrBatchValue_(index, row, '다음처리순번') === ''
      ? null : Number(qrBatchValue_(index, row, '다음처리순번')),
    createdAt: qrBatchValue_(index, row, '생성일시') || '',
    lastRunAt: qrBatchValue_(index, row, '최종실행일시') || '',
    completedAt: qrBatchValue_(index, row, '완료일시') || '',
    createdBy: String(qrBatchValue_(index, row, '생성자') || '').trim(),
    memo: String(qrBatchValue_(index, row, '비고') || '').trim()
  };
}

function qrBatchItemRowToObject_(headers, row, rowNumber) {
  var index = headerIndex_(headers);
  return {
    rowNumber: rowNumber,
    batchId: String(qrBatchValue_(index, row, '배치ID') || '').trim(),
    processingOrder: Number(qrBatchValue_(index, row, '처리순번') || 0),
    systemId: String(qrBatchValue_(index, row, '영구 시스템 ID') || '').trim(),
    newAssetNo: String(qrBatchValue_(index, row, 'New 비품번호') || '').trim(),
    name: String(qrBatchValue_(index, row, '품명') || '').trim(),
    usageStatus: String(qrBatchValue_(index, row, '스냅샷사용여부') || '').trim(),
    snapshotQrState: String(qrBatchValue_(index, row, '스냅샷QR상태') || '').trim(),
    processingStatus: String(qrBatchValue_(index, row, '처리상태') || '').trim(),
    attempts: Number(qrBatchValue_(index, row, '시도횟수') || 0),
    accessKey: String(qrBatchValue_(index, row, 'QR접근키') || '').trim(),
    lookupUrl: String(qrBatchValue_(index, row, 'QR조회URL') || '').trim(),
    errorMessage: String(qrBatchValue_(index, row, '오류메시지') || '').trim(),
    lastAttemptAt: qrBatchValue_(index, row, '최종시도일시') || ''
  };
}

function buildQrBatchSheetRow_(headers, batch) {
  return buildRowForHeaders_(headers, {
    '배치ID': batch.batchId,
    '환경': batch.environment,
    '대상지문': batch.fingerprint,
    '상태': batch.status,
    '배치크기': Number(batch.batchSize || QR_BATCH_MAX_SIZE),
    '전체대상': Number(batch.totalTarget || 0),
    '신규발급대상': Number(batch.newIssueTarget || 0),
    '기존활성QR': Number(batch.existingActive || 0),
    '성공': Number(batch.succeeded || 0),
    '재사용': Number(batch.reused || 0),
    '실패': Number(batch.failed || 0),
    '미처리': Number(batch.pending || 0),
    '다음처리순번': batch.nextProcessingOrder === null ? '' : batch.nextProcessingOrder,
    '생성일시': batch.createdAt || '',
    '최종실행일시': batch.lastRunAt || '',
    '완료일시': batch.completedAt || '',
    '생성자': batch.createdBy || '',
    '비고': batch.memo || ''
  });
}

function buildQrBatchItemSheetRow_(headers, item) {
  return buildRowForHeaders_(headers, {
    '배치ID': item.batchId,
    '처리순번': Number(item.processingOrder || 0),
    '영구 시스템 ID': item.systemId,
    'New 비품번호': item.newAssetNo,
    '품명': item.name,
    '스냅샷사용여부': item.usageStatus,
    '스냅샷QR상태': item.snapshotQrState,
    '처리상태': item.processingStatus,
    '시도횟수': Number(item.attempts || 0),
    'QR접근키': item.accessKey || '',
    'QR조회URL': item.lookupUrl || '',
    '오류메시지': item.errorMessage || '',
    '최종시도일시': item.lastAttemptAt || ''
  });
}

function readAllQrBatches_(ss) {
  var sheet = qrBatchSheet_(ss);
  var headers = getHeaders_(sheet);
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map(function (row, index) { return qrBatchRowToObject_(headers, row, index + 2); })
    .filter(function (batch) { return !!batch.batchId; });
}

function readAllQrBatchItems_(ss) {
  var sheet = qrBatchItemSheet_(ss);
  var headers = getHeaders_(sheet);
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map(function (row, index) { return qrBatchItemRowToObject_(headers, row, index + 2); })
    .filter(function (item) { return !!item.batchId && !!item.systemId; });
}

function readQrBatchById_(ss, batchId) {
  var matches = readAllQrBatches_(ss).filter(function (batch) {
    return batch.batchId === String(batchId || '').trim();
  });
  if (!matches.length) throw new Error('QR 대량발급 배치를 찾을 수 없습니다: ' + batchId);
  if (matches.length > 1) throw new Error('QR 대량발급 배치 ID가 중복되었습니다: ' + batchId);
  return matches[0];
}

function readQrBatchItems_(ss, batchId) {
  return readAllQrBatchItems_(ss).filter(function (item) {
    return item.batchId === String(batchId || '').trim();
  }).sort(function (left, right) {
    return left.processingOrder - right.processingOrder;
  });
}

function ensureQrBatchRowCapacity_(sheet, requiredLastRow) {
  if (sheet.getMaxRows() >= requiredLastRow) return;
  sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows());
}

function appendQrBatch_(ss, batch) {
  var sheet = qrBatchSheet_(ss);
  var headers = getHeaders_(sheet);
  var rowNumber = sheet.getLastRow() + 1;
  ensureQrBatchRowCapacity_(sheet, rowNumber);
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([
    buildQrBatchSheetRow_(headers, batch)
  ]);
  batch.rowNumber = rowNumber;
  return batch;
}

function appendQrBatchItems_(ss, batchId, snapshotItems) {
  var sheet = qrBatchItemSheet_(ss);
  var headers = getHeaders_(sheet);
  var startRow = sheet.getLastRow() + 1;
  var items = (snapshotItems || []).map(function (source) {
    var item = Object.assign({}, source, { batchId: batchId });
    return item;
  });
  if (!items.length) return [];
  ensureQrBatchRowCapacity_(sheet, startRow + items.length - 1);
  sheet.getRange(startRow, 1, items.length, headers.length).setValues(
    items.map(function (item) { return buildQrBatchItemSheetRow_(headers, item); })
  );
  items.forEach(function (item, index) { item.rowNumber = startRow + index; });
  return items;
}

function updateQrBatch_(ss, batch) {
  if (!batch.rowNumber) throw new Error('수정할 QR 대량발급 배치 행이 없습니다.');
  var sheet = qrBatchSheet_(ss);
  var headers = getHeaders_(sheet);
  sheet.getRange(batch.rowNumber, 1, 1, headers.length).setValues([
    buildQrBatchSheetRow_(headers, batch)
  ]);
  return batch;
}

function updateQrBatchItems_(ss, items) {
  var rows = (items || []).slice().sort(function (left, right) {
    return left.rowNumber - right.rowNumber;
  });
  if (!rows.length) return;
  for (var index = 1; index < rows.length; index += 1) {
    if (rows[index].rowNumber !== rows[index - 1].rowNumber + 1) {
      throw new Error('QR 대량발급 항목 행이 연속되지 않아 체크포인트를 저장할 수 없습니다.');
    }
  }
  var sheet = qrBatchItemSheet_(ss);
  var headers = getHeaders_(sheet);
  sheet.getRange(rows[0].rowNumber, 1, rows.length, headers.length).setValues(
    rows.map(function (item) { return buildQrBatchItemSheetRow_(headers, item); })
  );
}

function applyQrBatchSummary_(batch, summary, now) {
  batch.succeeded = summary.succeeded;
  batch.reused = summary.reused;
  batch.failed = summary.failed;
  batch.pending = summary.pending;
  batch.nextProcessingOrder = summary.nextProcessingOrder;
  batch.status = summary.batchStatus;
  batch.lastRunAt = now || batch.lastRunAt;
  if (summary.batchStatus === '완료') batch.completedAt = now || new Date();
  return batch;
}

function validateCreatingQrBatch_(batch, current) {
  if (batch.environment !== current.environment) {
    throw new Error('생성 중 배치 환경과 현재 Apps Script 환경이 다릅니다.');
  }
  if (batch.fingerprint !== current.targetFingerprint) {
    throw new Error('생성 중 배치 대상 fingerprint가 현재 미리보기와 다릅니다. 배치를 취소한 뒤 다시 시도하세요.');
  }
  if (batch.totalTarget !== current.snapshot.summary.target) {
    throw new Error('생성 중 배치 전체대상 수가 현재 미리보기와 다릅니다.');
  }
}

function ensureCreatingQrBatchItems_(ss, batch, snapshotItems) {
  var expected = snapshotItems || [];
  var existing = readQrBatchItems_(ss, batch.batchId);
  if (existing.length > expected.length) {
    throw new Error('생성 중 배치 항목이 예상 대상보다 많습니다: ' + batch.batchId);
  }
  existing.forEach(function (item, index) {
    var source = expected[index];
    if (!source || item.processingOrder !== source.processingOrder ||
        item.systemId !== source.systemId || item.newAssetNo !== source.newAssetNo ||
        item.usageStatus !== source.usageStatus || item.snapshotQrState !== source.snapshotQrState) {
      throw new Error('생성 중 배치 항목이 현재 스냅샷과 다릅니다: ' + batch.batchId);
    }
  });
  if (existing.length < expected.length) {
    appendQrBatchItems_(ss, batch.batchId, expected.slice(existing.length));
    SpreadsheetApp.flush();
  }
  return readQrBatchItems_(ss, batch.batchId);
}

function qrBatchCreator_(request) {
  var requested = String(request && request.actor || '').trim();
  if (requested) return requested;
  try {
    var email = String(Session.getActiveUser().getEmail() || '').trim();
    return email || '미기재';
  } catch (error) {
    return '미기재';
  }
}

function previewBulkQrIssuance() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSpreadsheet_();
    qrBatchSheet_(ss);
    qrBatchItemSheet_(ss);
    var current = buildCurrentQrBatchSnapshot_(ss);
    return {
      dryRun: true,
      environment: current.environment,
      fingerprint: current.previewFingerprint,
      targetFingerprint: current.targetFingerprint,
      batchSize: QR_BATCH_MAX_SIZE,
      summary: current.snapshot.summary,
      excluded: current.snapshot.excluded.map(function (item) {
        return {
          systemId: item.systemId,
          newAssetNo: item.newAssetNo,
          name: item.name,
          usageStatus: item.usageStatus,
          itemState: item.itemState
        };
      })
    };
  } finally {
    lock.releaseLock();
  }
}

function createBulkQrIssuanceBatch(request) {
  request = request || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSpreadsheet_();
    var current = buildCurrentQrBatchSnapshot_(ss);
    var expectedFingerprint = String(request.expectedFingerprint || '').trim();
    if (!expectedFingerprint || expectedFingerprint !== current.previewFingerprint) {
      throw new Error('미리보기 fingerprint가 현재 대상 상태와 다릅니다. DRY RUN을 다시 실행하세요.');
    }

    var batches = readAllQrBatches_(ss);
    var open = batches.filter(function (batch) {
      return QR_BATCH_OPEN_STATES.indexOf(batch.status) >= 0;
    });
    var creating = open.filter(function (batch) { return batch.status === '생성중'; });
    if (creating.length > 1 || open.length > creating.length) {
      throw new Error('완료되지 않은 QR 대량발급 배치가 있습니다: ' + open[0].batchId);
    }

    var batch;
    var summary = current.snapshot.summary;
    if (creating.length) {
      batch = creating[0];
      validateCreatingQrBatch_(batch, current);
    } else {
      var allIds = batches.map(function (existingBatch) { return existingBatch.batchId; })
        .concat(readAllQrBatchItems_(ss).map(function (item) { return item.batchId; }));
      var now = new Date();
      var dateKey = Utilities.formatDate(now, 'Asia/Seoul', 'yyyyMMdd');
      var batchId = nextQrBatchId(allIds, dateKey);
      batch = {
        batchId: batchId,
        environment: current.environment,
        fingerprint: current.targetFingerprint,
        status: '생성중',
        batchSize: QR_BATCH_MAX_SIZE,
        totalTarget: summary.target,
        newIssueTarget: summary.needsIssue,
        existingActive: summary.reuse,
        succeeded: 0,
        reused: 0,
        failed: 0,
        pending: summary.target,
        nextProcessingOrder: summary.target ? 1 : null,
        createdAt: now,
        lastRunAt: '',
        completedAt: '',
        createdBy: qrBatchCreator_(request),
        memo: 'DRY RUN fingerprint: ' + current.previewFingerprint
      };
      appendQrBatch_(ss, batch);
      SpreadsheetApp.flush();
    }

    var persistedItems = ensureCreatingQrBatchItems_(ss, batch, current.snapshot.items);
    if (persistedItems.length !== batch.totalTarget) {
      throw new Error('생성 중 배치 항목 수가 전체대상과 다릅니다: ' + batch.batchId);
    }
    batch.status = batch.totalTarget ? '준비' : '완료';
    if (!batch.totalTarget) batch.completedAt = new Date();
    updateQrBatch_(ss, batch);
    SpreadsheetApp.flush();
    return getBulkQrIssuanceStatus_(ss, batch.batchId);
  } finally {
    lock.releaseLock();
  }
}

function processBulkQrIssuanceBatch(request) {
  request = request || {};
  assertText_(request.batchId, '배치ID');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSpreadsheet_();
    var batch = readQrBatchById_(ss, request.batchId);
    var config = getRuntimeConfig_();
    if (batch.environment !== config.environment) {
      throw new Error('배치 환경과 현재 Apps Script 환경이 다릅니다.');
    }
    if (batch.status === '완료') return getBulkQrIssuanceStatus_(ss, batch.batchId);
    if (batch.status === '취소') throw new Error('취소된 QR 대량발급 배치는 처리할 수 없습니다.');
    if (batch.status === '생성중') throw new Error('생성 중인 QR 대량발급 배치는 먼저 생성을 재개해야 합니다.');
    var items = readQrBatchItems_(ss, batch.batchId);
    if (items.length !== batch.totalTarget) {
      throw new Error('QR 대량발급 항목 수가 배치 전체대상과 다릅니다.');
    }

    var current = buildCurrentQrBatchSnapshot_(ss);
    if (current.targetFingerprint !== batch.fingerprint) {
      throw new Error('배치 대상 fingerprint가 현재 비품마스터와 다릅니다. 새 미리보기가 필요합니다.');
    }
    var itemFingerprint = qrBatchFingerprint_(
      batch.environment + '\n' + buildQrBatchTargetCanonical({ items: items })
    );
    if (itemFingerprint !== batch.fingerprint) {
      throw new Error('저장된 QR 대량발급 항목 fingerprint가 배치와 다릅니다.');
    }

    var selected = selectQrBatchItems(items, QR_BATCH_MAX_SIZE);
    if (!selected.length) {
      applyQrBatchSummary_(batch, summarizeQrBatchItems(items), new Date());
      updateQrBatch_(ss, batch);
      SpreadsheetApp.flush();
      return getBulkQrIssuanceStatus_(ss, batch.batchId);
    }

    var now = new Date();
    batch.status = '진행중';
    batch.lastRunAt = now;
    updateQrBatch_(ss, batch);
    SpreadsheetApp.flush();

    var systemIds = selected.map(function (item) { return item.systemId; });
    var baseUrl = current.baseUrl;
    var issueResult = issueQrAccessKeysUnlocked_(ss, systemIds, baseUrl, current.issuanceContext);
    var updatedItems = applyQrBatchResults(items, issueResult.results, now);
    updateQrBatchItems_(ss, updatedItems);
    applyQrBatchSummary_(batch, summarizeQrBatchItems(updatedItems), now);
    updateQrBatch_(ss, batch);
    SpreadsheetApp.flush();

    var status = getBulkQrIssuanceStatus_(ss, batch.batchId);
    status.processedThisRun = selected.length;
    status.runResults = issueResult.results;
    return status;
  } finally {
    lock.releaseLock();
  }
}

function cancelBulkQrIssuanceBatch(request) {
  request = request || {};
  assertText_(request.batchId, '배치ID');
  assertText_(request.reason, '취소 사유');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSpreadsheet_();
    var batch = readQrBatchById_(ss, request.batchId);
    var config = getRuntimeConfig_();
    if (batch.environment !== config.environment) {
      throw new Error('배치 환경과 현재 Apps Script 환경이 다릅니다.');
    }
    if (QR_BATCH_OPEN_STATES.indexOf(batch.status) < 0) {
      throw new Error('진행 중인 QR 대량발급 배치만 취소할 수 있습니다.');
    }
    var now = new Date();
    batch.status = '취소';
    batch.lastRunAt = now;
    batch.completedAt = now;
    batch.memo = String(batch.memo || '') + '\n취소 사유: ' + String(request.reason).trim();
    updateQrBatch_(ss, batch);
    SpreadsheetApp.flush();
    return getBulkQrIssuanceStatus_(ss, batch.batchId);
  } finally {
    lock.releaseLock();
  }
}

function retryFailedBulkQrIssuance(request) {
  request = request || {};
  assertText_(request.batchId, '배치ID');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSpreadsheet_();
    var batch = readQrBatchById_(ss, request.batchId);
    if (batch.status === '완료') throw new Error('완료된 QR 대량발급 배치는 재시도할 수 없습니다.');
    if (batch.status === '취소') throw new Error('취소된 QR 대량발급 배치는 재시도할 수 없습니다.');
    if (batch.status === '생성중') throw new Error('생성 중인 QR 대량발급 배치는 먼저 생성을 재개해야 합니다.');
    var items = readQrBatchItems_(ss, batch.batchId);
    var failedBefore = items.filter(function (item) { return item.processingStatus === '실패'; }).length;
    if (!failedBefore) return getBulkQrIssuanceStatus_(ss, batch.batchId);

    var reset = resetFailedQrBatchItems(items);
    updateQrBatchItems_(ss, reset);
    var summary = summarizeQrBatchItems(reset);
    applyQrBatchSummary_(batch, summary, new Date());
    batch.completedAt = '';
    updateQrBatch_(ss, batch);
    SpreadsheetApp.flush();

    var status = getBulkQrIssuanceStatus_(ss, batch.batchId);
    status.resetFailed = failedBefore;
    return status;
  } finally {
    lock.releaseLock();
  }
}

function getBulkQrIssuanceStatus_(ss, batchId) {
  var batch = readQrBatchById_(ss, batchId);
  var items = readQrBatchItems_(ss, batchId);
  var liveSummary = summarizeQrBatchItems(items);
  return {
    batchId: batch.batchId,
    environment: batch.environment,
    status: batch.status,
    fingerprint: batch.fingerprint,
    batchSize: batch.batchSize,
    totalTarget: batch.totalTarget,
    newIssueTarget: batch.newIssueTarget,
    existingActive: batch.existingActive,
    succeeded: liveSummary.succeeded,
    reused: liveSummary.reused,
    failed: liveSummary.failed,
    pending: liveSummary.pending,
    processed: liveSummary.processed,
    nextProcessingOrder: liveSummary.nextProcessingOrder,
    createdAt: batch.createdAt,
    lastRunAt: batch.lastRunAt,
    completedAt: batch.completedAt,
    createdBy: batch.createdBy,
    failedItems: items.filter(function (item) { return item.processingStatus === '실패'; })
      .map(function (item) {
        return {
          processingOrder: item.processingOrder,
          systemId: item.systemId,
          newAssetNo: item.newAssetNo,
          name: item.name,
          attempts: item.attempts,
          error: item.errorMessage
        };
      })
  };
}

function getBulkQrIssuanceStatus(batchId) {
  assertText_(batchId, '배치ID');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return getBulkQrIssuanceStatus_(getSpreadsheet_(), batchId);
  } finally {
    lock.releaseLock();
  }
}

function qrBatchPreviewCacheKey_() {
  return 'ASSET_QR_BATCH_PREVIEW_' + getRuntimeConfig_().environment;
}

function stageBulkQrIssuancePreview() {
  var preview = previewBulkQrIssuance();
  var cache = CacheService.getUserCache();
  cache.put(qrBatchPreviewCacheKey_(), preview.fingerprint, 600);
  preview.stagedForSeconds = 600;
  return preview;
}

function createBulkQrIssuanceBatchFromStagedPreview() {
  var cache = CacheService.getUserCache();
  var cacheKey = qrBatchPreviewCacheKey_();
  var fingerprint = String(cache.get(cacheKey) || '').trim();
  if (!fingerprint) {
    throw new Error('저장된 미리보기가 없거나 10분이 지났습니다. 미리보기를 다시 실행하세요.');
  }
  var result = createBulkQrIssuanceBatch({
    expectedFingerprint: fingerprint
  });
  cache.remove(cacheKey);
  return result;
}

function readSingleOpenQrBatchId_() {
  var batches = readAllQrBatches_(getSpreadsheet_()).filter(function (batch) {
    return QR_BATCH_OPEN_STATES.indexOf(batch.status) >= 0;
  });
  if (!batches.length) throw new Error('진행 중인 QR 대량발급 배치가 없습니다.');
  if (batches.length > 1) throw new Error('완료되지 않은 QR 대량발급 배치가 둘 이상입니다. 점검이 필요합니다.');
  return batches[0].batchId;
}

function processOpenBulkQrIssuanceBatch() {
  var batchId = readSingleOpenQrBatchId_();
  return processBulkQrIssuanceBatch({ batchId: batchId });
}

function retryFailedOpenBulkQrIssuance() {
  var batchId = readSingleOpenQrBatchId_();
  return retryFailedBulkQrIssuance({ batchId: batchId });
}

function cancelOpenBulkQrIssuanceBatch() {
  var batchId = readSingleOpenQrBatchId_();
  return cancelBulkQrIssuanceBatch({
    batchId: batchId,
    reason: 'Apps Script 편집기에서 사용자 취소'
  });
}

function getOpenBulkQrIssuanceStatus() {
  return getBulkQrIssuanceStatus(readSingleOpenQrBatchId_());
}
