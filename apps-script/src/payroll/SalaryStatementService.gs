/**
 * Salary statement (cost to company) - monthly breakdown per active employee.
 * Uses salary structure templates (PERCENT_OF_CTC / FIXED) and Employees.ctc_monthly.
 */
var HRMS = HRMS || {};

var SalaryStatementService = (function () {
  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function round2_(n) {
    if (typeof PayrollEngine !== 'undefined' && PayrollEngine.round2) {
      return PayrollEngine.round2(n);
    }
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return Math.round(x * 100) / 100;
  }

  function isTypeRow_(row) {
    return !!row && trim_(row.structure_name) !== '' && trim_(row.employee_id) === '';
  }

  function listActiveEmployees_(filter) {
    filter = filter || {};
    var vertical = trim_(filter.vertical_name || filter.vertical).toUpperCase();
    var rows = [];
    try {
      if (typeof EmployeeService !== 'undefined' && EmployeeService.listActiveEmployees) {
        rows = EmployeeService.listActiveEmployees() || [];
      }
    } catch (ignore) {}
    if (!rows.length) {
      rows = (DbService.getAllRecords(HRMS.SHEETS.EMPLOYEES) || []).filter(function (e) {
        return String(e.status || '').toUpperCase() === 'ACTIVE';
      });
    }
    if (vertical) {
      rows = rows.filter(function (e) {
        return String(e.vertical_name || '').toUpperCase() === vertical;
      });
    }
    rows.sort(function (a, b) {
      return String(a.employee_id).localeCompare(String(b.employee_id));
    });
    return rows;
  }

  function findStructureType_(ref) {
    ref = trim_(ref);
    if (!ref) return null;
    var row = DbService.findOne(HRMS.SHEETS.SALARY_STRUCTURES, { salary_structure_id: ref });
    if (row && isTypeRow_(row)) return row;
    var norm = ref.toUpperCase();
    var types = (DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES) || []).filter(isTypeRow_);
    for (var i = 0; i < types.length; i++) {
      var t = types[i];
      if (String(t.salary_structure_id || '').toUpperCase() === norm) return t;
      if (String(t.structure_name || '').toUpperCase() === norm) return t;
    }
    return null;
  }

  function loadComponents_(structureId) {
    var rows = DbService.findRecords(HRMS.SHEETS.SALARY_COMPONENTS, { salary_structure_id: structureId }) || [];
    rows.sort(function (a, b) {
      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });
    return rows;
  }

  function componentMonthly_(component, ctcMonthly) {
    var method = String(component.calc_method || '').toUpperCase();
    var ctc = Number(ctcMonthly) || 0;
    if (method === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
      return round2_(ctc * (Number(component.percent) || 0) / 100);
    }
    return round2_(Number(component.amount) || 0);
  }

  function kindRank_(kind) {
    var k = String(kind || '').toUpperCase();
    if (k === HRMS.COMPONENT_KIND.EARNING) return 1;
    if (k === HRMS.COMPONENT_KIND.DEDUCTION) return 2;
    if (k === HRMS.COMPONENT_KIND.EMPLOYER) return 3;
    return 9;
  }

  function buildComponentCatalog_() {
    var seen = {};
    var catalog = [];
    var types = (DbService.getAllRecords(HRMS.SHEETS.SALARY_STRUCTURES) || []).filter(isTypeRow_);
    types.forEach(function (type) {
      loadComponents_(type.salary_structure_id).forEach(function (c) {
        var code = String(c.component_code || '').toUpperCase();
        if (!code || seen[code]) return;
        seen[code] = true;
        catalog.push({
          code: code,
          name: String(c.component_name || code),
          kind: String(c.component_kind || '').toUpperCase(),
          sort_order: Number(c.sort_order || 0)
        });
      });
    });
    catalog.sort(function (a, b) {
      var kr = kindRank_(a.kind) - kindRank_(b.kind);
      if (kr !== 0) return kr;
      return a.sort_order - b.sort_order || a.code.localeCompare(b.code);
    });
    return catalog;
  }

  function employeeDisplayName_(emp) {
    if (!emp) return '';
    var name = trim_(emp.display_name);
    if (name) return name;
    return trim_((emp.first_name || '') + ' ' + (emp.last_name || '')) || trim_(emp.employee_id);
  }

  function buildEmployeeRow_(emp, catalog) {
    var ctc = Number(emp.ctc_monthly);
    if (!isFinite(ctc) || ctc < 0) ctc = 0;
    var typeRow = findStructureType_(emp.salary_structure_id);
    var components = typeRow ? loadComponents_(typeRow.salary_structure_id) : [];
    var amounts = {};
    var gross = 0;
    var deductions = 0;
    var employer = 0;
    var warnings = [];

    if (!typeRow) {
      if (trim_(emp.salary_structure_id)) {
        warnings.push('Salary structure not found: ' + trim_(emp.salary_structure_id));
      } else {
        warnings.push('No salary structure assigned');
      }
    } else if (!components.length) {
      warnings.push('Structure has no components');
    }
    if (ctc <= 0) {
      warnings.push('Monthly CTC not set');
    }

    components.forEach(function (c) {
      var code = String(c.component_code || '').toUpperCase();
      var amt = componentMonthly_(c, ctc);
      amounts[code] = amt;
      var kind = String(c.component_kind || '').toUpperCase();
      if (kind === HRMS.COMPONENT_KIND.EARNING) gross = round2_(gross + amt);
      else if (kind === HRMS.COMPONENT_KIND.DEDUCTION) deductions = round2_(deductions + amt);
      else if (kind === HRMS.COMPONENT_KIND.EMPLOYER) employer = round2_(employer + amt);
    });

    var net = round2_(gross - deductions);
    var totalCost = round2_(gross + employer);

    return {
      employee_id: emp.employee_id,
      display_name: employeeDisplayName_(emp),
      vertical_name: trim_(emp.vertical_name),
      department: trim_(emp.department),
      designation: trim_(emp.designation),
      salary_structure_id: typeRow ? typeRow.salary_structure_id : trim_(emp.salary_structure_id),
      structure_name: typeRow ? trim_(typeRow.structure_name) : '',
      monthly_ctc: round2_(ctc),
      annual_ctc: round2_(ctc * 12),
      component_amounts: amounts,
      gross_earnings: gross,
      total_deductions: deductions,
      net_pay: net,
      employer_contributions: employer,
      total_cost_to_company: totalCost,
      warnings: warnings
    };
  }

  function listStatement(options) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    options = options || {};
    var catalog = buildComponentCatalog_();
    var employees = listActiveEmployees_(options);
    var rows = employees.map(function (emp) {
      return buildEmployeeRow_(emp, catalog);
    });
    return {
      template_version: '1',
      columns: catalog,
      rows: rows,
      employee_count: rows.length,
      generated_at: new Date().toISOString()
    };
  }

  function exportSpreadsheetXlsx_(spreadsheetId) {
    SpreadsheetApp.flush();
    Utilities.sleep(300);
    var xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
    var v3Url = 'https://www.googleapis.com/drive/v3/files/' + spreadsheetId +
      '/export?mimeType=' + encodeURIComponent(xlsxMime);
    var resp = UrlFetchApp.fetch(v3Url, {
      headers: auth,
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (resp.getResponseCode() === 200) {
      var blob = resp.getBlob();
      if (blob && blob.getBytes().length > 100) return blob;
    }
    var docsUrl = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?format=xlsx';
    resp = UrlFetchApp.fetch(docsUrl, { headers: auth, muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() === 200) {
      return resp.getBlob();
    }
    throw configurationError_('Could not export salary statement Excel. Enable Google Drive API for the script project.');
  }

  function applyHeaderStyles_(sheet, colCount) {
    sheet.getRange(1, 1, 1, colCount)
      .setFontWeight('bold')
      .setBackground('#2d5a3d')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }

  function buildExcel_(data) {
    data = data || {};
    var catalog = data.columns || [];
    var rows = data.rows || [];
    var earnings = catalog.filter(function (c) { return c.kind === HRMS.COMPONENT_KIND.EARNING; });
    var deductions = catalog.filter(function (c) { return c.kind === HRMS.COMPONENT_KIND.DEDUCTION; });
    var employers = catalog.filter(function (c) { return c.kind === HRMS.COMPONENT_KIND.EMPLOYER; });

    var header = ['S.No', 'Employee ID', 'Employee Name', 'Vertical', 'Department', 'Designation',
      'Salary Structure', 'Monthly CTC', 'Annual CTC'];
    earnings.forEach(function (c) { header.push(c.name + ' (' + c.code + ')'); });
    header.push('Gross Earnings');
    deductions.forEach(function (c) { header.push(c.name + ' (' + c.code + ')'); });
    header.push('Total Deductions', 'Net Pay');
    employers.forEach(function (c) { header.push(c.name + ' (' + c.code + ')'); });
    header.push('Employer Contributions', 'Total Cost to Company', 'Notes');

    var body = [header];
    rows.forEach(function (r, idx) {
      var line = [
        idx + 1,
        r.employee_id,
        r.display_name,
        r.vertical_name,
        r.department,
        r.designation,
        r.structure_name || r.salary_structure_id,
        r.monthly_ctc,
        r.annual_ctc
      ];
      earnings.forEach(function (c) {
        line.push(r.component_amounts[c.code] != null ? r.component_amounts[c.code] : '');
      });
      line.push(r.gross_earnings);
      deductions.forEach(function (c) {
        line.push(r.component_amounts[c.code] != null ? r.component_amounts[c.code] : '');
      });
      line.push(r.total_deductions, r.net_pay);
      employers.forEach(function (c) {
        line.push(r.component_amounts[c.code] != null ? r.component_amounts[c.code] : '');
      });
      line.push(r.employer_contributions, r.total_cost_to_company,
        (r.warnings && r.warnings.length) ? r.warnings.join('; ') : '');
      body.push(line);
    });

    var ss = SpreadsheetApp.create('HRMS Salary Statement');
    var fileId = ss.getId();
    var sheet = ss.getSheets()[0];
    sheet.setName('Salary Statement');
    if (body.length) {
      sheet.getRange(1, 1, body.length, header.length).setValues(body);
      applyHeaderStyles_(sheet, header.length);
      if (body.length > 1) {
        var dataRows = body.length - 1;
        sheet.getRange(2, 8, dataRows, header.length - 1).setNumberFormat('#,##0.00');
      }
    }
    SpreadsheetApp.flush();
    Utilities.sleep(200);
    var blob = exportSpreadsheetXlsx_(fileId).setName('HRMS_Salary_Statement_CTC.xlsx');
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignoreTrash) {}
    return blob;
  }

  function downloadExcel(options) {
    PermissionService.require(HRMS.ACTIONS.PAYROLL_RUN);
    var data = listStatement(options);
    var blob = buildExcel_(data);
    return {
      fileName: blob.getName() || 'HRMS_Salary_Statement_CTC.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Utilities.base64Encode(blob.getBytes()),
      employeeCount: data.employee_count,
      templateVersion: data.template_version
    };
  }

  return {
    listStatement: listStatement,
    downloadExcel: downloadExcel
  };
})();
