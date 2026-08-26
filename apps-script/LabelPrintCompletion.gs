function completeLabelPrintBatch(request) {
  request = request || {};
  var token = String(request.token || '').trim();
  if (!token) throw new Error('라벨 미리보기 토큰이 필요합니다.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var snapshot = loadLabelPrintPreviewSnapshot_(token);
    var config = getRuntimeConfig_();
    if (String(snapshot.environment || '') !== String(config.environment || '')) {
      throw new Error('미리보기 생성 환경과 현재 실행 환경이 다릅니다.');
    }

    var ss = getSpreadsheet_();
    var issueMap = groupLabelPrintIssuesBySystemId_(readAllQrIssueRows_(ss));
    var printedAt = new Date();
    var printSettings = snapshot.printSettings || {};
    var results = [];
    var updated = 0;
    var skipped = 0;
    var failed = 0;

    (snapshot.items || []).forEach(function (item) {
      try {
        var activeRows = (issueMap[item.systemId] || []).filter(function (issue) {
          return String(issue.accessKeyStatus || '').trim() === '사용';
        });
        if (activeRows.length !== 1) {
          throw new Error(activeRows.length ? '현재 활성 QR 중복' : '현재 활성 QR 없음');
        }

        var issue = activeRows[0];
        if (String(issue.accessKey || '').trim() !== String(item.accessKey || '').trim()) {
          throw new Error('미리보기 이후 QR 접근키가 변경되었습니다.');
        }
        if (String(issue.lookupUrl || '').trim() !== String(item.qrUrl || '').trim()) {
          throw new Error('미리보기 이후 QR URL이 변경되었습니다.');
        }

        var patch = buildLabelPrintCompletionPatch(issue, {
          batchId: snapshot.batchId,
          printType: item.printType,
          labelType: printSettings.labelType,
          labelVersion: printSettings.labelVersion,
          primaryManager: printSettings.primaryManager,
          secondaryManager: printSettings.secondaryManager,
          managerVersion: printSettings.managerVersion,
          inspectionDate: item.inspectionDate,
          printedAt: printedAt
        });

        if (patch.duplicate) {
          skipped += 1;
          results.push({
            systemId: item.systemId,
            newAssetNo: item.newAssetNo,
            ok: true,
            skipped: true,
            message: '이미 같은 출력 배치가 반영되었습니다.'
          });
          return;
        }

        issue.issueStatus = patch.issueStatus;
        issue.labelType = patch.labelType;
        issue.labelVersion = patch.labelVersion;
        issue.printedPrimaryManager = patch.printedPrimaryManager;
        issue.printedSecondaryManager = patch.printedSecondaryManager;
        issue.managerVersion = patch.managerVersion;
        issue.labelInspectionDate = patch.labelInspectionDate;
        issue.lastPrintedAt = patch.lastPrintedAt;
        issue.reprintRequired = patch.reprintRequired;
        issue.reprintReason = patch.reprintReason;
        issue.reprintCount = patch.reprintCount;
        issue.lastPrintBatchId = patch.lastPrintBatchId;
        updateQrIssue_(ss, issue);

        updated += 1;
        results.push({
          systemId: item.systemId,
          newAssetNo: item.newAssetNo,
          ok: true,
          skipped: false,
          message: '출력 완료 반영'
        });
      } catch (error) {
        failed += 1;
        results.push({
          systemId: item.systemId,
          newAssetNo: item.newAssetNo,
          ok: false,
          skipped: false,
          error: String(error && error.message || error)
        });
      }
    });

    return {
      batchId: snapshot.batchId,
      requested: (snapshot.items || []).length,
      updated: updated,
      skipped: skipped,
      failed: failed,
      results: results
    };
  } finally {
    lock.releaseLock();
  }
}
