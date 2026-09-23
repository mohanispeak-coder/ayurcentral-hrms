/**
 * Client-callable Payroll & Compensation APIs.
 * AuthZ on every call. Client net_pay is ignored.
 */

function apiListPayrollRuns(sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.listRuns();
  }, sessionToken);
}

function apiGetPayrollRun(runId, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.getRunDetail(runId);
  }, sessionToken);
}

function apiSyncPayrollEmployees(runId, sessionToken) {
  return hrmsRun_(function () {
    PayrollService.syncEligibleEmployees(runId);
    return PayrollService.getRunDetail(runId, { skipSync: false });
  }, sessionToken);
}

function apiCreatePayrollRun(periodYear, periodMonth, notes, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.createRun(periodYear, periodMonth, notes);
  }, sessionToken);
}

function apiCreatePayrollCorrection(sourceRunId, notes, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.createCorrectionRun(sourceRunId, notes);
  }, sessionToken);
}

function apiSavePayrollInputs(runId, inputRows, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.saveInputs(runId, inputRows);
  }, sessionToken);
}

function apiRefreshPayrollLop(runId, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.refreshLopFromLeave(runId);
  }, sessionToken);
}

function apiCalculatePayroll(runId, clientPayload, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.calculate(runId, clientPayload || {});
  }, sessionToken);
}

function apiSubmitPayrollReview(runId, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.submitForReview(runId);
  }, sessionToken);
}

function apiReturnPayrollDraft(runId, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.returnToDraft(runId);
  }, sessionToken);
}

function apiApprovePayroll(runId, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.approve(runId);
  }, sessionToken);
}

function apiLockPayroll(runId, clientPayload, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.lock(runId, clientPayload || {});
  }, sessionToken);
}

function apiRegeneratePayslips(runId, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.regeneratePayslips(runId);
  }, sessionToken);
}

function apiRegeneratePayslipForEmployee(runId, employeeId, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.regeneratePayslipForEmployee(runId, employeeId);
  }, sessionToken);
}

function apiFinalizePayroll(runId, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.finalizePayroll(runId);
  }, sessionToken);
}

function apiDownloadPayrollTemplate(runId, sessionToken) {
  return hrmsRun_(function () {
    return PayrollBulkService.downloadTemplate(runId);
  }, sessionToken);
}

function apiDownloadAttendanceRegisterTemplate(runId, verticalName, sessionToken) {
  return hrmsRun_(function () {
    return AttendanceBulkService.downloadTemplate(runId, verticalName);
  }, sessionToken);
}

function apiListSalaryStatement(filter, sessionToken) {
  return hrmsRun_(function () {
    return SalaryStatementService.listStatement(filter || {});
  }, sessionToken);
}

function apiDownloadSalaryStatement(filter, sessionToken) {
  return hrmsRun_(function () {
    return SalaryStatementService.downloadExcel(filter || {});
  }, sessionToken);
}

function apiValidateAttendanceRegisterUpload(runId, verticalName, meta, sessionToken) {
  return hrmsRun_(function () {
    return AttendanceBulkService.validateUpload(runId, verticalName, meta || {});
  }, sessionToken);
}

function apiCommitAttendanceRegisterUpload(runId, uploadId, sessionToken) {
  return hrmsRun_(function () {
    return AttendanceBulkService.commitUpload(runId, uploadId);
  }, sessionToken);
}

function apiListAttendanceRegister(runId, sessionToken) {
  return hrmsRun_(function () {
    var id = String(runId || '').trim();
    if (id) {
      try {
        PayrollService.syncEligibleEmployees(id);
      } catch (syncErr) {
        Logger.log('apiListAttendanceRegister sync: ' + (syncErr.message || syncErr));
      }
    }
    return AttendanceRegisterService.listSummariesForRun_(id);
  }, sessionToken);
}

function apiSaveAttendanceRegister(runId, employeeId, register, sessionToken) {
  return hrmsRun_(function () {
    return AttendanceBulkService.saveEmployeeRegister(runId, employeeId, register || {});
  }, sessionToken);
}

function apiGetFormTStatus(runId, verticalName, sessionToken) {
  return hrmsRun_(function () {
    return FormTService.getStatus(runId, verticalName);
  }, sessionToken);
}

function apiDownloadFormT(runId, verticalName, sessionToken) {
  return hrmsRun_(function () {
    return FormTService.download(runId, verticalName);
  }, sessionToken);
}

