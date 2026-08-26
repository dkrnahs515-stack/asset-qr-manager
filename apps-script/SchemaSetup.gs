var CURRENT_STATE_HEADERS = [
  '영구 시스템 ID', 'New 비품번호', '품명', '현재위치코드', '현재층', '현재공간명',
  '현재세부위치', '위치출처', '현재조사결과', '최근조사세션ID', '최근조사명',
  '최근조사구분', '최근조사차수', '최근판정일시', '최근판정자', '마지막실물확인일시',
  '마지막실물확인자', '마지막위치변경일시', '마지막위치변경자', '이전위치코드',
  '이전층', '이전공간명', '근거기록ID', '마스터반영여부', '동기화상태',
  '동기화오류', '버전', '최종동기화일시'
];

var QR_ISSUE_HEADERS = [
  '영구 시스템 ID', 'QR접근키', 'QR접근키상태', 'QR조회URL', 'QR발급상태',
  '라벨유형', '라벨버전', '인쇄책임자 정', '인쇄책임자 부', '책임자버전',
  '라벨기준조사일', '최초발급일시', '최종출력일시', '재출력필요여부',
  '재출력사유', '재출력횟수', '최종출력배치ID', '비고'
];

var LABEL_PRINT_HEADERS = [
  '출력선택', '출력구분', 'New 비품번호', '품명', '현재층', '현재공간명',
  '현재조사결과', 'QR상태', 'QR발급상태', '재출력필요', '최근조사일',
  '출력가능여부', '영구 시스템 ID', 'QR조회URL', '위치정렬순서'
];

var SESSION_METADATA_HEADERS = ['조사구분', '조사차수', '조사표기명', '조사목적'];
var ASSET_QR_EXPECTED_ASSET_COUNT = 842;

var LABEL_SETTING_DEFAULTS = [
  ['기관명', '강서청소년회관'],
  ['라벨제목', '강서청소년회관 물품조사'],
  ['관리책임자 정', '김은영'],
  ['관리책임자 부', '김정훈'],
  ['책임자버전', 'RESP-2026-01'],
  ['책임자 적용시작일', ''],
  ['기본 조사일자', ''],
  ['QR 안내문구', '최신 위치·조사이력 확인'],
  ['기본 라벨규격', 'FORMTEC_LS3106'],
  ['라벨버전', 'LABEL-2026-01'],
  ['상세조회배포URL', ''],
  ['라벨가로mm', '64'],
  ['라벨세로mm', '33.9'],
  ['페이지열수', '3'],
  ['페이지행수', '8'],
  ['페이지왼쪽여백mm', '6.5'],
  ['페이지위쪽여백mm', '12.5'],
  ['열간격mm', '2.5'],
  ['행간격mm', '0'],
  ['QR크기mm', '20'],
  ['가로보정mm', '-1.8'],
  ['세로보정mm', '2.7'],
  ['3열가로보정mm', '0.3'],
  ['열간격보정mm', '0'],
  ['행간격보정mm', '0'],
  ['인쇄배율', '100']
];

function installAssetQrSchema() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getSpreadsheet_();
    var report = {
      createdSheets: [],
      addedHeaders: {},
      seededSettings: [],
      assetCount: 0,
      expectedAssetCount: ASSET_QR_EXPECTED_ASSET_COUNT,
      assetCountMatches: false
    };

    ensureSheetSchema_(ss, '비품현재상태', CURRENT_STATE_HEADERS, report);
    ensureSheetSchema_(ss, 'QR발급관리', QR_ISSUE_HEADERS, report);
    var labelSheet = ensureSheetSchema_(ss, '라벨설정', ['설정항목', '설정값'], report);
    seedLabelSettings_(labelSheet, report);
    ensureLabelPrintWorkSheet_(ss, report);

    var sessionSheet = ss.getSheetByName('전수조사세션');
    if (!sessionSheet) throw new Error('필수 시트를 찾을 수 없습니다: 전수조사세션');
    ensureSessionMetadataHeaders_(sessionSheet, report);

    var assetSheet = ss.getSheetByName('비품마스터');
    if (!assetSheet) throw new Error('필수 시트를 찾을 수 없습니다: 비품마스터');
    report.assetCount = countRegisteredAssetsForSchema_(assetSheet);
    report.assetCountMatches = report.assetCount === ASSET_QR_EXPECTED_ASSET_COUNT;
    return report;
  } finally {
    lock.releaseLock();
  }
}

function ensureSheetSchema_(ss, sheetName, desiredHeaders, report) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    report.createdSheets.push(sheetName);
  }

  ensureSheetCapacity_(sheet, desiredHeaders.length);
  var existingHeaders = readSchemaHeaders_(sheet);
  var missingHeaders = desiredHeaders.filter(function (header) {
    return existingHeaders.indexOf(header) < 0;
  });

  if (!existingHeaders.length && desiredHeaders.length) {
    sheet.getRange(1, 1, 1, desiredHeaders.length).setValues([desiredHeaders]);
    missingHeaders = desiredHeaders.slice();
  } else if (missingHeaders.length) {
    ensureSheetCapacity_(sheet, sheet.getLastColumn() + missingHeaders.length);
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, missingHeaders.length).setValues([missingHeaders]);
  }

  report.addedHeaders[sheetName] = missingHeaders.slice();
  sheet.setFrozenRows(1);
  applySchemaValidations_(sheet, sheetName);
  return sheet;
}

