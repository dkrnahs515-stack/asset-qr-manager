function detailJsonForHtml_(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function doGet(e) {
  var rawKey = String(e && e.parameter && e.parameter.k || '').trim();
  var validated = validateDetailKey(rawKey);
  var template = HtmlService.createTemplateFromFile('Index');
  template.initialKeyJson = detailJsonForHtml_(validated.ok ? validated.key : '');
  template.initialErrorJson = detailJsonForHtml_(validated.ok ? null : buildDetailError(validated.code));
  template.runtimeJson = detailJsonForHtml_(getDetailRuntimeStatus_());
  return template.evaluate()
    .setTitle('강서청소년회관 비품정보')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function includeDetail_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
