const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('web app manifest requires Google login and executes as the deploying account', () => {
  const manifestPath = path.join(__dirname, '..', 'apps-script', 'appsscript.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.deepEqual(manifest.webapp, {
    access: 'ANYONE',
    executeAs: 'USER_DEPLOYING'
  });
});
