'use strict';

var QR_BATCH_MAX_SIZE = 50;

function qrBatchText_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function buildQrBatchSnapshot(masterAssets, issueRows) {
  var masters = (masterAssets || []).slice().sort(function (left, right) {
    return Number(left.rowNumber || 0) - Number(right.rowNumber || 0);
  });
  var missingSystemIdRows = masters.filter(function (asset) {
    return !qrBatchText_(asset.systemId);
  }).map(function (asset) { return Number(asset.rowNumber || 0); });
  if (missingSystemIdRows.length) {
    throw new Error('비품마스터 영구 시스템 ID가 비어 있습니다: 행 ' + missingSystemIdRows.join(', '));
  }
  var missingAssetNumberIds = masters.filter(function (asset) {
    return qrBatchText_(asset.usageStatus) === '사용' && !qrBatchText_(asset.newAssetNo);
  }).map(function (asset) { return qrBatchText_(asset.systemId); });
  if (missingAssetNumberIds.length) {
    throw new Error('사용 비품의 New 비품번호가 비어 있습니다: ' + missingAssetNumberIds.join(', '));
  }
  var masterCounts = {};
  masters.forEach(function (asset) {
    var systemId = qrBatchText_(asset.systemId);
    if (!systemId) return;
    masterCounts[systemId] = Number(masterCounts[systemId] || 0) + 1;
  });
  var duplicateMasterIds = Object.keys(masterCounts).filter(function (systemId) {
    return masterCounts[systemId] > 1;
  });
  if (duplicateMasterIds.length) {
    throw new Error('비품마스터 영구 시스템 ID가 중복되었습니다: ' + duplicateMasterIds.sort().join(', '));
  }

  var activeBySystemId = {};
  var activeKeyOwners = {};
  (issueRows || []).forEach(function (issue) {
    if (qrBatchText_(issue.accessKeyStatus) !== '사용') return;
    var systemId = qrBatchText_(issue.systemId);
    if (!systemId) throw new Error('활성 QR의 영구 시스템 ID가 비어 있습니다.');
    if (!activeBySystemId[systemId]) activeBySystemId[systemId] = [];
    activeBySystemId[systemId].push(issue);
    var accessKey = qrBatchText_(issue.accessKey);
    if (accessKey) {
      if (!activeKeyOwners[accessKey]) activeKeyOwners[accessKey] = [];
      activeKeyOwners[accessKey].push(systemId);
    }
  });
  var duplicateActiveIds = Object.keys(activeBySystemId).filter(function (systemId) {
    return activeBySystemId[systemId].length > 1;
  });
  if (duplicateActiveIds.length) {
    throw new Error('활성 QR 영구 시스템 ID가 중복되었습니다: ' + duplicateActiveIds.sort().join(', '));
  }
  var duplicateActiveKeys = Object.keys(activeKeyOwners).filter(function (accessKey) {
    return activeKeyOwners[accessKey].length > 1;
  });
  if (duplicateActiveKeys.length) {
    throw new Error('활성 QR 접근키가 중복되었습니다: ' + duplicateActiveKeys.sort().join(', '));
  }
  var orphanActiveIds = Object.keys(activeBySystemId).filter(function (systemId) {
    return !masterCounts[systemId];
  });
  if (orphanActiveIds.length) {
    throw new Error('비품마스터에 없는 활성 QR이 있습니다: ' + orphanActiveIds.sort().join(', '));
  }

  var excluded = [];
  var items = [];
  masters.forEach(function (asset) {
    var systemId = qrBatchText_(asset.systemId);
    if (!systemId) return;
    var normalized = {
      rowNumber: Number(asset.rowNumber || 0),
      systemId: systemId,
      newAssetNo: qrBatchText_(asset.newAssetNo),
      name: qrBatchText_(asset.name),
      usageStatus: qrBatchText_(asset.usageStatus),
      itemState: qrBatchText_(asset.itemState)
    };
    if (normalized.usageStatus !== '사용') {
      excluded.push(normalized);
      return;
    }
    var active = (activeBySystemId[systemId] || [])[0] || null;
    items.push({
      processingOrder: items.length + 1,
      rowNumber: normalized.rowNumber,
      systemId: normalized.systemId,
      newAssetNo: normalized.newAssetNo,
      name: normalized.name,
      usageStatus: normalized.usageStatus,
      snapshotQrState: active ? '재사용' : '신규발급',
      snapshotAccessKey: active ? qrBatchText_(active.accessKey) : '',
      snapshotLookupUrl: active ? qrBatchText_(active.lookupUrl) : '',
      processingStatus: '대기',
      attempts: 0,
      accessKey: '',
      lookupUrl: '',
      errorMessage: '',
      lastAttemptAt: ''
    });
  });

  var reuse = items.filter(function (item) { return item.snapshotQrState === '재사용'; }).length;
  return {
    items: items,
    excluded: excluded,
    summary: {
      registered: masters.filter(function (asset) { return !!qrBatchText_(asset.systemId); }).length,
      target: items.length,
      excluded: excluded.length,
      reuse: reuse,
      needsIssue: items.length - reuse
    }
  };
}

