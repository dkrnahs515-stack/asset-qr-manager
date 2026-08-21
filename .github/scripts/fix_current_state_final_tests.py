from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


state_path = ROOT / "apps-script" / "CurrentState.gs"
state = state_path.read_text(encoding="utf-8")
old_error = "throw new Error('비품현재상태에 중복 영구 시스템 ID가 있습니다: ' + state.systemId);"
new_error = "throw new Error('비품현재상태 영구 시스템 ID 중복: ' + state.systemId);"
if new_error not in state:
    state = replace_once(state, old_error, new_error, "align duplicate-ID error contract")
state_path.write_text(state, encoding="utf-8")


test_path = ROOT / "tests" / "current-state.test.js"
test_source = test_path.read_text(encoding="utf-8")
old_assertion = "  assert.equal(state.latestJudgedAt, at('2026-09-02T01:00:00Z'));"
new_assertion = "  assert.equal(state.latestJudgedAt.getTime(), at('2026-09-02T01:00:00Z').getTime());"
if new_assertion not in test_source:
    test_source = replace_once(
        test_source,
        old_assertion,
        new_assertion,
        "compare Date values instead of object identity",
    )
test_path.write_text(test_source, encoding="utf-8")

print("final current-state test findings patched")
