# 강서청소년회관 비품 관리 시스템

이 저장소에는 두 가지 구현이 함께 있습니다.

1. **Google Sheets 연동 모바일 전수조사 MVP** — 현재 개발 중인 주 구현
2. **Firebase QR 비품관리 정적 앱** — 기존 구현, 보존 중

## Google Sheets 모바일 전수조사 MVP

`apps-script/` 폴더에 Google Sheets를 기준 DB로 사용하는 모바일 현장 전수조사 기능이 있습니다.

### 목표

스마트폰 하나로 기관을 이동하면서 아래 흐름을 처리합니다.

```text
전수조사 시작
→ 비품마스터 전체 스냅샷 생성
→ 층 선택
→ 공간 선택
→ 비품 선택
→ 정상 · 실물 확인
→ 전수조사기록/변경이력 저장
→ 진행률 즉시 반영
```

### 현재 1차 MVP 구현 범위

- React 18 모바일 UI
- Google Apps Script HTML Service
- Google Sheets 연동
- 활성 전수조사 세션 생성/이어하기
- 비품마스터 전체 일괄 스냅샷
- 층/공간별 진행률
- 공간별 비품 목록 및 검색
- 미확인만 보기
- 비품 상세보기
- 정상 확인 1-Tap 처리
- 변경이력 기록
- actionUuid 기반 중복 요청 방지
- Node 순수 로직 테스트

상세 배포 및 검증 절차는 [`apps-script/README.md`](apps-script/README.md)를 참고합니다.

### 신규 구조

```text
asset-qr-manager/
├─ apps-script/
│  ├─ Core.js
│  ├─ Code.gs
│  ├─ Index.html
│  ├─ appsscript.json
│  └─ README.md
├─ apps-script-detail/
│  ├─ Code.gs
│  ├─ DetailCore.js
│  ├─ DetailRepository.gs
│  ├─ Index.html
│  ├─ Styles.html
│  ├─ Client.html
│  ├─ appsscript.json
│  └─ README.md
├─ tests/
├─ docs/superpowers/
│  ├─ specs/
│  └─ plans/
├─ package.json
└─ .github/workflows/ci.yml
```

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

## QR 비품 상세조회 5개 파일럿

QR 상세조회는 기존 전수조사 앱과 분리된 **읽기 전용 Apps Script 웹앱**입니다. 외부 URL에는 순차적인 `GSYC-000001` 대신 32자리 영구 접근키만 노출합니다.

```text
비품 본체 QR
→ https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?k=<32자리 접근키>
→ Google 로그인
→ 비품마스터 기본정보 + 비품현재상태 + 조사이력 조회
```

기존 전수조사 프로젝트에는 다음 두 파일을 추가합니다.

```text
apps-script/QrCore.js  → QrCore.gs
apps-script/QrAdmin.gs → QrAdmin.gs
```

별도 상세조회 프로젝트의 파일 매핑은 다음과 같습니다.

```text
apps-script-detail/Code.gs             → Code.gs
apps-script-detail/DetailCore.js       → DetailCore.gs
apps-script-detail/DetailRepository.gs → DetailRepository.gs
apps-script-detail/Index.html          → Index.html
apps-script-detail/Styles.html         → Styles.html
apps-script-detail/Client.html         → Client.html
apps-script-detail/appsscript.json     → appsscript.json
```

상세조회 프로젝트는 `spreadsheets.readonly` 권한만 사용하며 Drive 접근이나 시트 쓰기 기능을 포함하지 않습니다. TEST 프로젝트와 운영 프로젝트는 Script Properties의 프로젝트 역할로 서로 분리합니다.

파일럿 대상은 다음 다섯 비품입니다.

| 유형 | 영구 시스템 ID | 비품번호 | 품명 |
|---|---|---|---|
| 정상 | `GSYC-000340` | `2019-F2-10` | 문서 세단기 |
| 위치변경 | `GSYC-000820` | `2022-O-54` | 하비체어 |
| 상태이상 | `GSYC-000817` | `2022-O-51` | 하비체어 |
| 미발견 | `GSYC-000815` | `2018-O-130` | 야외용 원목테이블 |
| 기본정보 일부 공란 | `GSYC-000003` | `2018-B-113` | 사각테이블 |

정식 상세조회 `/exec` URL을 TEST `라벨설정.상세조회배포URL`에 입력한 뒤 이 다섯 건만 `issueQrAccessKeys()`로 발급합니다. 842개 전체 발급은 상세조회·인증·오류화면·라벨 파일럿이 모두 통과한 뒤 진행합니다.

자세한 배포와 파일럿 검증 절차는 [`apps-script-detail/README.md`](apps-script-detail/README.md)를 참고합니다.

---

# 기존 Firebase QR 비품 관리 대장

루트의 `index.html`, `styles.css`, `app.js`, `firebase-config.js`, `firestore.rules`는 기존 Firebase 기반 정적 웹앱입니다. 신규 Google Sheets 전수조사 MVP가 안정화될 때까지 삭제하지 않습니다.

기존 앱은 GitHub Pages에 올려서 사용할 수 있는 정적 웹앱이며 Firebase Firestore를 데이터베이스로 사용하고 Firebase Authentication 계정으로 로그인한 사용자만 비품 목록을 읽고 수정하도록 설계되었습니다.

## 기존 주요 기능

- 비품 등록/수정/삭제
- 비품번호, 품명, 카테고리, 위치, 상태, 담당자, 구입일, 금액, 모델명, 시리얼번호, 비고 관리
- 전체 현황 통계: 총 비품, 사용중, 점검 필요, 분실
- 검색/카테고리/상태 필터
- 비품별 QR 생성 및 PNG 다운로드
- 현재 표시 목록 기준 QR 라벨 A4 인쇄
- QR 스캔 후 해당 비품 수정 화면 자동 열기
- CSV 내보내기/가져오기
- 수정 이력 `assetLogs` 컬렉션 기록

## 기존 Firebase 설정

1. Firebase Console에서 프로젝트를 만듭니다.
2. 웹 앱을 등록합니다.
3. `firebase-config.js`의 값을 Firebase SDK 설정값으로 교체합니다.
4. Authentication > Sign-in method에서 Email/Password를 활성화합니다.
5. Authentication > Users에서 사용할 관리자 계정을 직접 추가합니다.
6. Firestore Database를 생성합니다.
7. Firestore Rules에 `firestore.rules` 내용을 붙여 넣고 게시합니다.

## 기존 GitHub Pages 배포

1. Settings > Pages > Branch를 `main` / root로 설정합니다.
2. 배포된 주소로 접속합니다.
3. QR 스캔은 카메라 권한 때문에 HTTPS 주소에서 사용합니다.

## 기존 CSV 가져오기 형식

```csv
assetNo,name,category,status,location,manager,purchaseDate,price,model,serial,memo
GSY-2026-001,노트북,전산장비,사용중,3층 사무실,운영지원팀,2026-01-10,1200000,LG Gram,SN1234,충전기 포함
```

같은 `assetNo`가 이미 있으면 기존 비품을 업데이트하고, 없으면 새로 등록합니다.
