const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const DETAIL_DIR = 'apps-script-detail';

function readRequired(name) {
  const path = `${DETAIL_DIR}/${name}`;
  assert.ok(fs.existsSync(path), `${path} must exist`);
  return fs.readFileSync(path, 'utf8');
}

test('detail project has readonly spreadsheet scope, login-only webapp access, and no mutation APIs', () => {
  const allSource = ['Code.gs', 'DetailRepository.gs'].map(readRequired).join('\n');
  const manifest = JSON.parse(readRequired('appsscript.json'));

  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  assert.deepEqual(manifest.webapp, { access: 'ANYONE', executeAs: 'USER_DEPLOYING' });
  assert.doesNotMatch(allSource, /\.setValue\(|\.setValues\(|appendRow\(|deleteRow\(|deleteRows\(|DriveApp|LockService/);
});

test('readonly detail repository uses the Advanced Sheets service instead of SpreadsheetApp', () => {
  const source = readRequired('DetailRepository.gs');
  const manifest = JSON.parse(readRequired('appsscript.json'));
  const services = manifest.dependencies && manifest.dependencies.enabledAdvancedServices || [];

  assert.deepEqual(services, [{ userSymbol: 'Sheets', serviceId: 'sheets', version: 'v4' }]);
  assert.doesNotMatch(source, /SpreadsheetApp/);
  assert.match(source, /Sheets\.Spreadsheets\.get/);
  assert.match(source, /Sheets\.Spreadsheets\.Values\.get/);
  assert.match(source, /valueRenderOption:\s*'UNFORMATTED_VALUE'/);
  assert.match(source, /dateTimeRenderOption:\s*'SERIAL_NUMBER'/);
});

test('current-state date serials are normalized before building the detail model', () => {
  const source = readRequired('DetailRepository.gs');
  const context = { console };
  vm.runInNewContext(source, context);

  assert.equal(
    context.detailDateIso_(46253.735645925924),
    '2026-08-19T08:39:20.608Z'
  );

  const currentStateReader = source
    .split('function readDetailCurrentState_')[1]
    .split('\nfunction detailDateTimestamp_')[0];
  assert.match(currentStateReader, /latestJudgedAt:\s*detailDateIso_\(/);
  assert.match(currentStateReader, /lastPhysicalConfirmedAt:\s*detailDateIso_\(/);
  assert.match(currentStateReader, /lastLocationChangedAt:\s*detailDateIso_\(/);
});

test('detail server validates exact keys, exact system IDs, and paginates history', () => {
  const source = ['Code.gs', 'DetailRepository.gs'].map(readRequired).join('\n');

  assert.match(source, /function getAssetDetailByKey\(key, historyLimit\)/);
  assert.match(source, /function getAssetHistoryByKey\(key, offset, limit\)/);
  assert.match(source, /function detailExactRows_/);
  assert.match(source, /function readActiveQrIssueByKey_/);
  assert.match(source, /Math\.min\(20/);
});

test('detail runtime is Script Property based and locked to a separate TEST or PRODUCTION project role', () => {
  const source = readRequired('DetailRepository.gs');
  assert.match(source, /PropertiesService\.getScriptProperties\(\)/);
  assert.match(source, /function setupApprovedDetailTestRuntime\(\)/);
  assert.match(source, /function setupApprovedDetailProductionRuntime\(confirmation\)/);
  assert.match(source, /ASSET_DETAIL_PROJECT_ROLE/);
  assert.match(source, /INITIALIZE_DETAIL_PRODUCTION_PROJECT/);
});

test('doGet whitelists the URL key and escapes all JSON before embedding it into HTML', () => {
  const source = readRequired('Code.gs');
  assert.match(source, /validateDetailKey\(rawKey\)/);
  assert.match(source, /template\.initialKeyJson\s*=\s*detailJsonForHtml_/);
  assert.match(source, /template\.initialErrorJson\s*=\s*detailJsonForHtml_/);
  assert.match(source, /template\.runtimeJson\s*=\s*detailJsonForHtml_/);
  assert.doesNotMatch(source, /template\.initialKey\s*=\s*JSON\.stringify\(String\(e/);

  const context = {};
  vm.runInNewContext(source, context);
  const escaped = context.detailJsonForHtml_({
    title: '</script><script>alert(1)</script>&',
    separators: '\u2028\u2029'
  });

  assert.doesNotMatch(escaped, /<\/script>|<script>|&/);
  assert.match(escaped, /\\u003c\/script\\u003e/);
  assert.match(escaped, /\\u0026/);
  assert.match(escaped, /\\u2028/);
  assert.match(escaped, /\\u2029/);
});

test('detail UI contains required sections, renders sheet values with textContent, and has no edit controls', () => {
  const html = ['Index.html', 'Styles.html', 'Client.html'].map(readRequired).join('\n');
  for (const text of [
    '비품번호', '품명', '규격', '수량', '단가', '취득금액', '구입연도', '내용연수',
    '마지막 확인 위치', '최근 조사', '조사이력'
  ]) {
    assert.match(html, new RegExp(text));
  }
  assert.match(html, /textContent/);
  assert.doesNotMatch(html, /innerHTML\s*=/);
  assert.doesNotMatch(html, />\s*(저장|수정하기|삭제)\s*</);
});

test('detail server and client JavaScript parse successfully', () => {
  const server = ['DetailCore.js', 'Code.gs', 'DetailRepository.gs'].map(readRequired).join('\n');
  assert.doesNotThrow(() => new vm.Script(server));

  const client = readRequired('Client.html')
    .replace(/^<script>/, '')
    .replace(/<\/script>\s*$/, '');
  assert.doesNotThrow(() => new vm.Script(client));
});