function ensureLabelPrintWorkSheet_(ss, report) {
  var sheet = ss.getSheetByName('라벨출력');
  var created = false;
  if (!sheet) {
    sheet = ss.insertSheet('라벨출력');
    created = true;
    report.createdSheets.push('라벨출력');
  }

  ensureSheetCapacity_(sheet, LABEL_PRINT_HEADERS.length);
  if (sheet.getMaxRows() < 5) sheet.insertRowsAfter(sheet.getMaxRows(), 5 - sheet.getMaxRows());

  sheet.getRange(1, 1, 1, LABEL_PRINT_HEADERS.length).mergeAcross();
  sheet.getRange(1, 1).setValue('QR 라벨 출력 작업');
  sheet.getRange(2, 1, 1, LABEL_PRINT_HEADERS.length).mergeAcross();
  sheet.getRange(2, 1).setValue('목록을 새로고침한 뒤 출력할 비품을 선택하세요.');
  sheet.getRange(3, 1, 1, LABEL_PRINT_HEADERS.length).mergeAcross();
  sheet.getRange(3, 1).setValue('출력 완료 반영 전에는 QR발급관리 이력이 변경되지 않습니다.');
  sheet.getRange(4, 1, 1, LABEL_PRINT_HEADERS.length).setValues([LABEL_PRINT_HEADERS]);
  sheet.setFrozenRows(4);
  sheet.setHiddenGridlines(true);
  sheet.hideColumns(13, 3);

  report.addedHeaders['라벨출력'] = created ? LABEL_PRINT_HEADERS.slice() : [];
  return sheet;
}

function ensureSheetCapacity_(sheet, requiredColumns) {
  var missingColumns = Math.max(0, Number(requiredColumns || 0) - sheet.getMaxColumns());
  if (missingColumns > 0) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), missingColumns);
  }
}

function readSchemaHeaders_(sheet) {
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (value) { return String(value || '').trim(); });
}

function applySchemaValidations_(sheet, sheetName) {
  var headers = readSchemaHeaders_(sheet);
  if (!headers.length || sheet.getMaxRows() < 2) return;

  var rules = {};
  if (sheetName === '비품현재상태') {
    rules['마스터반영여부'] = ['N', '승인', '반영완료'];
    rules['동기화상태'] = ['정상', '오류', '재계산필요'];
  } else if (sheetName === 'QR발급관리') {
    rules['QR접근키상태'] = ['사용', '중지', '재발급'];
    rules['QR발급상태'] = ['미발급', '발급완료', '재발급필요'];
    rules['라벨유형'] = ['FORMTEC_LS3106', 'A4_FREECUT_64X34'];
    rules['재출력필요여부'] = ['Y', 'N'];
  }

  Object.keys(rules).forEach(function (header) {
    var columnIndex = headers.indexOf(header);
    if (columnIndex < 0) return;
    var validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(rules[header], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, columnIndex + 1, sheet.getMaxRows() - 1, 1).setDataValidation(validation);
  });
}

function seedLabelSettings_(sheet, report) {
  var headers = readSchemaHeaders_(sheet);
  var itemColumn = headers.indexOf('설정항목');
  var valueColumn = headers.indexOf('설정값');
  if (itemColumn < 0 || valueColumn < 0) {
    throw new Error('라벨설정 시트의 설정항목·설정값 헤더가 필요합니다.');
  }

  var existingKeys = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().forEach(function (row) {
      var key = String(row[itemColumn] || '').trim();
      if (key) existingKeys[key] = true;
    });
  }

  var newRows = [];
  LABEL_SETTING_DEFAULTS.forEach(function (entry) {
    if (existingKeys[entry[0]]) return;
    var row = headers.map(function () { return ''; });
    row[itemColumn] = entry[0];
    row[valueColumn] = entry[1];
    newRows.push(row);
    report.seededSettings.push(entry[0]);
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }
}

function ensureSessionMetadataHeaders_(sheet, report) {
  var existingHeaders = readSchemaHeaders_(sheet);
  var missingHeaders = SESSION_METADATA_HEADERS.filter(function (header) {
    return existingHeaders.indexOf(header) < 0;
  });
  if (missingHeaders.length) {
    ensureSheetCapacity_(sheet, sheet.getLastColumn() + missingHeaders.length);
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, missingHeaders.length).setValues([missingHeaders]);
  }
  report.addedHeaders['전수조사세션'] = missingHeaders;
  sheet.setFrozenRows(1);
}

function countRegisteredAssetsForSchema_(sheet) {
  var headers = readSchemaHeaders_(sheet);
  var idColumn = headers.indexOf('영구 시스템 ID');
  if (idColumn < 0) throw new Error('비품마스터 시트에 영구 시스템 ID 헤더가 없습니다.');
  if (sheet.getLastRow() <= 1) return 0;
  return sheet.getRange(2, idColumn + 1, sheet.getLastRow() - 1, 1).getValues()
    .filter(function (row) { return !!String(row[0] || '').trim(); })
    .length;
}