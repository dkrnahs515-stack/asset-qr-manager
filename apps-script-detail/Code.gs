function doGet(e) {
  var rawKey = String(e && e.parameter && e.parameter.k || '').trim();
  var validated = validateDetailKey(rawKey);
  var template = HtmlService.createTemplateFromFile('Index');
  template.initialKeyJson = JSON.stringify(validated.ok ? validated.key : '');
  template.initialErrorJson = JSON.stringify(validated.ok ? null : buildDetailError(validated.code));
  template.runtimeJson = JSON.stringify(getDetailRuntimeStatus_());
  return template.evaluate()
    .setTitle('강서청소년회관 비품정보')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function includeDetail_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
