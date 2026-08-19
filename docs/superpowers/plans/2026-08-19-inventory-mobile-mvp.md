# Inventory Mobile MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스마트폰에서 전수조사를 시작해 842개 비품 스냅샷을 만들고, 층/공간을 탐색한 뒤 비품 하나를 정상 처리하면 Google Sheet 기록·변경이력·진행률이 함께 갱신되는 MVP를 완성한다.

**Architecture:** React 18 UI를 Apps Script HTML Service에서 제공하고 `google.script.run`으로 서버 함수를 호출한다. Sheet I/O는 `apps-script/Code.gs`, 테스트 가능한 순수 계산은 `apps-script/Core.js`로 분리한다.

**Tech Stack:** Google Apps Script V8, Google Sheets, React 18 UMD, Babel Standalone, Node.js built-in test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-19-inventory-mobile-mvp-design.md`

## Global Constraints
- 기존 Firebase 앱 루트 파일은 삭제/덮어쓰기하지 않는다.
- Spreadsheet ID는 `1R5WjwpXtsJwQfIvNnQ_D5PLD6TTLXqTlQ7CSjbUa274`를 사용한다.
- `비품마스터` 영구 시스템 ID는 수정하지 않는다.
- 조사 시작 시 등록 비품 전체를 `미확인` 레코드로 먼저 생성한다.
- 미등록 비품은 진행률 분모에 포함하지 않는다.
- 정상 확인은 추가 확인창 없이 1회 터치로 처리한다.
- 모든 변경 요청은 actionUuid를 가져야 한다.

---

### Task 1: 순수 조사 도메인 로직과 테스트

**Files:**
- Create: `package.json`
- Create: `tests/core.test.js`
- Create: `apps-script/Core.js`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `makeSessionId(year, existingIds)`, `makeRecordId(sessionId, index)`, `buildInventoryRecords(sessionId, assets, errorMap)`, `buildLocationMap(locationRows)`, `aggregateProgress(records, locationMap)`, `computeMetricDelta(previousResult, nextResult)`.

- [ ] **Step 1: Write failing Node tests** for ID generation, initial record state, representative location grouping, progress denominator, and metric deltas.
- [ ] **Step 2: Run `npm test` and verify failure** because `apps-script/Core.js` does not exist.
- [ ] **Step 3: Implement `Core.js` minimally** to satisfy the tests and keep functions Apps Script-global while exporting under Node when `module` exists.
- [ ] **Step 4: Run `npm test` and verify all tests pass.**
- [ ] **Step 5: Commit domain logic.**

### Task 2: Apps Script Sheet adapter

**Files:**
- Create: `apps-script/Code.gs`
- Create: `apps-script/appsscript.json`

**Interfaces:**
- Consumes: Core.js pure functions.
- Produces: `doGet()`, `getBootstrapData()`, `startInventorySession(inspector)`, `getLocationsForFloor(sessionId, floorKey)`, `getAssetsForLocation(sessionId, representativeLocationCode)`, `markAssetNormal(payload)`.

- [ ] **Step 1: Implement header-driven Sheet readers** so column positions are resolved from row 1 rather than hard-coded for source tables.
- [ ] **Step 2: Implement active-session lookup and batch session creation** with `LockService`; write all snapshot rows in one `setValues` call.
- [ ] **Step 3: Implement bootstrap/floor/location aggregation** using Core functions and the `대표위치코드` mapping.
- [ ] **Step 4: Implement normal-confirm mutation** with actionUuid idempotency, record update, change-log append, and session metric delta.
- [ ] **Step 5: Add manifest scopes needed for Spreadsheet access.**

### Task 3: React mobile UI

**Files:**
- Create: `apps-script/Index.html`

**Interfaces:**
- Consumes Apps Script server functions through `google.script.run`.
- Produces views: Home, FloorList, LocationList, AssetList, AssetDetail.

- [ ] **Step 1: Build mobile shell** with sticky header, online indicator, progress card, and bottom navigation.
- [ ] **Step 2: Add inspector-name persistence** in localStorage and session start/resume buttons.
- [ ] **Step 3: Render floor and location progress cards** from bootstrap/server data.
- [ ] **Step 4: Render asset list with `미확인만/전체` filter and text search.**
- [ ] **Step 5: Add asset detail bottom sheet** with large `정상 · 실물 확인` action.
- [ ] **Step 6: On normal confirmation, call `markAssetNormal`, update local UI, show success toast, and return to the asset list.**

### Task 4: Deployment and operator documentation

**Files:**
- Create: `apps-script/README.md`
- Modify: `README.md`

**Interfaces:**
- Documents exact Apps Script file-copy/deploy steps and the current migration status from Firebase to Sheets-backed MVP.

- [ ] **Step 1: Document creating a standalone Apps Script project** and adding `Core.js`, `Code.gs`, `Index.html`, and `appsscript.json`.
- [ ] **Step 2: Document Web App deployment and smartphone verification.**
- [ ] **Step 3: Document first acceptance test:** start session → verify 842 rows → open a room → mark one asset normal → verify record/change log/progress.
- [ ] **Step 4: Update root README without deleting legacy Firebase instructions.**

## Acceptance Criteria
1. `npm test` passes on GitHub Actions.
2. `startInventorySession()` never creates two simultaneous active sessions.
3. With current master data, a new session creates exactly 842 registered-asset records.
4. Every created record begins `미확인` and has blank confirmed-location fields.
5. Floor/location progress treats only `미확인` as incomplete.
6. `미등록발견` never changes the registered-asset progress denominator.
7. Replaying the same `actionUuid` does not duplicate the change log or counters.
8. Mobile UI supports the complete first cycle through `정상 · 실물 확인`.
