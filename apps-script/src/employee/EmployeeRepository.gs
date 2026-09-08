/**
 * Employees / Documents / related sheet access for the Employee module.
 */
var HRMS = HRMS || {};

var EmployeeRepository = (function () {
  function findById(employeeId) {
    if (!employeeId) return null;
    return DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: String(employeeId) });
  }

  function findByWorkEmail(email) {
    var normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return null;
    var all = DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES);
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].work_email || '').trim().toLowerCase() === normalized) {
        return all[i];
      }
    }
    return null;
  }

  function listAll() {
    return DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES);
  }

  function insert(record) {
    return DbService.insertRecord(HRMS.SHEETS.EMPLOYEES, record);
  }

  function update(employeeId, updates) {
    return DbService.updateRecord(HRMS.SHEETS.EMPLOYEES, 'employee_id', employeeId, updates);
  }

  function findUserByEmployeeId(employeeId) {
    return DbService.findOne(HRMS.SHEETS.USERS, { employee_id: String(employeeId) });
  }

  function findUserByEmail(email) {
    return DbService.findOne(HRMS.SHEETS.USERS, { google_email: String(email || '').trim().toLowerCase() });
  }

  function insertUser(record) {
    return DbService.insertRecord(HRMS.SHEETS.USERS, record);
  }

  function updateUser(googleEmail, updates) {
    return DbService.updateRecord(HRMS.SHEETS.USERS, 'google_email', googleEmail, updates);
  }

  function listDocuments(employeeId, category) {
    var filter = { employee_id: String(employeeId) };
    if (category) filter.category = category;
    return DbService.findRecords(HRMS.SHEETS.DOCUMENTS, filter);
  }

  function findDocument(documentId) {
    return DbService.findOne(HRMS.SHEETS.DOCUMENTS, { document_id: String(documentId) });
  }

  function insertDocument(record) {
    return DbService.insertRecord(HRMS.SHEETS.DOCUMENTS, record);
  }

  function listActiveLeaveTypes() {
    return DbService.getAllRecords(HRMS.SHEETS.LEAVE_TYPES).filter(function (row) {
      var v = row.is_active;
      return v === true || v === 1 || String(v).toUpperCase() === 'TRUE';
    });
  }

  function insertLeaveBalance(record) {
    return DbService.insertRecord(HRMS.SHEETS.LEAVE_BALANCES, record);
  }

  function listLeaveBalances(employeeId) {
    return DbService.findRecords(HRMS.SHEETS.LEAVE_BALANCES, { employee_id: String(employeeId) });
  }

  function findCurrentSalaryStructure(employeeId) {
    var rows = DbService.findRecords(HRMS.SHEETS.SALARY_STRUCTURES, { employee_id: String(employeeId) });
    var current = rows.filter(function (r) {
      return String(r.status || '').toUpperCase() === 'CURRENT';
    });
    if (!current.length) return null;
    current.sort(function (a, b) {
      return new Date(b.effective_from) - new Date(a.effective_from);
    });
    return current[0];
  }

  return {
    findById: findById,
    findByWorkEmail: findByWorkEmail,
    listAll: listAll,
    insert: insert,
    update: update,
    findUserByEmployeeId: findUserByEmployeeId,
    findUserByEmail: findUserByEmail,
    insertUser: insertUser,
    updateUser: updateUser,
    listDocuments: listDocuments,
    findDocument: findDocument,
    insertDocument: insertDocument,
    listActiveLeaveTypes: listActiveLeaveTypes,
    insertLeaveBalance: insertLeaveBalance,
    listLeaveBalances: listLeaveBalances,
    findCurrentSalaryStructure: findCurrentSalaryStructure
  };
})();
