from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def replace_if_missing(text: str, marker: str, old: str, new: str, label: str) -> str:
    if marker in text:
        return text
    return replace_once(text, old, new, label)


def replace_in_function(text: str, function_name: str, marker: str, old: str, new: str, label: str) -> str:
    start_marker = f"function {function_name}("
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"{label}: function not found: {function_name}")
    next_start = text.find("\nfunction ", start + len(start_marker))
    end = len(text) if next_start < 0 else next_start
    body = text[start:end]
    if marker in body:
        return text
    updated_body = replace_once(body, old, new, label)
    return text[:start] + updated_body + text[end:]


inspection_path = ROOT / "apps-script" / "Inspection.gs"
inspection = inspection_path.read_text(encoding="utf-8")

shared_old = """    applySessionMetricDelta_(payload.sessionId, previousResult, nextRecord.result);
    return buildInspectionResponse_(nextRecord, payload.sessionId, changeId, false);"""
shared_new = """    applySessionMetricDelta_(payload.sessionId, previousResult, nextRecord.result);
    var currentStateSync = nextRecord.targetType === '등록비품' && nextRecord.systemId
      ? safeRebuildCurrentStateForAsset_(nextRecord.systemId)
      : null;
    return buildInspectionResponse_(nextRecord, payload.sessionId, changeId, false, currentStateSync);"""

inspection = replace_in_function(
    inspection,
    "applyInspectionActionFromMobile",
    "safeRebuildCurrentStateForAsset_(nextRecord.systemId)",
    shared_old,
    shared_new,
    "sync initial judgment",
)
inspection = replace_in_function(
    inspection,
    "reviseInspectionActionFromMobile",
    "safeRebuildCurrentStateForAsset_(nextRecord.systemId)",
    shared_old,
    shared_new,
    "sync revised judgment",
)
inspection = replace_in_function(
    inspection,
    "undoInspectionAction",
    "safeRebuildCurrentStateForAsset_(restored.systemId)",
    """    applySessionMetricDelta_(payload.sessionId, previousResult, restored.result);
    return buildInspectionResponse_(restored, payload.sessionId, undoChangeId, false);""",
    """    applySessionMetricDelta_(payload.sessionId, previousResult, restored.result);
    var currentStateSync = restored.targetType === '등록비품' && restored.systemId
      ? safeRebuildCurrentStateForAsset_(restored.systemId)
      : null;
    return buildInspectionResponse_(restored, payload.sessionId, undoChangeId, false, currentStateSync);""",
    "sync undo",
)
inspection = replace_if_missing(
    inspection,
    "function buildInspectionResponse_(record, sessionId, changeId, duplicate, currentStateSync)",
    """function buildInspectionResponse_(record, sessionId, changeId, duplicate) {
  return {
    duplicate: !!duplicate,
    changeId: changeId || '',
    record: serializeRecord_(record),
    summary: getSessionSummary_(sessionId)
  };
}""",
    """function buildInspectionResponse_(record, sessionId, changeId, duplicate, currentStateSync) {
  return {
    duplicate: !!duplicate,
    changeId: changeId || '',
    record: serializeRecord_(record),
    summary: getSessionSummary_(sessionId),
    currentStateSync: currentStateSync || null
  };
}""",
    "extend inspection response",
)
inspection_path.write_text(inspection, encoding="utf-8")

code_path = ROOT / "apps-script" / "Code.gs"
code = code_path.read_text(encoding="utf-8")
code = replace_in_function(
    code,
    "markAssetNormal",
    "safeRebuildCurrentStateForAsset_(record.systemId)",
    """    applySessionMetricDelta_(payload.sessionId, previousResult, '정상');

    return {
      duplicate: false,
      record: serializeRecord_(record),
      summary: getSessionSummary_(payload.sessionId)
    };""",
    """    applySessionMetricDelta_(payload.sessionId, previousResult, '정상');
    var currentStateSync = record.targetType === '등록비품' && record.systemId
      ? safeRebuildCurrentStateForAsset_(record.systemId)
      : null;

    return {
      duplicate: false,
      record: serializeRecord_(record),
      summary: getSessionSummary_(payload.sessionId),
      currentStateSync: currentStateSync
    };""",
    "sync legacy normal endpoint",
)
code_path.write_text(code, encoding="utf-8")
print("current-state integration patches applied")
