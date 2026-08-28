'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('label preview uses exact A4 print contract and hides all controls on paper', () => {
  const preview = read('apps-script/LabelPrintPreview.html');
  assert.match(preview, /@page\s*\{\s*size:\s*A4;\s*margin:\s*0;\s*\}/);
  assert.match(preview, /\.print-page[\s\S]*width:\s*210mm[\s\S]*height:\s*297mm/);
  assert.match(preview, /@media\s+print[\s\S]*\.screen-only[\s\S]*display:\s*none\s*!important/);
  assert.match(preview, /window\.print\(\)/);
});

test('label geometry is rendered from server slot millimeters without an outer border', () => {
  const preview = read('apps-script/LabelPrintPreview.html');
  assert.match(preview, /item\.slot\.xMm/);
  assert.match(preview, /item\.slot\.topMm/);
  assert.match(preview, /settings\.labelWidthMm/);
  assert.match(preview, /settings\.labelHeightMm/);
  assert.match(preview, /className\s*=\s*['"]print-label['"]/);
  assert.match(preview, /\.print-label\s*\{[^}]*border:\s*none/);
});

test('approved label content and typography remain fixed', () => {
  const preview = read('apps-script/LabelPrintPreview.html');
  assert.match(preview, /조사 일자/);
  assert.match(preview, /관리책임자/);
  assert.match(preview, /정\s*\$\{settings\.primaryManager\}/);
  assert.match(preview, /부\s*\$\{settings\.secondaryManager\}/);
  assert.match(preview, /9\.3pt/);
  assert.match(preview, /7\.2/);
  assert.match(preview, /0\.1/);
  assert.match(preview, /light-divider/);
  assert.match(preview, /TEST PILOT/);
  assert.match(preview, /(?:model\.)?environment\s*===\s*['"]TEST['"]/);
});

test('QR visual is 20mm-class, generated as local scalable SVG, and never sent to an external QR service', () => {
  const preview = read('apps-script/LabelPrintPreview.html');
  const vendor = read('apps-script/QrVendor.html');
  assert.match(preview, /includeHtml_\('QrVendor'\)/);
  assert.match(preview, /qrcode\(/);
  assert.match(preview, /createSvgTag/);
  assert.match(preview, /settings\.qrSizeMm/);
  assert.match(vendor, /qrcode-generator 1\.4\.4/);
  assert.match(vendor, /var qrcode=/);
  assert.doesNotMatch(preview + vendor, /quickchart|api\.qrserver|chart\.googleapis|cdnjs|unpkg|jsdelivr/);
  assert.doesNotMatch(preview + vendor, /UrlFetchApp/);
});

test('preview loads immutable server model and renders all 24-slot pages', () => {
  const preview = read('apps-script/LabelPrintPreview.html');
  assert.match(preview, /google\.script\.run/);
  assert.match(preview, /getLabelPrintPreviewModel/);
  assert.match(preview, /PREVIEW_TOKEN/);
  assert.match(preview, /model\.pages/);
  assert.match(preview, /page\.forEach/);
});

test('print toolbar contains approved instructions and controls', () => {
  const preview = read('apps-script/LabelPrintPreview.html');
  for (const text of [
    'Formtec LS3106',
    '배율 100%',
    '실제 크기',
    '여백 없음',
    '머리글/바닥글 끄기',
    '인쇄 / PDF 저장',
    '출력 완료 반영',
    '닫기'
  ]) assert.ok(preview.includes(text), `missing preview text: ${text}`);
  assert.match(preview, /선택.*페이지/);
});

test('vendored QR library has pinned notice and license documentation', () => {
  const vendor = read('apps-script/QrVendor.html');
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(vendor, /qrcode-generator 1\.4\.4/);
  assert.match(vendor, /Kazuhiko Arase/);
  assert.match(vendor, /MIT/);
  assert.match(notices, /qrcode-generator/);
  assert.match(notices, /1\.4\.4/);
  assert.match(notices, /Kazuhiko Arase/);
  assert.match(notices, /MIT License/);
  assert.match(notices, /Permission is hereby granted, free of charge/);
});
