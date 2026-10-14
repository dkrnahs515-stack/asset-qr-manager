# Google Sheets 연동 모바일 전수조사 MVP

강서청소년회관 비품마스터를 기준으로 스마트폰 현장 전수조사를 수행하는 Apps Script + React 웹앱입니다.

## 현재 구현 범위

- 전수조사 세션 생성/이어하기
- 등록 비품 842개 스냅샷
- 층/공간별 진행률
- 정상 확인
- 위치 다름
- 상태 이상
- 미발견
- Undo
- 미등록 비품 임시등록
- 현장 사진 촬영/선택 → Google Drive 저장
- 공간 조사 마감
- 공간별 미확인 우선 정렬
- `미확인 / 이슈 / 미등록 / 전체` 필터
- 검색
- 모바일 하단 고정 주요 동작 버튼

## 기준 Google Sheet

Spreadsheet ID: `1R5WjwpXtsJwQfIvNnQ_D5PLD6TTLXqTlQ7CSjbUa274`

필수 탭:

- `비품마스터`
- `위치마스터`
- `오류검토`
- `전수조사세션`
- `전수조사기록`
- `사진`
- `변경이력`

## Apps Script 파일 구성

| 저장소 파일 | Apps Script 파일명 | 종류 |
|---|---|---|
| `Code.gs` | `Code.gs` | 스크립트 |
| `Core.js` | `Core.gs` | 스크립트 |
| `Inspection.gs` | `Inspection.gs` | 스크립트 |
| `FieldOps.gs` | `FieldOps.gs` | 스크립트 |
| `QrCore.js` | `QrCore.gs` | 스크립트 |
| `QrAdmin.gs` | `QrAdmin.gs` | 스크립트 |
| `QrBatchCore.js` | `QrBatchCore.gs` | 스크립트 |
| `QrBatch.gs` | `QrBatch.gs` | 스크립트 |
| `SchemaSetup.gs` | `SchemaSetup.gs` | 스크립트 |
| `Index.html` | `Index.html` | HTML |
| `appsscript.json` | `appsscript.json` | 매니페스트 |

`Core.js`는 Node 테스트를 위해 저장소에서 `.js` 확장자를 사용합니다. Apps Script에는 `Core.gs`로 만듭니다.
`QrCore.js`와 `QrBatchCore.js`도 같은 이유로 Apps Script에서는 각각 `QrCore.gs`, `QrBatchCore.gs`로 만듭니다.

## 이미 배포된 Apps Script를 이번 버전으로 업데이트하는 순서

1. `Core.gs` 내용을 저장소 최신 `Core.js` 내용으로 교체합니다.
2. `파일 + > 스크립트`에서 `FieldOps`를 새로 만들고 `FieldOps.gs` 전체를 붙여 넣습니다.
3. `Index.html`을 최신 내용으로 교체합니다.
4. `appsscript.json`을 최신 내용으로 교체합니다.
5. 모두 저장합니다.
6. 사진 기능 때문에 Google Drive 권한이 새로 추가되므로 다시 권한 승인이 필요할 수 있습니다.
7. `배포 > 배포 관리`에서 기존 웹 앱 배포를 새 버전으로 업데이트합니다. 테스트 중이면 먼저 테스트 배포 URL로 확인합니다.

`Inspection.gs`와 `Code.gs`는 이번 기능 묶음에서 변경하지 않았습니다.

## 권한

현재 매니페스트는 다음 권한을 사용합니다.

- Google Sheets 읽기/쓰기
- Google Drive 사진 파일 생성/관리

사진은 앱이 만든 `강서청소년회관 비품 전수조사 사진` 폴더 아래 세션별 하위 폴더에 저장됩니다.

예:

```text
강서청소년회관 비품 전수조사 사진/
└─ INV-2026-001/
   ├─ GSYC-000820_20260819_174500.jpg
   └─ TMP-2026-0001_20260819_174612.jpg
```

Sheet의 `사진` 탭에는 실제 이미지가 아니라 Drive 파일ID/URL/사진유형/촬영자/촬영일시를 저장합니다.

## 미등록 비품

현장에서는 정식 비품번호를 발급하지 않습니다.

