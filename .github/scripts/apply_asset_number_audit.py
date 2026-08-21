from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def replace_if_missing(text, marker, old, new, label):
    if marker in text:
        return text
    return replace_once(text, old, new, label)


core_path = ROOT / "apps-script" / "Core.js"
core = core_path.read_text(encoding="utf-8")

if "function normalizeAssetNumber(value)" not in core:
    helper = r"""function normalizeAssetNumber(value) {
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

"""
    core = replace_once(
        core,
        "function representativeCode_(locationCode, locationMap) {",
        helper + "function representativeCode_(locationCode, locationMap) {",
        "insert core helpers",
    )

core = replace_if_missing(
    core,
    "oldAssetNo: normalizeAssetNumber(asset.oldAssetNo)",
    "      oldAssetNo: asset.oldAssetNo || '',",
    "      oldAssetNo: normalizeAssetNumber(asset.oldAssetNo),",
    "normalize snapshot old number",
)

if "normalizeAssetNumber: normalizeAssetNumber" not in core:
    core = replace_once(
        core,
        "    buildRoomDisplayRecords: buildRoomDisplayRecords,\n    createInspectionSnapshot: createInspectionSnapshot,",
        "    buildRoomDisplayRecords: buildRoomDisplayRecords,\n    normalizeAssetNumber: normalizeAssetNumber,\n    validateChangeLogPayload: validateChangeLogPayload,\n    createInspectionSnapshot: createInspectionSnapshot,",
        "export core helpers",
    )

core_path.write_text(core, encoding="utf-8")

code_path = ROOT / "apps-script" / "Code.gs"
code = code_path.read_text(encoding="utf-8")
code = replace_if_missing(
    code,
    "oldAssetNo: normalizeAssetNumber(row[index['Old 비품번호']])",
    "      oldAssetNo: String(row[index['Old 비품번호']] || '').trim(),",
    "      oldAssetNo: normalizeAssetNumber(row[index['Old 비품번호']]),",
    "normalize asset master old number",
)
code = replace_if_missing(
    code,
    "'Old 비품번호': normalizeAssetNumber(record.oldAssetNo)",
    "    'Old 비품번호': record.oldAssetNo,",
    "    'Old 비품번호': normalizeAssetNumber(record.oldAssetNo),",
    "normalize written old number",
)
code = replace_if_missing(
    code,
    "oldAssetNo: normalizeAssetNumber(value('Old 비품번호'))",
    "    oldAssetNo: String(value('Old 비품번호') || ''),",
    "    oldAssetNo: normalizeAssetNumber(value('Old 비품번호')),",
    "normalize record old number",
)
code = replace_if_missing(
    code,
    "oldAssetNo: normalizeAssetNumber(record.oldAssetNo)",
    "    oldAssetNo: record.oldAssetNo,",
    "    oldAssetNo: normalizeAssetNumber(record.oldAssetNo),",
    "normalize serialized old number",
)

if "function appendChangeLog_(sheet, change) {\n  validateChangeLogPayload(change);" not in code:
    code = replace_once(
        code,
        "function appendChangeLog_(sheet, change) {\n  var headers = getHeaders_(sheet);",
        "function appendChangeLog_(sheet, change) {\n  validateChangeLogPayload(change);\n  var headers = getHeaders_(sheet);\n  requireHeaders_(headers, [\n    '변경ID', '세션ID', '기록ID', '영구 시스템 ID', '변경일시', '변경자',\n    '작업유형', '대상필드', '변경전값', '변경후값', '변경사유', '작업UUID',\n    '이전변경ID', '취소여부', '동기화일시', '비고'\n  ], sheet.getName());",
        "validate every change log row",
    )
code_path.write_text(code, encoding="utf-8")

inspection_path = ROOT / "apps-script" / "Inspection.gs"
inspection = inspection_path.read_text(encoding="utf-8")
start = inspection.index("function reviseInspectionActionFromMobile(payload) {")
end = inspection.index("function undoInspectionAction(payload) {")
revision = inspection[start:end]

if "var changeEntry = {" not in revision:
    old = """    var previousResult = record.result || '미확인';
    var nextRecord = reviseInspectionAction(record, action);
    writeInspectionRecord_(recordSheet, found.rowNumber, nextRecord);

    var changeId = appendChangeLog_(logSheet, {
      sessionId: payload.sessionId,
      recordId: payload.recordId,
      systemId: record.systemId,
      changedAt: action.now,
      changedBy: action.inspector,
      actionType: '판정수정',
      targetField: '전수조사기록 상태',
      beforeValue: JSON.stringify(beforeSnapshot),
      afterValue: JSON.stringify(createInspectionSnapshot(nextRecord)),
      reason: previousResult + ' → ' + nextRecord.result + ' · ' + action.memo,
      actionUuid: payload.actionUuid
    });"""
    new = """    var previousResult = record.result || '미확인';
    var nextRecord = reviseInspectionAction(record, action);
    var changeEntry = {
      sessionId: payload.sessionId,
      recordId: payload.recordId,
      systemId: record.systemId,
      changedAt: action.now,
      changedBy: action.inspector,
      actionType: '판정수정',
      targetField: '전수조사기록 상태',
      beforeValue: JSON.stringify(beforeSnapshot),
      afterValue: JSON.stringify(createInspectionSnapshot(nextRecord)),
      reason: previousResult + ' → ' + nextRecord.result + ' · ' + action.memo,
      actionUuid: payload.actionUuid
    };
    validateChangeLogPayload(changeEntry);
    writeInspectionRecord_(recordSheet, found.rowNumber, nextRecord);

    var changeId = appendChangeLog_(logSheet, changeEntry);"""
    revision = replace_once(revision, old, new, "validate revision log before record write")
    inspection = inspection[:start] + revision + inspection[end:]

inspection_path.write_text(inspection, encoding="utf-8")
print("asset number and audit patch applied")
