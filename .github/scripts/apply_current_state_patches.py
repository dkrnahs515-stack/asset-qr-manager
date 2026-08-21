from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


code_path = ROOT / "apps-script" / "Code.gs"
code = code_path.read_text(encoding="utf-8")

marker = "    CURRENT_STATE: '비품현재상태',"
if marker not in code:
    code = replace_once(
        code,
        "    RECORD: '전수조사기록',\n    CHANGE_LOG: '변경이력'\n",
        "    RECORD: '전수조사기록',\n"
        "    CHANGE_LOG: '변경이력',\n"
        "    CURRENT_STATE: '비품현재상태',\n"
        "    QR_ISSUE: 'QR발급관리',\n"
        "    LABEL_SETTINGS: '라벨설정'\n",
        "extend INVENTORY_CONFIG sheet names",
    )

code_path.write_text(code, encoding="utf-8")
print("current-state patches applied")
