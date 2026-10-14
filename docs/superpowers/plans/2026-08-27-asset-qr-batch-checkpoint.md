# Asset QR Batch Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발급 대상 827개를 50개 단위로 안전하게 QR 발급하고 중단·실패 후 재개할 수 있는 Apps Script 배치 실행기를 만든다.

**Architecture:** 순수 JavaScript 코어가 대상 스냅샷, fingerprint 입력, 50개 선택, 결과 상태 전이를 담당하고 Apps Script 어댑터가 Google Sheets 영속화와 Script Lock을 담당한다. 기존 단건 발급기는 lock 없는 내부 함수로 분리해 배치 실행기와 동일한 멱등 발급 경로를 공유한다.

**Tech Stack:** Google Apps Script V8, Google Sheets, Node.js 20 `node:test`

**Spec:** `docs/superpowers/specs/2026-08-27-asset-qr-batch-checkpoint-design.md`

## Global Constraints

- 자동 발급 대상은 `비품마스터.사용여부 === '사용'`인 행만 포함한다.
- 실행당 처리 수는 기본값과 최대값 모두 50개다.
- 기존 활성 QR은 재발급하지 않고 재사용한다.
- 외부 QR 서비스나 새 npm 의존성을 추가하지 않는다.
- TEST와 PRODUCTION은 기존 RuntimeConfig 역할 잠금을 그대로 사용한다.
- 기존 `feature/asset-current-state` 기준 동작과 155개 테스트를 회귀시키지 않는다.

---

### Task 1: Pure batch snapshot and checkpoint core

**Files:**
- Create: `apps-script/QrBatchCore.js`
- Create: `tests/qr-batch-core.test.js`

**Interfaces:**
- Consumes: 마스터 객체 `{systemId,newAssetNo,name,usageStatus,rowNumber}`와 QR 이력 객체 `{systemId,accessKey,accessKeyStatus,lookupUrl}`
- Produces: `buildQrBatchSnapshot`, `buildQrBatchCanonical`, `buildQrBatchTargetCanonical`, `selectQrBatchItems`, `applyQrBatchResults`, `resetFailedQrBatchItems`, `summarizeQrBatchItems`, `nextQrBatchId`

- [x] **Step 1: Write failing snapshot tests**

  827개 사용 비품과 15개 확인필요 비품 fixture에서 대상·제외 수, 기존 활성 QR 재사용 수, 신규발급 수를 literal로 검증한다. 영구 시스템 ID 중복과 활성 QR 중복은 예외를 기대한다.

- [x] **Step 2: Run snapshot tests and verify RED**

  Run: `node --test tests/qr-batch-core.test.js`

  Expected: FAIL because `apps-script/QrBatchCore.js` does not exist.

- [x] **Step 3: Implement minimal snapshot functions**

  `buildQrBatchSnapshot(masterAssets, issueRows)`가 마스터 행 순서대로 사용 비품만 고정하고 `신규발급` 또는 `재사용`을 분류하도록 구현한다. `buildQrBatchCanonical(snapshot)`은 시스템 ID, 비품번호, 사용여부, 활성 키와 URL을 포함하는 결정적 문자열을 만든다.

- [x] **Step 4: Run snapshot tests and verify GREEN**

  Run: `node --test tests/qr-batch-core.test.js`

  Expected: PASS.

- [x] **Step 5: Write failing checkpoint tests**

  최대 50개 선택, 성공·재사용 건너뛰기, 실패의 명시적 재시도, 시도 횟수 증가, 다음 날짜별 배치 ID를 검증한다.

- [x] **Step 6: Run checkpoint tests and verify RED**

  Run: `node --test tests/qr-batch-core.test.js`

  Expected: FAIL because checkpoint functions are not implemented.

- [x] **Step 7: Implement checkpoint functions and verify GREEN**

  Run: `node --test tests/qr-batch-core.test.js`

  Expected: PASS.

### Task 2: Batch persistence schema

**Files:**
- Modify: `apps-script/SchemaSetup.gs`
- Modify: `tests/schema-setup.test.js`

**Interfaces:**
- Produces: `QR_BATCH_HEADERS`, `QR_BATCH_ITEM_HEADERS`, `QR대량발급배치`, `QR대량발급항목`

- [x] **Step 1: Write failing schema tests**

  두 신규 시트의 정확한 헤더, 설치기의 idempotent 생성, 상태 데이터 검증 목록을 검사한다.

- [x] **Step 2: Run schema tests and verify RED**

  Run: `node --test tests/schema-setup.test.js`

  Expected: FAIL because batch schemas are absent.

- [x] **Step 3: Add batch schemas**

  `installAssetQrSchema()`가 기존 데이터를 지우지 않고 두 시트를 생성·보강하고 `처리상태`와 배치 `상태` 유효성 검사를 설정하도록 구현한다.

- [x] **Step 4: Run schema tests and verify GREEN**

  Run: `node --test tests/schema-setup.test.js`

  Expected: PASS.

### Task 3: Shared idempotent issuance path

**Files:**
- Modify: `apps-script/QrAdmin.gs`
- Modify: `tests/qr-admin-source.test.js`

