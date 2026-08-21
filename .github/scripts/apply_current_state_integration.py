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


inspection_path = ROOT / "apps-script" / "Inspection.gs"
inspection = inspection_path.read_text(encoding="utf-8")

inspection = replace_if_missing(
    inspection,
    "safeRebuildCurrentStateForAsset_(nextRecord.systemId)",
    """    applySessionMetricDelta_(payload.sessionId, previousResult, nextRecord.result);
    return buildInspectionResponse_(nextRecord, payload.sessionId, changeId, false);""",
    """    applySessionMetricDelta_(payload.sessionId, previousResult, nextRecord.result);
    var currentStateSync = nextRecord.targetType === '등록비품' && nextRecord.systemId
      ? safeRebuildCurrentStateForAsset_(nextRecord.systemId)
      : null;
    return buildInspectionResponse_(nextRecord, payload.sessionId, changeId, false, currentStateSync);""",
    "sync initial judgment",
)

# The first replacement affects both initial and revision if run globally, so revise the remaining occurrence.
if inspection.count("safeRebuildCurrentStateForAsset_(nextRecord.systemId)") < 2:
    inspection = replace_once(
        inspection,
        """    applySessionMetricDelta_(payload.sessionId, previousResult, nextRecord.result);
    return buildInspectionResponse_(nextRecord, payload.sessionId, changeId, false);""",
        """    applySessionMetricDelta_(payload.sessionId, previousResult, nextRecord.result);
    var currentStateSync = nextRecord.targetType === '등록비품' && nextRecord.systemId
      ? safeRebuildCurrentStateForAsset_(nextRecord.systemId)
      : null;
    return buildInspectionResponse_(nextRecord, payload.sessionId, changeId, false, currentStateSync);""",
        "sync revised judgment",
    )

inspection = replace_if_missing(
    inspection,
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
code = replace_if_missing(
    code,
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
