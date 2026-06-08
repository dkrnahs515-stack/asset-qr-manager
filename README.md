# QR 비품 관리 대장

GitHub Pages에 올려서 사용할 수 있는 정적 웹앱입니다. Firebase Firestore를 데이터베이스로 사용하고, Firebase Authentication 계정으로 로그인한 사용자만 비품 목록을 읽고 수정합니다.

## 주요 기능

- 비품 등록/수정/삭제
- 비품번호, 품명, 카테고리, 위치, 상태, 담당자, 구입일, 금액, 모델명, 시리얼번호, 비고 관리
- 전체 현황 통계: 총 비품, 사용중, 점검 필요, 분실
- 검색/카테고리/상태 필터
- 비품별 QR 생성 및 PNG 다운로드
- 현재 표시 목록 기준 QR 라벨 A4 인쇄
- QR 스캔 후 해당 비품 수정 화면 자동 열기
- CSV 내보내기/가져오기
- 수정 이력 `assetLogs` 컬렉션 기록

## 파일 구조

```text
asset-qr-manager/
├─ index.html
├─ styles.css
├─ app.js
├─ firebase-config.js
├─ firebase-config.example.js
├─ firestore.rules
└─ README.md
```

## Firebase 설정

1. Firebase Console에서 프로젝트를 만듭니다.
2. 웹 앱을 등록합니다.
3. `firebase-config.js`의 값을 Firebase SDK 설정값으로 교체합니다.
4. Authentication > Sign-in method에서 Email/Password를 활성화합니다.
5. Authentication > Users에서 사용할 관리자 계정을 직접 추가합니다.
6. Firestore Database를 생성합니다.
7. Firestore Rules에 `firestore.rules` 내용을 붙여 넣고 게시합니다.

## GitHub Pages 배포

1. GitHub 저장소를 새로 만듭니다.
2. 이 폴더의 파일을 저장소 루트에 업로드합니다.
3. Settings > Pages > Branch를 `main` / root로 설정합니다.
4. 배포된 주소로 접속합니다.
5. QR 스캔은 카메라 권한 때문에 HTTPS 주소에서 안정적으로 작동합니다. GitHub Pages는 HTTPS를 제공합니다.

## CSV 가져오기 형식

첫 줄 헤더는 아래와 같이 사용합니다.

```csv
assetNo,name,category,status,location,manager,purchaseDate,price,model,serial,memo
GSY-2026-001,노트북,전산장비,사용중,3층 사무실,운영지원팀,2026-01-10,1200000,LG Gram,SN1234,충전기 포함
```

같은 `assetNo`가 이미 있으면 기존 비품을 업데이트하고, 없으면 새로 등록합니다.

## 운영 팁

- QR 라벨에는 웹주소와 비품 문서 ID가 들어갑니다. 비품번호를 나중에 바꿔도 기존 QR은 계속 작동합니다.
- 실제 비품에는 `비품번호 + QR`을 함께 붙이면 스캔이 안 될 때도 수기 확인이 가능합니다.
- 공개 저장소에 올릴 경우에도 Firestore Rules와 Authentication을 반드시 적용하세요.
