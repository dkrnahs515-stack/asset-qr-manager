const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateDetailKey,
  buildAssetDetailModel,
  buildDetailError,
  normalizeWon,
  formatLocation,
  resolveDetailRuntimeConfig
} = require('../apps-script-detail/DetailCore.js');

const VALID_KEY = 'AbcdEFGHijklMNOPqrstUVWXyz01_234';

const DETAIL_PROPERTIES = {
  ASSET_DETAIL_APP_ENV: 'TEST',
  ASSET_DETAIL_PROJECT_ROLE: 'TEST',
  ASSET_DETAIL_TEST_SPREADSHEET_ID: 'TEST_SHEET',
  ASSET_DETAIL_PRODUCTION_SPREADSHEET_ID: 'PRODUCTION_SHEET'
};

test('detail key validation accepts only 32-character URL-safe keys', () => {
  assert.deepEqual(validateDetailKey(VALID_KEY), { ok: true, key: VALID_KEY, code: '' });
  assert.deepEqual(validateDetailKey(''), { ok: false, key: '', code: 'MISSING_KEY' });
  assert.deepEqual(validateDetailKey('GSYC-000001'), { ok: false, key: '', code: 'INVALID_KEY' });
});

test('detail model distinguishes official and last-confirmed locations', () => {
  const model = buildAssetDetailModel({
    systemId: 'GSYC-000001',
    newAssetNo: '2015-B-16',
    name: '일체형 컴퓨터',
    spec: '22V240-LT23K(LG)',
    quantity: 1,
    unit: '개',
    unitPrice: '₩609,420.00',
    acquisitionAmount: '₩609,420.00',
    purchaseYear: '2015',
    usefulLife: '5',
    floor: '지하 1층',
    spaceName: '창고 1',
    locationCode: 'LOC-001'
  }, {
    currentFloor: '1층',
    currentSpaceName: '로비',
    currentLocationCode: 'LOC-019',
    locationSource: '전수조사',
    currentResult: '위치변경',
    lastLocationChangedAt: '2026-08-21T02:00:00Z',
    lastPhysicalConfirmedAt: '2026-08-21T02:00:00Z',
    lastPhysicalConfirmedBy: '이건희',
    latestSessionName: '2026년 정기 전수조사 1차',
    latestJudgedAt: '2026-08-21T02:00:00Z',
    masterApplied: 'N',
    syncStatus: '정상'
  }, []);

  assert.equal(model.location.mismatch, true);
  assert.equal(model.location.registered, '지하 1층 > 창고 1');
  assert.equal(model.location.current, '1층 > 로비');
  assert.equal(model.location.source, '전수조사');
  assert.equal(model.basic.unitPrice, '609,420원');
  assert.equal(model.basic.acquisitionAmount, '609,420원');
  assert.equal(model.basic.quantity, '1개');
});

test('Google Sheets serial dates render as the correct 2026 instant instead of 1970', () => {
  const serial = 46253.735645925924;
  const model = buildAssetDetailModel({
    systemId: 'GSYC-000820',
    newAssetNo: '2022-O-54',
    name: '하비체어',
    locationCode: 'LOC-046',
    floor: '외부',
    spaceName: '자갈밭'
  }, {
    currentLocationCode: 'LOC-019',
    currentFloor: '1층',
    currentSpaceName: '로비',
    currentResult: '위치변경',
    lastLocationChangedAt: serial,
    lastPhysicalConfirmedAt: serial,
    latestJudgedAt: serial,
    syncStatus: '정상'
  }, []);

  assert.equal(model.location.changedAt, '2026-08-19T08:39:20.608Z');
  assert.equal(model.latest.physicalConfirmedAt, '2026-08-19T08:39:20.608Z');
  assert.equal(model.latest.judgedAt, '2026-08-19T08:39:20.608Z');
});

test('missing fields render as information unavailable instead of undefined', () => {
  const model = buildAssetDetailModel({ systemId: 'GSYC-000002', newAssetNo: '', name: '' }, null, []);
  assert.equal(model.basic.newAssetNo, '정보 없음');
  assert.equal(model.basic.name, '정보 없음');
  assert.equal(model.basic.spec, '정보 없음');
  assert.equal(model.basic.quantity, '정보 없음');
  assert.equal(model.location.registered, '정보 없음');
});

test('state sync errors fall back to the official location with a warning', () => {
  const model = buildAssetDetailModel({
    systemId: 'GSYC-000003',
    newAssetNo: '2020-F1-1',
    name: '테스트 비품',
    locationCode: 'LOC-010',
    floor: '1층',
    spaceName: '사무실'
  }, {
    currentLocationCode: 'LOC-999',
    currentFloor: '옥상',
    currentSpaceName: '알 수 없음',
    syncStatus: '오류',
    syncError: '재계산 필요'
  }, []);

  assert.equal(model.location.current, '1층 > 사무실');
  assert.equal(model.location.mismatch, false);
  assert.equal(model.location.syncWarning, '현재 위치 동기화 확인이 필요합니다');
});

test('safe user-facing errors are explicit', () => {
  assert.deepEqual(buildDetailError('INVALID_KEY'), {
    code: 'INVALID_KEY',
    title: '유효하지 않은 QR입니다',
    message: '비품에 부착된 QR을 다시 스캔해 주세요.'
  });
  assert.equal(buildDetailError('INACTIVE_KEY').title, '사용이 중지된 QR입니다');
  assert.equal(buildDetailError('ASSET_NOT_FOUND').code, 'ASSET_NOT_FOUND');
});

test('won and location formatting remove source noise', () => {
  assert.equal(normalizeWon('₩609,420.00'), '609,420원');
  assert.equal(normalizeWon(1234.6), '1,235원');
  assert.equal(normalizeWon(''), '정보 없음');
  assert.equal(formatLocation('2층', '스마트 사무실', ''), '2층 > 스마트 사무실');
});

test('detail runtime configuration is fail-closed and role-locked', () => {
  const config = resolveDetailRuntimeConfig(DETAIL_PROPERTIES);
  assert.equal(config.environment, 'TEST');
  assert.equal(config.spreadsheetId, 'TEST_SHEET');
  assert.equal(config.isProduction, false);

  assert.throws(() => resolveDetailRuntimeConfig({ ...DETAIL_PROPERTIES, ASSET_DETAIL_PROJECT_ROLE: '' }), /PROJECT_ROLE/);
  assert.throws(() => resolveDetailRuntimeConfig({ ...DETAIL_PROPERTIES, ASSET_DETAIL_PROJECT_ROLE: 'PRODUCTION' }), /다릅니다/);
  assert.throws(() => resolveDetailRuntimeConfig({
    ...DETAIL_PROPERTIES,
    ASSET_DETAIL_TEST_SPREADSHEET_ID: 'SAME',
    ASSET_DETAIL_PRODUCTION_SPREADSHEET_ID: 'SAME'
  }), /서로 달라야/);
});