'use strict';

function base64UrlFromBytes(bytes) {
  if (typeof Buffer === 'undefined') {
    throw new Error('Node.js Buffer가 필요한 변환입니다. Apps Script에서는 Utilities.base64EncodeWebSafe를 사용하세요.');
  }
  return Buffer.from(bytes || []).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function isValidQrAccessKey(key) {
  return /^[A-Za-z0-9_-]{32}$/.test(String(key || ''));
}

function normalizeQrDetailBaseUrl_(baseUrl) {
  var normalized = String(baseUrl || '').trim();
  if (!normalized) throw new Error('정식 QR 상세조회 /exec URL이 필요합니다.');
  if (/[?#]/.test(normalized)) {
    throw new Error('상세조회 URL에는 query parameter나 fragment가 없어야 합니다.');
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(normalized)) {
    throw new Error('정식 QR 상세조회 /exec URL이 필요합니다.');
  }
  return normalized;
}

function buildQrLookupUrl(baseUrl, key) {
  var normalizedBase = normalizeQrDetailBaseUrl_(baseUrl);
  if (!isValidQrAccessKey(key)) throw new Error('유효하지 않은 QR 접근키입니다.');
  return normalizedBase + '?k=' + encodeURIComponent(String(key));
}

function qrIssueValue_(row, camelName, headerName) {
  if (!row) return '';
  if (Object.prototype.hasOwnProperty.call(row, camelName)) return row[camelName];
  return row[headerName];
}

function findActiveQrIssue(rows, systemId) {
  var normalizedSystemId = String(systemId || '').trim();
  var matches = (rows || []).filter(function (row) {
    return String(qrIssueValue_(row, 'systemId', '영구 시스템 ID') || '').trim() === normalizedSystemId &&
      String(qrIssueValue_(row, 'accessKeyStatus', 'QR접근키상태') || '').trim() === '사용';
  });
  if (matches.length > 1) {
    throw new Error('사용 중인 QR 접근키가 중복되었습니다: ' + normalizedSystemId);
  }
  return matches[0] || null;
}

function buildInitialQrIssueRecord(asset, key, url, issuedAt) {
  var source = asset || {};
  var systemId = String(source.systemId || source['영구 시스템 ID'] || '').trim();
  if (!systemId) throw new Error('영구 시스템 ID가 필요합니다.');
  if (!isValidQrAccessKey(key)) throw new Error('유효하지 않은 QR 접근키입니다.');
  var expectedUrl = buildQrLookupUrl(String(url || '').split('?')[0], key);
  if (String(url || '') !== expectedUrl) throw new Error('QR 조회URL과 접근키가 일치하지 않습니다.');

  return {
    systemId: systemId,
    accessKey: String(key),
    accessKeyStatus: '사용',
    lookupUrl: expectedUrl,
    issueStatus: '미발급',
    labelType: '',
    labelVersion: '',
    printedPrimaryManager: '',
    printedSecondaryManager: '',
    managerVersion: '',
    labelInspectionDate: '',
    firstIssuedAt: issuedAt || new Date(),
    lastPrintedAt: '',
    reprintRequired: 'N',
    reprintReason: '',
    reprintCount: 0,
    lastPrintBatchId: '',
    memo: ''
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    base64UrlFromBytes: base64UrlFromBytes,
    isValidQrAccessKey: isValidQrAccessKey,
    buildQrLookupUrl: buildQrLookupUrl,
    buildInitialQrIssueRecord: buildInitialQrIssueRecord,
    findActiveQrIssue: findActiveQrIssue
  };
}
