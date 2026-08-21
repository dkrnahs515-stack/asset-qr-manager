from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

current_state_path = ROOT / "apps-script" / "CurrentState.gs"
current_state = current_state_path.read_text(encoding="utf-8")
repair = """

function repairCurrentState(systemId) {
  assertText_(systemId, '영구 시스템 ID');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return rebuildCurrentStateForAsset_(systemId);
  } finally {
    lock.releaseLock();
  }
}
"""
if "function repairCurrentState(systemId)" not in current_state:
    current_state = current_state.rstrip() + repair
    current_state_path.write_text(current_state, encoding="utf-8")

readme_path = ROOT / "README.md"
readme = readme_path.read_text(encoding="utf-8")
marker = "## 비품현재상태 기반 설치·복구"
section = r"""

## 비품현재상태 기반 설치·복구

QR 상세조회·A4 라벨 시스템의 1단계는 기존 전수조사 원본을 유지하면서 비품별 최신 상태를 `비품현재상태`에 파생 저장합니다. `비품마스터`, `전수조사기록`, `변경이력`이 원본이며 `비품현재상태`는 언제든 다시 계산할 수 있습니다.

### Apps Script 파일 매핑

```text
apps-script/Core.js                 → Core.gs
apps-script/CurrentStateCore.js     → CurrentStateCore.gs
apps-script/Code.gs                 → Code.gs
apps-script/Inspection.gs           → Inspection.gs
apps-script/FieldOps.gs             → FieldOps.gs
apps-script/CurrentState.gs         → CurrentState.gs
apps-script/SchemaSetup.gs          → SchemaSetup.gs
apps-script/Index.html              → Index.html
apps-script/appsscript.json         → appsscript.json
```

### 최초 설치 순서

운영 시트에 적용하기 전에 백업 또는 테스트 사본에서 먼저 실행합니다.

1. 위 Apps Script 파일을 모두 교체하거나 추가하고 저장합니다.
2. `installAssetQrSchema()`를 실행합니다.
3. 반환값에서 `assetCount=842`, `expectedAssetCount=842`, `assetCountMatches=true`를 확인합니다.
4. `rebuildAllCurrentStates()`를 실행합니다.
5. `auditCurrentState()`를 실행합니다.
6. `registeredCount=842`, `stateCount=842`, `duplicateIds=[]`, `missingIds=[]`, `extraIds=[]`, `syncErrorIds=[]`, `ok=true`를 확인합니다.
7. 테스트 배포에서 정상확인·위치변경·상태이상·미발견·판정수정·Undo를 검증합니다.
8. 검증을 통과한 뒤 기존 웹 앱을 새 버전으로 배포하여 기존 `/exec` URL을 유지합니다.

### 복구 작업

특정 비품만 다시 계산할 때는 영구 시스템 ID를 전달합니다.

```javascript
repairCurrentState('GSYC-000340');
```

전체를 다시 계산해야 할 때는 `rebuildAllCurrentStates()`를 사용하고, 완료 후 반드시 `auditCurrentState()` 결과를 확인합니다. 사진추가만으로 최근 판정일·마지막 실물확인일·마지막 위치변경일은 변경되지 않습니다.
"""
if marker not in readme:
    insert_at = readme.find("\n---\n\n# 기존 Firebase")
    if insert_at < 0:
        readme = readme.rstrip() + section + "\n"
    else:
        readme = readme[:insert_at] + section + readme[insert_at:]
    readme_path.write_text(readme, encoding="utf-8")

print("current-state repair and migration docs applied")