function apiValidatePayrollUpload(runId, meta, sessionToken) {
  return hrmsRun_(function () {
    return PayrollBulkService.validateUpload(runId, meta || {});
  }, sessionToken);
}

function apiCommitPayrollUpload(runId, uploadId, sessionToken) {
  return hrmsRun_(function () {
    return PayrollBulkService.commitUpload(runId, uploadId);
  }, sessionToken);
}

function apiApplyPayrollLeaveLop(runId, sessionToken) {
  return hrmsRun_(function () {
    return PayrollService.applyLeaveLopToDays(runId);
  }, sessionToken);
}

function apiListCompensationEmployees(sessionToken) {
  return hrmsRun_(function () {
    return CompensationService.listEmployeeOptions();
  }, sessionToken);
}

function apiListSalaryStructures(employeeId, sessionToken) {
  return hrmsRun_(function () {
    return CompensationService.listStructures(employeeId);
  }, sessionToken);
}

function apiGetSalaryStructure(structureId, sessionToken) {
  return hrmsRun_(function () {
    return CompensationService.getStructure(structureId);
  }, sessionToken);
}

function apiGetCompensationEditorBundle(employeeId, sessionToken) {
  return hrmsRun_(function () {
    return CompensationService.getEditorBundle(employeeId);
  }, sessionToken);
}

function apiGetCurrentSalaryStructure(employeeId, sessionToken) {
  return hrmsRun_(function () {
    return CompensationService.getCurrentForEmployee(employeeId);
  }, sessionToken);
}

function apiSaveSalaryStructure(payload, sessionToken) {
  return hrmsRun_(function () {
    return CompensationService.saveStructure(payload);
  }, sessionToken);
}

function apiReviseSalaryStructure(payload, sessionToken) {
  return hrmsRun_(function () {
    return CompensationService.reviseStructure(payload);
  }, sessionToken);
}

function apiGetOwnSalaryStructure(sessionToken) {
  return hrmsRun_(function () {
    return CompensationService.getOwnCurrentStructure();
  }, sessionToken);
}

function apiListOwnPayslips(sessionToken) {
  return hrmsRun_(function () {
    return PayslipService.listOwnPayslips();
  }, sessionToken);
}

function apiGetPayslipDownload(documentId, sessionToken) {
  return hrmsRun_(function () {
    return PayslipService.getPayslipForDownload(documentId);
  }, sessionToken);
}

function apiDownloadCompensationBulkTemplate(sessionToken) {
  return hrmsRun_(function () {
    return CompensationBulkService.downloadTemplate();
  }, sessionToken);
}

function apiDownloadCompensationBulkCsvTemplate(sessionToken) {
  return hrmsRun_(function () {
    return CompensationBulkService.downloadCsvTemplate();
  }, sessionToken);
}

function apiValidateCompensationBulkUpload(meta, sessionToken) {
  return hrmsRun_(function () {
    return CompensationBulkService.validateUpload(meta || {});
  }, sessionToken);
}

function apiCommitCompensationBulkUpload(uploadId, sessionToken) {
  return hrmsRun_(function () {
    return CompensationBulkService.commitUpload(uploadId);
  }, sessionToken);
}

/* -------- Salary structure types (shared templates) -------- */

function apiListSalaryStructureTypes(includeInactive, sessionToken) {
  return hrmsRun_(function () {
    return SalaryStructureTypeService.listStructureTypes(!includeInactive);
  }, sessionToken);
}

function apiGetSalaryStructureType(structureId, sessionToken) {
  return hrmsRun_(function () {
    return SalaryStructureTypeService.getStructureType(structureId);
  }, sessionToken);
}

function apiSaveSalaryStructureType(payload, sessionToken) {
  return hrmsRun_(function () {
    return SalaryStructureTypeService.saveStructureType(payload || {});
  }, sessionToken);
}

function apiSetSalaryStructureTypeStatus(structureId, status, sessionToken) {
  return hrmsRun_(function () {
    return SalaryStructureTypeService.setStructureTypeStatus(structureId, status);
  }, sessionToken);
}

function apiListSalaryStructureTypeOptions(filter, sessionToken) {
  return hrmsRun_(function () {
    return SalaryStructureTypeService.listStructureTypeOptions(filter || {});
  }, sessionToken);
}
