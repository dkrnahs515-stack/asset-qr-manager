from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def regex_replace_once(text: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return result


# Code.gs: remove the hardcoded workbook and expose runtime status in bootstrap data.
code_path = ROOT / "apps-script" / "Code.gs"
code = code_path.read_text(encoding="utf-8")
code, count = re.subn(
    r"\n  SPREADSHEET_ID: '[^']+',",
    "",
    code,
    count=1,
)
if count != 1 and "SPREADSHEET_ID:" in code:
    raise RuntimeError("remove hardcoded spreadsheet ID: unexpected source")

bootstrap = """function getBootstrapData() {
  var active = findActiveSession_();
  if (!active) {
    return {
      activeSession: null,
      summary: null,
      floors: [],
      reviewLocations: 0,
      runtime: getRuntimeEnvironmentStatus()
    };
  }
  return buildBootstrapForSession_(active.sessionId);
}
"""
code = regex_replace_once(
    code,
    r"function getBootstrapData\(\) \{.*?\n\}\n(?=\nfunction startInventorySession)",
    bootstrap,
    "replace bootstrap runtime integration",
)

code = regex_replace_once(
    code,
    r"\nfunction getSpreadsheet_\(\) \{.*?\n\}\n(?=\nfunction getRequiredSheet_)",
    "",
    "remove legacy getSpreadsheet",
)

old_bootstrap_tail = """    floors: floors,
    reviewLocations: reviewLocations
  };
}
"""
new_bootstrap_tail = """    floors: floors,
    reviewLocations: reviewLocations,
    runtime: getRuntimeEnvironmentStatus()
  };
}
"""
code = replace_once(
    code,
    old_bootstrap_tail,
    new_bootstrap_tail,
    "add runtime to active bootstrap",
)
code_path.write_text(code, encoding="utf-8")


# FieldOps.gs: isolate photo roots and session folders per runtime environment.
field_path = ROOT / "apps-script" / "FieldOps.gs"
field = field_path.read_text(encoding="utf-8")
field = field.replace(
    "var INVENTORY_PHOTO_ROOT_NAME = '강서청소년회관 비품 전수조사 사진';\n",
    "",
    1,
)
photo_function = """function getInventoryPhotoFolder_(sessionId) {
  var config = getRuntimeConfig_();
  var properties = PropertiesService.getScriptProperties();
  var rootId = properties.getProperty(config.photoRootIdKey);

  if (!rootId && config.isProduction) {
    rootId = properties.getProperty('INVENTORY_PHOTO_ROOT_ID') || '';
    if (rootId) properties.setProperty(config.photoRootIdKey, rootId);
  }

  var root = null;
  if (rootId) {
    try {
      root = DriveApp.getFolderById(rootId);
      root.getName();
    } catch (error) {
      root = null;
    }
  }
  if (!root) {
    root = DriveApp.createFolder(config.photoRootName);
    properties.setProperty(config.photoRootIdKey, root.getId());
  }

  var sessionKey = config.photoSessionIdPrefix + sessionId;
  var sessionFolderId = properties.getProperty(sessionKey);
  if (!sessionFolderId && config.isProduction) {
    var legacySessionKey = 'INVENTORY_PHOTO_SESSION_' + sessionId;
    sessionFolderId = properties.getProperty(legacySessionKey) || '';
    if (sessionFolderId) properties.setProperty(sessionKey, sessionFolderId);
  }

  if (sessionFolderId) {
    try {
      var existing = DriveApp.getFolderById(sessionFolderId);
      existing.getName();
      return existing;
    } catch (error) {
      sessionFolderId = '';
    }
  }

  var folderName = sessionId + (config.isProduction ? '' : ' [TEST]');
  var folders = root.getFoldersByName(folderName);
  var folder = folders.hasNext() ? folders.next() : root.createFolder(folderName);
  properties.setProperty(sessionKey, folder.getId());
  return folder;
}
"""
field = regex_replace_once(
    field,
    r"function getInventoryPhotoFolder_\(sessionId\) \{.*?\n\}\n(?=\nfunction )",
    photo_function,
    "replace photo folder environment scoping",
)
field_path.write_text(field, encoding="utf-8")


# Index.html: make the selected environment visible on every screen.
index_path = ROOT / "apps-script" / "Index.html"
index = index_path.read_text(encoding="utf-8")
runtime_css = """    .runtime-banner{margin:10px 14px 0;border:1px solid var(--line);border-radius:14px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px}.runtime-banner b{font-size:13px;white-space:nowrap}.runtime-banner span{min-width:0;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}.runtime-banner.test{background:#fff7ed;border-color:#fdba74;color:#9a3412}.runtime-banner.production{background:#ecfdf3;border-color:#86efac;color:#166534}
"""
index = replace_once(index, "  </style>", runtime_css + "  </style>", "add runtime banner styles")
old_header_boundary = "onBack=${goBack} online=${online}/>${error?"
new_header_boundary = """onBack=${goBack} online=${online}/>${bootstrap?.runtime?html`<div className=${'runtime-banner '+(bootstrap.runtime.isProduction?'production':'test')}><b>${bootstrap.runtime.isProduction?'운영 환경':'테스트 환경'}</b><span>${bootstrap.runtime.spreadsheetTitle||''} · ${bootstrap.runtime.spreadsheetIdMasked||''}</span></div>`:null}${error?"""
index = replace_once(index, old_header_boundary, new_header_boundary, "render runtime banner")
index_path.write_text(index, encoding="utf-8")


# Ensure new server files are parsed by the syntax test.
syntax_path = ROOT / "tests" / "syntax.test.js"
syntax = syntax_path.read_text(encoding="utf-8")
syntax = replace_once(
    syntax,
    "    'apps-script/CurrentStateCore.js',\n",
    "    'apps-script/CurrentStateCore.js',\n    'apps-script/RuntimeConfigCore.js',\n    'apps-script/RuntimeConfig.gs',\n",
    "add runtime files to syntax verification",
)
syntax_path.write_text(syntax, encoding="utf-8")


# Document the two-project deployment gate. Script Properties are project-scoped.
readme_path = ROOT / "apps-script" / "README.md"
readme = readme_path.read_text(encoding="utf-8")
section_title = "## TEST·운영 Apps Script 프로젝트 분리"
if section_title not in readme:
    readme += """

## TEST·운영 Apps Script 프로젝트 분리

Script Properties는 Apps Script 프로젝트 단위로 공유되므로 TEST와 운영 웹앱은 **서로 다른 Apps Script 프로젝트**를 사용합니다. 같은 프로젝트의 `/dev`와 `/exec`를 TEST·운영으로 나누지 않습니다.

### TEST 프로젝트 최초 설정

1. 기존 운영 Apps Script 프로젝트를 복사하거나 새 독립 프로젝트를 만들고 이름에 `[TEST]`를 표시합니다.
2. 저장소의 `Core.js`, `CurrentStateCore.js`, `RuntimeConfigCore.js`, `Code.gs`, `RuntimeConfig.gs`, `Inspection.gs`, `FieldOps.gs`, `SchemaSetup.gs`, `CurrentState.gs`, `Index.html`, `appsscript.json`을 TEST 프로젝트에 반영합니다.
3. 편집기에서 `setupApprovedTestRuntime()`을 1회 실행하고 권한을 승인합니다.
4. `getRuntimeEnvironmentStatus()` 반환값이 아래와 같은지 확인합니다.
   - `environment: TEST`
   - `projectRole: TEST`
   - 스프레드시트 제목: `강서청소년회관 QR 비품관리 대장_QR개발 테스트 사본`
5. `installAssetQrSchema()`와 `rebuildAllCurrentStates()`는 TEST 사본에서만 실행합니다.
6. **배포 → 테스트 배포 → 웹 앱**으로 `/dev` URL을 발급합니다. `/dev`는 스크립트 편집 권한이 있는 사용자만 접근하며 최신 저장 코드를 실행합니다.

### 운영 프로젝트 보호

운영 프로젝트에서는 `setupApprovedTestRuntime()`을 실행하지 않습니다. 운영 전환은 운영 프로젝트에서만 다음 순서로 진행합니다.

```javascript
setupApprovedProductionRuntime('INITIALIZE_PRODUCTION_PROJECT');
switchRuntimeEnvironment('PRODUCTION', 'SWITCH_TO_PRODUCTION');
```

프로젝트 역할과 다른 환경으로의 전환은 코드에서 차단됩니다. TEST 사진 폴더 키는 `ASSET_TEST_*`, 운영 사진 폴더 키는 `ASSET_PRODUCTION_*`로 저장되며, 기존 `INVENTORY_PHOTO_*` 값은 운영 프로젝트에서만 호환 마이그레이션합니다.

### Script Property 표준키

```text
ASSET_APP_ENV
ASSET_PROJECT_ROLE
ASSET_TEST_SPREADSHEET_ID
ASSET_PRODUCTION_SPREADSHEET_ID
ASSET_RUNTIME_CONFIG_VERSION
ASSET_TEST_PHOTO_ROOT_ID
ASSET_TEST_PHOTO_SESSION_<세션ID>
ASSET_PRODUCTION_PHOTO_ROOT_ID
ASSET_PRODUCTION_PHOTO_SESSION_<세션ID>
```
"""
readme_path.write_text(readme, encoding="utf-8")

print("runtime environment integration patched")