- `TMP-2026-0001` 형식 임시 ID 자동 발급
- `INVR-2026-001-U001` 형식 조사기록 ID 자동 발급
- 품명 필수
- 사진 필수
- 규격/메모 선택
- 현재 조사 공간 자동 적용
- `조사결과=미등록발견`
- `관리자검토상태=미검토`
- 전수조사 842개 진행률의 분모에는 포함하지 않음

## 사진

스마트폰의 `<input type="file" accept="image/*" capture="environment">` 방식을 사용합니다. 직접 `getUserMedia()`를 호출하지 않습니다.

클라이언트에서 업로드 전에:

- 최대 긴 변 1600px
- JPEG 품질 약 78%

로 압축한 뒤 Apps Script로 전송합니다.

사진유형:

- 파손
- 고장
- 라벨
- 위치
- 미등록
- 규격
- 기타

## 공간 마감

공간 마감은 `변경이력`에 `작업유형=공간마감`으로 기록합니다.

마감 화면에서 확인하는 값:

- 대상
- 완료
- 미확인
- 상태이상
- 미발견
- 미등록 발견

미확인이 남아 있으면 기본적으로 경고하고 `미확인 비품 다시 보기`를 우선 제공합니다. 필요하면 `현재 상태로 공간 마감`을 명시적으로 선택할 수 있습니다.

## 모바일 UX 규칙

- 터치 버튼 최소 높이 48~56px
- 정상 확인 버튼 62px
- 미완료 공간 우선 정렬
- 완료 공간은 아래로 이동
- 공간 화면 하단에 `+ 미등록 비품 / 공간 마감` 고정
- 필터: `미확인 / 이슈 / 미등록 / 전체`
- 하단 네비게이션에서 현재 공간 검색과 이슈 필터 빠른 접근
- 사진 업로드 후 이전 판정 Undo는 안전을 위해 초기화

## 검증

저장소 루트에서:

```bash
npm test
```

현재 자동 테스트는 다음을 포함합니다.

- 세션/등록 기록 ID 생성
- 미등록 임시 ID/미등록 기록 ID 생성
- 등록 비품 스냅샷
- 대표위치 집계
- 공간/층/전체 진행률
- 미등록 비품이 842개 진행률 분모에 포함되지 않는지
- 공간 마감 요약
- 미완료 공간 우선 정렬
- 위치변경/상태이상/미발견/Undo
- Apps Script 서버 파일 문법
- 모바일 인라인 JavaScript 문법

## 현재 실기 검증 이력

2026-08-19 실제 Google Sheet 연결 상태에서 다음 사이클을 확인했습니다.

- 842개 전수조사기록 생성
- 정상확인
- Undo
- 위치변경
- 상태이상
- 미발견
- 세션 진행률/변경이력 반영

미등록 비품, Drive 사진, 공간 마감 기능은 이번 PR 업데이트 후 Apps Script 재배포 뒤 추가 실기 검증합니다.


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

## QR 대량발급: 50개 배치와 체크포인트 복구

### 현재 TEST 대상 수량

2026-08-27 읽기 전용 대조 결과는 다음과 같습니다.

- 비품마스터: 842개
- 자동 발급 대상: 827개 (`사용여부=사용`)
- 자동 발급 제외: 15개 (`물품상태=불용예정`, `사용여부=확인필요`)
- 기존 활성 QR: 29개
- 새 QR 필요: 798개
- 마스터·라벨출력 영구 시스템 ID 중복: 0개
- 라벨출력에만 있는 비품: 0개

따라서 전체 발급 분모는 842개가 아니라 827개입니다. 제외된 15개는 사용 승인 전까지 자동 발급하지 않습니다.

### TEST Apps Script 동기화 파일

최신 병합본이 반영된 TEST 프로젝트에 다음 파일을 추가하거나 교체합니다.

1. `QrBatchCore.js` → Apps Script `QrBatchCore.gs`
2. `QrBatch.gs` → Apps Script `QrBatch.gs`
3. `QrAdmin.gs` → Apps Script `QrAdmin.gs`
4. `SchemaSetup.gs` → Apps Script `SchemaSetup.gs`

