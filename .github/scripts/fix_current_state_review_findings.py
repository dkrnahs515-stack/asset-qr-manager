from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


# 1. Current-state pure reducer fixes.
core_path = ROOT / "apps-script" / "CurrentStateCore.js"
core = core_path.read_text(encoding="utf-8")

helper_marker = """function isUsableInspectionRecord_(record) {
"""
helpers = """function resolveSessionStartedAt_(record, sessionsById, judgedAt) {
  var session = (sessionsById || {})[record && record.sessionId] || {};
  var startedAt = asComparableTime_(session.startedAt || '');
  return startedAt || asComparableTime_(judgedAt);
}

function normalizeMasterApplied_(value) {
  var text = String(value || '').trim();
  if (text === 'Y' || text === '반영완료') return '반영완료';
  if (text === '승인') return '승인';
  return 'N';
}

"""
if "function resolveSessionStartedAt_(" not in core:
    core = replace_once(core, helper_marker, helpers + helper_marker, "insert chronology and vocabulary helpers")

old_map = """      return {
        record: record,
        judgedAt: resolveJudgedAt_(record, judgmentMap),
        inputIndex: inputIndex
      };
"""
new_map = """      var judgedAt = resolveJudgedAt_(record, judgmentMap);
      return {
        record: record,
        judgedAt: judgedAt,
        sessionStartedAt: resolveSessionStartedAt_(record, sessions, judgedAt),
        inputIndex: inputIndex
      };
"""
if "sessionStartedAt: resolveSessionStartedAt_" not in core:
    core = replace_once(core, old_map, new_map, "attach session chronology to records")

old_sort = """    .sort(function (a, b) {
      var timeDifference = asComparableTime_(a.judgedAt) - asComparableTime_(b.judgedAt);
      if (timeDifference) return timeDifference;
      var idDifference = String(a.record.recordId || '').localeCompare(String(b.record.recordId || ''));
      return idDifference || a.inputIndex - b.inputIndex;
    });
"""
new_sort = """    .sort(function (a, b) {
      var sessionDifference = a.sessionStartedAt - b.sessionStartedAt;
      if (sessionDifference) return sessionDifference;
      var timeDifference = asComparableTime_(a.judgedAt) - asComparableTime_(b.judgedAt);
      if (timeDifference) return timeDifference;
      var idDifference = String(a.record.recordId || '').localeCompare(String(b.record.recordId || ''));
      return idDifference || a.inputIndex - b.inputIndex;
    });
"""
if "var sessionDifference = a.sessionStartedAt" not in core:
    core = replace_once(core, old_sort, new_sort, "sort by session chronology")

core = replace_once(
    core,
    "    state.masterApplied = record.masterApplied || 'N';\n",
    "    state.masterApplied = normalizeMasterApplied_(record.masterApplied);\n",
    "normalize master-applied vocabulary",
)

old_detail = """    if (Object.prototype.hasOwnProperty.call(record, 'confirmedDetailLocation')) {
      state.currentDetailLocation = record.confirmedDetailLocation || '';
    }
    state.locationSource = record.masterApplied === 'Y' ? '관리자반영' : '전수조사';
"""
new_detail = """    if (Object.prototype.hasOwnProperty.call(record, 'confirmedDetailLocation')) {
      state.currentDetailLocation = record.confirmedDetailLocation || '';
    } else if (locationChanged) {
      state.currentDetailLocation = '';
    }
    state.locationSource = state.masterApplied === '반영완료' ? '관리자반영' : '전수조사';
"""
core = replace_once(core, old_detail, new_detail, "clear stale detail location and use normalized source")
core_path.write_text(core, encoding="utf-8")


# 2. Reject duplicate permanent IDs in the materialized state map.
state_path = ROOT / "apps-script" / "CurrentState.gs"
state = state_path.read_text(encoding="utf-8")
old_state_map = """  readAllCurrentStates_(ss || getSpreadsheet_()).forEach(function (state) {
    if (!map[state.systemId]) map[state.systemId] = state;
  });
"""
new_state_map = """  readAllCurrentStates_(ss || getSpreadsheet_()).forEach(function (state) {
    if (map[state.systemId]) {
      throw new Error('비품현재상태에 중복 영구 시스템 ID가 있습니다: ' + state.systemId);
    }
    map[state.systemId] = state;
  });
"""
state = replace_once(state, old_state_map, new_state_map, "reject duplicate current-state IDs")
state_path.write_text(state, encoding="utf-8")


# 3. Validate current-state baselines before persisting a prepared session row.
code_path = ROOT / "apps-script" / "Code.gs"
code = code_path.read_text(encoding="utf-8")
baseline_block = """    var errorMap = readErrorMap_(getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.ERROR_REVIEW));
    var currentStateMap = ss.getSheetByName(INVENTORY_CONFIG.SHEETS.CURRENT_STATE)
      ? readCurrentStateMap_(ss)
      : {};
    var baselineAssets = assets.map(function (asset) {
      return selectInspectionBaseline(asset, currentStateMap[asset.systemId]);
    });
"""
code = replace_once(code, baseline_block, "", "remove late baseline block")
insert_marker = "    var sessionRow = buildRowForHeaders_(getHeaders_(sessionSheet), {\n"
code = replace_once(code, insert_marker, baseline_block + "\n" + insert_marker, "move baseline validation before session write")
code_path.write_text(code, encoding="utf-8")

print("current-state review findings patched")
