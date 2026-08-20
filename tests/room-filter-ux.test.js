const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'apps-script/Index.html'), 'utf8');

test('room filters include an explicit completed-items view', () => {
  assert.match(html, /completed:items\.filter\(x=>x\.targetType!==['"]미등록비품['"]&&x\.result!==['"]미확인['"]\)\.length/);
  assert.match(html, /filter===['"]completed['"]/);
  assert.match(html, />완료 \$\{counts\.completed\}</);
});

test('typing a search query bypasses the currently selected filter', () => {
  assert.match(html, /const q=search\.trim\(\)\.toLowerCase\(\);const matchesFilter=x=>q\?true:/);
});

test('the all-items filter clearly states that completed items are included', () => {
  assert.match(html, />전체\(완료 포함\) \$\{items\.length\}</);
});