모두 저장한 뒤 `installAssetQrSchema()`를 한 번 실행합니다. 기존 시트를 지우지 않고 다음 체크포인트 시트를 추가합니다.

- `QR대량발급배치`
- `QR대량발급항목`

### Apps Script 편집기 실행 순서

아래 함수는 인자가 없어 편집기의 함수 선택 목록에서 바로 실행할 수 있습니다.

1. `stageBulkQrIssuancePreview()`
   - 시트는 변경하지 않습니다.
   - 현재 대상·활성 QR 상태의 fingerprint를 사용자 캐시에 10분간 저장합니다.
   - 반환값의 `summary`가 현재 TEST 기준 `registered 842 / target 827 / excluded 15 / reuse 29 / needsIssue 798`인지 확인합니다.
2. `createBulkQrIssuanceBatchFromStagedPreview()`
   - 10분 안에 실행합니다.
   - 대상이나 활성 QR 상태가 달라졌으면 생성하지 않고 새 미리보기를 요구합니다.
   - 먼저 `생성중` 배치 행을 기록한 뒤 827개 항목 스냅샷을 저장하고 `준비`로 전환합니다.
   - 항목 저장 중 실행이 끊기면 같은 함수를 다시 실행해 기존 배치 ID로 생성을 재개합니다.
3. `processOpenBulkQrIssuanceBatch()`
   - 호출할 때마다 다음 대기 항목을 최대 50개 처리합니다.
   - 실패가 없다면 827개는 최대 17회 호출로 끝납니다.
4. `getOpenBulkQrIssuanceStatus()`
   - 중간에 `pending`, `succeeded`, `reused`, `failed`, `nextProcessingOrder`를 확인합니다.
5. 실패가 있으면 `retryFailedOpenBulkQrIssuance()`을 한 번 실행한 뒤 `processOpenBulkQrIssuanceBatch()`를 다시 실행합니다.
6. 완료 후 `auditQrIssues()`를 실행하고 `duplicateActiveSystemIds`, `duplicateKeys`, `invalidKeyRows`, `masterUrlMismatches`가 모두 비어 있는지 확인합니다.
7. 마지막으로 `refreshLabelPrintSheet()`를 실행해 `전체 827`과 출력 가능 수량을 다시 확인합니다.

### 중단·재개 규칙

- 실행이 중간에 끊기면 같은 `processOpenBulkQrIssuanceBatch()`를 다시 실행합니다.
- 배치 생성 중 끊겨 상태가 `생성중`이면 `createBulkQrIssuanceBatchFromStagedPreview()`를 다시 실행합니다. 새 ID를 만들지 않고 기존 생성을 마칩니다.
- QR은 생성됐지만 체크포인트 저장 전에 끊긴 항목도 다음 실행에서 활성 QR을 찾아 `재사용`하므로 새 키를 중복 생성하지 않습니다.
- `성공`과 `재사용` 행은 다시 처리하지 않습니다.
- `실패` 행은 자동 재시도하지 않으며 `retryFailedOpenBulkQrIssuance()`을 명시적으로 실행해야 합니다.
- 한 환경에는 완료되지 않은 배치를 하나만 허용합니다.
- 배치가 끝날 때까지 `영구 시스템 ID`, `New 비품번호`, `사용여부`를 변경하지 않습니다. 이 값이 달라지면 대상 fingerprint 검증이 실행을 중단합니다.
- 대상 변경으로 기존 배치를 더 이상 재개하지 않을 때는 `cancelOpenBulkQrIssuanceBatch()`로 상태를 `취소`로 닫습니다. 배치·항목 행은 감사 근거로 보존하며 삭제하지 않습니다.
- QR 발급 기록은 전체 시트를 다시 쓰지 않습니다. 변경된 기존 URL 셀과 새 QR 행만 실제 행 위치에 기록해 수식·추가 열·메모 전용 행을 보존합니다.

미리보기 fingerprint는 현재 활성 QR까지 포함해 오래된 미리보기 생성을 차단합니다. 배치에 저장되는 대상 fingerprint는 시스템 ID·비품번호·사용여부만 포함하므로, 배치가 정상적으로 QR을 생성해도 다음 50개 재개를 막지 않습니다.