function buildQrBatchCanonical(snapshot) {
  return (snapshot && snapshot.items || []).map(function (item) {
    return [
      qrBatchText_(item.systemId),
      qrBatchText_(item.newAssetNo),
      qrBatchText_(item.usageStatus),
      qrBatchText_(item.snapshotQrState),
      qrBatchText_(item.snapshotAccessKey),
      qrBatchText_(item.snapshotLookupUrl)
    ].join('\u001f');
  }).join('\u001e');
}

function buildQrBatchTargetCanonical(snapshot) {
  return (snapshot && snapshot.items || []).map(function (item) {
    return [
      qrBatchText_(item.systemId),
      qrBatchText_(item.newAssetNo),
      qrBatchText_(item.usageStatus)
    ].join('\u001f');
  }).join('\u001e');
}

function selectQrBatchItems(items, requestedSize) {
  var parsed = Math.floor(Number(requestedSize || QR_BATCH_MAX_SIZE));
  var size = Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, QR_BATCH_MAX_SIZE)
    : QR_BATCH_MAX_SIZE;
  return (items || []).filter(function (item) {
    return qrBatchText_(item.processingStatus) === '대기';
  }).sort(function (left, right) {
    return Number(left.processingOrder || 0) - Number(right.processingOrder || 0);
  }).slice(0, size);
}

function applyQrBatchResults(items, results, attemptedAt) {
  var resultBySystemId = {};
  (results || []).forEach(function (result) {
    var systemId = qrBatchText_(result.systemId);
    if (systemId) resultBySystemId[systemId] = result;
  });
  return (items || []).map(function (item) {
    var copy = Object.assign({}, item);
    var result = resultBySystemId[qrBatchText_(item.systemId)];
    if (!result) return copy;
    copy.attempts = Number(copy.attempts || 0) + 1;
    copy.lastAttemptAt = attemptedAt || '';
    copy.accessKey = qrBatchText_(result.accessKey);
    copy.lookupUrl = qrBatchText_(result.lookupUrl);
    if (!result.ok) {
      copy.processingStatus = '실패';
      copy.errorMessage = qrBatchText_(result.error) || '알 수 없는 오류';
      return copy;
    }
    copy.processingStatus = result.reused ? '재사용' : '성공';
    copy.errorMessage = '';
    return copy;
  });
}

function resetFailedQrBatchItems(items) {
  return (items || []).map(function (item) {
    var copy = Object.assign({}, item);
    if (qrBatchText_(copy.processingStatus) === '실패') {
      copy.processingStatus = '대기';
      copy.accessKey = '';
      copy.lookupUrl = '';
      copy.errorMessage = '';
      copy.lastAttemptAt = '';
    }
    return copy;
  });
}

function summarizeQrBatchItems(items) {
  var rows = items || [];
  var succeeded = rows.filter(function (item) { return qrBatchText_(item.processingStatus) === '성공'; }).length;
  var reused = rows.filter(function (item) { return qrBatchText_(item.processingStatus) === '재사용'; }).length;
  var failed = rows.filter(function (item) { return qrBatchText_(item.processingStatus) === '실패'; }).length;
  var pendingRows = rows.filter(function (item) { return qrBatchText_(item.processingStatus) === '대기'; })
    .sort(function (left, right) {
      return Number(left.processingOrder || 0) - Number(right.processingOrder || 0);
    });
  return {
    total: rows.length,
    succeeded: succeeded,
    reused: reused,
    failed: failed,
    pending: pendingRows.length,
    processed: succeeded + reused + failed,
    nextProcessingOrder: pendingRows.length ? Number(pendingRows[0].processingOrder || 0) : null,
    batchStatus: failed ? '일시중단' : (pendingRows.length ? '진행중' : '완료')
  };
}

function nextQrBatchId(existingIds, dateKey) {
  var normalizedDate = qrBatchText_(dateKey);
  if (!/^\d{8}$/.test(normalizedDate)) throw new Error('배치 날짜는 yyyyMMdd 형식이어야 합니다.');
  var pattern = new RegExp('^QRB-' + normalizedDate + '-(\\d+)$');
  var highest = 0;
  (existingIds || []).forEach(function (value) {
    var match = qrBatchText_(value).match(pattern);
    if (match) highest = Math.max(highest, Number(match[1]));
  });
  return 'QRB-' + normalizedDate + '-' + String(highest + 1).padStart(3, '0');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    QR_BATCH_MAX_SIZE: QR_BATCH_MAX_SIZE,
    buildQrBatchSnapshot: buildQrBatchSnapshot,
    buildQrBatchCanonical: buildQrBatchCanonical,
    buildQrBatchTargetCanonical: buildQrBatchTargetCanonical,
    selectQrBatchItems: selectQrBatchItems,
    applyQrBatchResults: applyQrBatchResults,
    resetFailedQrBatchItems: resetFailedQrBatchItems,
    summarizeQrBatchItems: summarizeQrBatchItems,
    nextQrBatchId: nextQrBatchId
  };
}
