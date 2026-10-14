# QR 비품 상세조회 Apps Script

비품 라벨의 32자리 영구 접근키를 받아 `비품마스터`, `비품현재상태`, `전수조사기록`을 읽기 전용으로 조회하는 별도 Apps Script 웹앱입니다.

## 파일 매핑

```text
apps-script-detail/Code.gs             → Code.gs
apps-script-detail/DetailCore.js       → DetailCore.gs
apps-script-detail/DetailRepository.gs → DetailRepository.gs
apps-script-detail/Index.html          → Index.html
apps-script-detail/Styles.html         → Styles.html
apps-script-detail/Client.html         → Client.html
apps-script-detail/appsscript.json     → appsscript.json
```

`DetailCore.js`는 Node 테스트를 위해 저장소에서 `.js`를 사용하며 Apps Script에는 `DetailCore.gs`로 생성합니다.

## 권한과 보안

- Google 계정 로그인 사용자만 접근
- 웹앱은 배포자 권한으로 실행
- Sheets 읽기 전용 범위만 사용
- Drive 접근 및 시트 쓰기 API 없음
- QR 주소에는 순차 비품번호가 아니라 32자리 URL-safe 접근키만 포함
- TEST 프로젝트와 운영 프로젝트의 Script Properties를 별도로 유지

## TEST 프로젝트 설정

독립 Apps Script 프로젝트를 만든 뒤 파일을 모두 저장하고 아래 함수를 한 번 실행합니다.

```javascript
setupApprovedDetailTestRuntime();
```

정상 결과:

```text
environment: TEST
projectRole: TEST
spreadsheetTitle: 강서청소년회관 QR 비품관리 대장_QR개발 테스트 사본
```

운영 프로젝트 초기화는 별도의 프로젝트에서만 다음 확인문구로 실행합니다.

```javascript
setupApprovedDetailProductionRuntime('INITIALIZE_DETAIL_PRODUCTION_PROJECT');
```

## 배포

```text
배포 → 새 배포 → 웹 앱
실행 사용자: 나
액세스 사용자: Google 계정이 있는 모든 사용자
```

처음 생성한 정식 `/exec` URL을 계속 유지합니다. 코드 변경 때는 기존 배포를 새 버전으로 갱신하며 새 URL을 만들지 않습니다.

정식 URL을 테스트 사본의 `라벨설정` 시트에서 아래 항목에 입력합니다.

```text
설정항목: 상세조회배포URL
설정값: https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
```

## 기존 전수조사 프로젝트에 추가할 파일

```text
apps-script/QrCore.js → QrCore.gs
apps-script/QrAdmin.gs → QrAdmin.gs
```

정식 상세조회 URL이 입력된 뒤에만 QR 접근키를 발급합니다.

## 5개 파일럿 비품

| 유형 | 영구 시스템 ID | 비품번호 | 품명 |
|---|---|---|---|
| 정상 | `GSYC-000340` | `2019-F2-10` | 문서 세단기 |
| 위치변경 | `GSYC-000820` | `2022-O-54` | 하비체어 |
| 상태이상 | `GSYC-000817` | `2022-O-51` | 하비체어 |
| 미발견 | `GSYC-000815` | `2018-O-130` | 야외용 원목테이블 |
| 기본정보 일부 공란 | `GSYC-000003` | `2018-B-113` | 사각테이블 |

TEST 전수조사 프로젝트에서 아래 함수로 이 다섯 건만 발급합니다.

```javascript
issueQrAccessKeys({
  systemIds: [
    'GSYC-000340',
    'GSYC-000820',
    'GSYC-000817',
    'GSYC-000815',
    'GSYC-000003'
  ]
});
```

발급 후 다음 감사를 실행합니다.

```javascript
auditQrIssues();
```

기대값:

```text
activeCount: 5
duplicateActiveSystemIds: []
duplicateKeys: []
invalidKeyRows: []
missingMasterIds: []
masterUrlMismatches: []
ok: true
```

## 조회 검증

- 정상 비품: 최신 위치와 정상 판정 표시
- 위치변경 비품: 대장 등록 위치와 마지막 확인 위치를 모두 표시
- 상태이상 비품: 이상 판정과 확인 위치 표시
- 미발견 비품: 미발견 판정과 마지막 유효 위치 표시
- 기본정보 공란 비품: 규격 등 공란을 `정보 없음`으로 표시
- `k` 누락·형식 오류·중지된 키는 안전한 오류 화면 표시
- 조사이력은 최초 10건, 최대 20건 단위로 추가 조회
