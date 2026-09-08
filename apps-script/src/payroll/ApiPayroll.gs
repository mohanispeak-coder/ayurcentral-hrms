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
