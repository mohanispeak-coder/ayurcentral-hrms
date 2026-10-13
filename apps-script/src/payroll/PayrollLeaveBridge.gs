/**
 * Leave module removed — payroll no longer reads approved leave requests.
 * lop_from_leave stays 0 unless HR sets LOP manually from attendance.
 */
var PayrollLeaveBridge = (function () {
  function getApprovedLopForPayroll(employeeId, periodYear, periodMonth) {
    return 0;
  }

  function getApprovedLopMapForPayroll(periodYear, periodMonth) {
    return {};
  }

  return {
    getApprovedLopForPayroll: getApprovedLopForPayroll,
    getApprovedLopMapForPayroll: getApprovedLopMapForPayroll
  };
})();
