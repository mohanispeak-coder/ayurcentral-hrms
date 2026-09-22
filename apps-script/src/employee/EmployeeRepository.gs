/**
 * Employees / Documents / related sheet access for the Employee module.
 */
var HRMS = HRMS || {};

var EmployeeRepository = (function () {
  function findById(employeeId) {
    if (!employeeId) return null;
    var raw = String(employeeId);
    var row = DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: raw });
    if (row) return row;
    var norm = raw.trim().toUpperCase();
    if (norm && norm !== raw) {
      return DbService.findOne(HRMS.SHEETS.EMPLOYEES, { employee_id: norm });
    }
    return null;
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

  function listVerticals() {
    return listVerticalCatalog().map(function (row) { return row.vertical_name; });
  }

  function legalNameForVertical_(verticalName, rowLegal) {
    var legal = String(rowLegal || '').trim();
    if (legal) return legal;
    var map = HRMS.VERTICAL_LEGAL_NAMES_DEFAULT || {};
    var key = String(verticalName || '').trim().toUpperCase();
    return String(map[key] || map.OTHERS || '').trim();
  }

  function addressDefaultsForVertical_(verticalName) {
    var key = String(verticalName || '').trim().toUpperCase();
    var map = HRMS.VERTICAL_FORM_T_ADDRESS_DEFAULT || {};
    return map[key] || map.OTHERS || { address_line1: '', address_line2: '' };
  }

  function catalogRowFromSheet_(name, row) {
    row = row || {};
    var defaults = addressDefaultsForVertical_(name);
    return {
      vertical_name: name,
      legal_name: legalNameForVertical_(name, row.legal_name),
      address_line1: String(row.address_line1 || defaults.address_line1 || '').trim(),
      address_line2: String(row.address_line2 || defaults.address_line2 || '').trim()
    };
  }

  function listVerticalCatalog() {
    var rows;
    try {
      rows = DbService.getAllRecords(HRMS.SHEETS.VERTICALS);
    } catch (e) {
      rows = [];
    }
    var seen = {};
    var out = [];
    rows.forEach(function (row) {
      var name = String(row.vertical_name || row.name || row.value || '').trim().toUpperCase();
      if (!name || seen[name]) return;
      seen[name] = true;
      out.push(catalogRowFromSheet_(name, row));
    });
    if (!out.length) {
      var defaults = HRMS.VERTICAL_LEGAL_NAMES_DEFAULT || {};
      (HRMS.VERTICALS || []).forEach(function (name) {
        var vertical = String(name || '').trim().toUpperCase();
        if (!vertical) return;
        out.push(catalogRowFromSheet_(vertical, {
          legal_name: defaults[vertical],
          address_line1: '',
          address_line2: ''
        }));
      });
    }
    return out;
  }

  function insert(record) {
    return DbService.insertRecord(HRMS.SHEETS.EMPLOYEES, record);
  }

  function update(employeeId, updates) {
    return DbService.updateRecord(HRMS.SHEETS.EMPLOYEES, 'employee_id', employeeId, updates);
  }

  function findUserByEmployeeId(employeeId) {
    if (!employeeId) return null;
    var raw = String(employeeId);
    var row = DbService.findOne(HRMS.SHEETS.USERS, { employee_id: raw });
    if (row) return row;
    var norm = raw.trim().toUpperCase();
    if (norm && norm !== raw) {
      return DbService.findOne(HRMS.SHEETS.USERS, { employee_id: norm });
    }
    return null;
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
      if (v === '' || v === null || v === undefined) return true;
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
    listVerticals: listVerticals,
    listVerticalCatalog: listVerticalCatalog,
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