**Interfaces:**
- Produces: `issueQrAccessKeysUnlocked_(ss, systemIds, baseUrl)`
- Preserves: `issueQrAccessKeys(request)` public behavior and Script Lock

- [x] **Step 1: Write failing source test**

  공개 함수가 lock을 획득한 뒤 공용 내부 함수로 위임하고 내부 함수가 기존 exact lookup·재사용·마스터 URL 갱신 동작을 보존하는지 검사한다.

- [x] **Step 2: Run source test and verify RED**

  Run: `node --test tests/qr-admin-source.test.js`

  Expected: FAIL because the unlocked helper is absent.

- [x] **Step 3: Extract minimal shared function**

  기존 map 처리 본문을 내부 함수로 이동하고 공개 함수의 반환 계약을 유지한다.

- [x] **Step 4: Run QR admin tests and verify GREEN**

  Run: `node --test tests/qr-admin.test.js tests/qr-admin-source.test.js`

  Expected: PASS.

### Task 4: Apps Script batch adapter

**Files:**
- Create: `apps-script/QrBatch.gs`
- Create: `tests/qr-batch-source.test.js`
- Modify: `tests/syntax.test.js`

**Interfaces:**
- Consumes: Task 1 core functions, Task 2 sheets, Task 3 `issueQrAccessKeysUnlocked_`
- Produces: `previewBulkQrIssuance`, `createBulkQrIssuanceBatch`, `processBulkQrIssuanceBatch`, `retryFailedBulkQrIssuance`, `getBulkQrIssuanceStatus`

- [x] **Step 1: Write failing entry-point and safety tests**

  Script Lock, fingerprint SHA-256, 열린 배치 차단, 50개 선택, 환경 기록, 공용 멱등 발급 호출, 실패분 재시도 함수와 syntax 목록을 검사한다.

- [x] **Step 2: Run adapter tests and verify RED**

  Run: `node --test tests/qr-batch-source.test.js tests/syntax.test.js`

  Expected: FAIL because `QrBatch.gs` is absent.

- [x] **Step 3: Implement sheet readers and writers**

  헤더 기반으로 배치·항목 행을 읽고 쓰며, 항목 827개를 한 번에 append하고 상태 집계를 배치 행에 반영한다.

- [x] **Step 4: Implement DRY RUN and batch creation**

  현재 runtime, 라벨 상세조회 URL, 마스터·QR 이력을 검증하고 fingerprint 일치 시에만 준비 상태 배치를 만든다.

- [x] **Step 5: Implement 50-item process and retry**

  대기 항목 최대 50개를 공용 발급 함수로 처리해 `성공`, `재사용`, `실패`로 저장한다. 실패 재시도는 해당 배치의 실패 행만 `대기`로 되돌린다.

- [x] **Step 6: Run adapter tests and verify GREEN**

  Run: `node --test tests/qr-batch-source.test.js tests/syntax.test.js`

  Expected: PASS.

### Task 5: Operations documentation and full verification

**Files:**
- Modify: `apps-script/README.md`
- Modify: `docs/superpowers/plans/2026-08-27-asset-qr-batch-checkpoint.md`

**Interfaces:**
- Produces: TEST 실행 순서와 복구 절차

- [x] **Step 1: Document the exact TEST sequence**

  `installAssetQrSchema()` → `previewBulkQrIssuance()` → fingerprint 확인 → `createBulkQrIssuanceBatch(...)` → `processBulkQrIssuanceBatch(...)` 반복 → 실패분 재시도 → 최종 audit 순서를 기록한다.

- [x] **Step 2: Run focused tests**

  Run: `node --test tests/qr-batch-core.test.js tests/qr-batch-source.test.js tests/qr-admin-source.test.js tests/schema-setup.test.js tests/syntax.test.js`

  Expected: all focused tests pass.

- [x] **Step 3: Run the complete suite**

  Run: `npm test`

  Expected: all tests pass with zero failures and zero skipped tests.

- [x] **Step 4: Review the diff and worktree state**

  Run: `git diff --check && git status --short && git diff --stat`

  Expected: no whitespace errors and only planned files changed.

### Task 6: Pre-PR review hardening

**Files:**
- Modify: `apps-script/QrAdmin.gs`
- Modify: `apps-script/QrBatch.gs`
- Modify: `apps-script/QrBatchCore.js`
- Modify: `apps-script/SchemaSetup.gs`
- Create: `tests/qr-persistence-adapter.test.js`

- [x] Preserve formulas, extra columns, memo-only rows, and physical row positions by writing only changed QR/master cells and appending new ledger rows.
- [x] Persist `생성중` before item creation and resume the same batch ID after an interrupted item write.
- [x] Add locked, environment-validated `취소` transition without deleting checkpoint evidence.
- [x] Reuse the already validated master/QR read context during each 50-item process call.
- [x] Distinguish clean `진행중` checkpoints from failure-driven `일시중단` and support batch IDs beyond sequence 999.
- [x] Add executable adapter tests with fault injection and formula/extra-column preservation fixtures.
