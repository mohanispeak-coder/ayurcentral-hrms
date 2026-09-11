/**
 * Database schema bootstrap — creates sheets and headers without destroying data.
 */
var HRMS = HRMS || {};

var SchemaService = (function () {
  var SHEET_HEADERS_ = {};
  SHEET_HEADERS_[HRMS.SHEETS.EMPLOYEES] = [
    'employee_id', 'first_name', 'last_name', 'display_name', 'date_of_birth', 'gender',
    'phone', 'address', 'work_email', 'department', 'designation', 'manager_employee_id',
    'joining_date', 'employment_type', 'location', 'status', 'pan', 'bank_account_name',
    'bank_account_number', 'bank_ifsc', 'bank_name', 'notes',
    'created_at', 'created_by_email', 'updated_at', 'updated_by_email'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.USERS] = [
    'google_email', 'employee_id', 'role', 'status',
    'access_documents', 'access_payslips', 'access_leave',
    'created_at', 'updated_at'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.LEAVE_TYPES] = [
    'leave_type_id', 'code', 'name', 'is_paid', 'requires_balance', 'allow_half_day',
    'counts_as_lop', 'annual_entitlement_days', 'carry_forward_max_days', 'max_consecutive_days',
    'min_service_days', 'is_active', 'sort_order'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.LEAVE_BALANCES] = [
    'leave_balance_id', 'employee_id', 'leave_type_id', 'leave_year', 'entitled_days',
    'used_days', 'pending_days', 'carried_forward_days', 'available_days', 'updated_at'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.LEAVE_REQUESTS] = [
    'leave_request_id', 'employee_id', 'leave_type_id', 'start_date', 'end_date',
    'is_half_day', 'half_day_session', 'total_days', 'status', 'reason',
    'approver_employee_id', 'decision_at', 'decision_comment', 'submitted_at',
    'cancelled_at', 'created_at'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.SALARY_STRUCTURES] = [
    'salary_structure_id', 'employee_id', 'effective_from', 'effective_to', 'status',
    'ctc_monthly', 'currency', 'previous_structure_id', 'revision_reason',
    'approved_by_email', 'created_at', 'created_by_email'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.SALARY_COMPONENTS] = [
    'salary_component_id', 'salary_structure_id', 'component_code', 'component_name',
    'component_kind', 'calc_method', 'amount', 'percent', 'sort_order'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.PAYROLL_RUNS] = [
    'payroll_run_id', 'period_year', 'period_month', 'status', 'working_days_default',
    'currency', 'calculated_at', 'approved_at', 'approved_by_email', 'locked_at',
    'locked_by_email', 'correction_of_run_id', 'notes', 'created_at', 'created_by_email'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.PAYROLL_INPUTS] = [
    'payroll_input_id', 'payroll_run_id', 'employee_id', 'working_days', 'paid_days',
    'lop_days', 'bonus', 'incentive', 'other_earnings', 'other_deductions', 'tds_amount',
    'lop_from_leave', 'remarks'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.PAYROLL_RECORDS] = [
    'payroll_record_id', 'payroll_run_id', 'employee_id', 'salary_structure_id',
    'working_days', 'paid_days', 'lop_days', 'bonus', 'incentive', 'other_earnings',
    'other_deductions', 'tds_amount', 'gross_earnings', 'total_deductions', 'net_pay',
    'employer_contributions', 'component_breakdown', 'exception_flags',
    'payslip_document_id', 'calculated_at'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.NOTIFICATIONS] = [
    'notification_id', 'event_type', 'recipient_email', 'employee_id', 'subject',
    'status', 'error_message', 'related_entity_type', 'related_entity_id',
    'created_at', 'sent_at'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.AUDIT_LOG] = [
    'audit_id', 'at', 'actor_email', 'actor_employee_id', 'action', 'entity_type',
    'entity_id', 'employee_id', 'summary'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.SETTINGS] = [
    'setting_key', 'setting_value', 'value_type', 'description', 'admin_only',
    'updated_at', 'updated_by_email'
  ];
  SHEET_HEADERS_[HRMS.SHEETS.DOCUMENTS] = [
    'document_id', 'employee_id', 'category', 'title', 'drive_file_id',
    'drive_folder_id', 'payroll_run_id', 'uploaded_at', 'uploaded_by_email'
  ];

  var DEFAULT_SETTINGS_ = [
    ['company_name', 'AyurCentral HRMS', 'STRING', 'Display name', false],
    ['employee_id_prefix', 'EMP', 'STRING', 'Employee ID prefix', false],
    ['employee_id_pad', '3', 'NUMBER', 'Zero pad width', false],
    ['seq_employee', '0', 'NUMBER', 'Last employee sequence', true],
    ['seq_leave_type', '0', 'NUMBER', 'Last leave type sequence', true],
    ['seq_leave_request', '0', 'NUMBER', 'Last leave request sequence', true],
    ['seq_leave_balance', '0', 'NUMBER', 'Last leave balance sequence', true],
    ['leave_year_start_month', '1', 'NUMBER', 'Leave year starts (1-12)', false],
    ['leave_count_method', 'WEEKDAYS_ONLY', 'STRING', 'WEEKDAYS_ONLY or CALENDAR_DAYS', false],
    ['default_working_days', '26', 'NUMBER', 'Default working days per month', false],
    ['payroll_round', 'NEAREST_RUPEE', 'STRING', 'PAISE_2 or NEAREST_RUPEE', false],
    ['block_lock_missing_structure', 'true', 'BOOLEAN', 'Block lock without structure', true],
    ['block_lock_missing_bank', 'true', 'BOOLEAN', 'Block lock without bank', true],
    ['allow_lock_negative_net', 'false', 'BOOLEAN', 'Allow lock with negative net', true],
    ['notification_leave', 'true', 'BOOLEAN', 'Leave emails enabled', false],
    ['notification_payroll', 'true', 'BOOLEAN', 'Payroll emails enabled', false],
    ['drive_root_folder_id', '', 'STRING', 'Drive root folder ID', true],
    ['timezone', 'Asia/Kolkata', 'STRING', 'Application timezone', false],
    ['app_mode', 'PRODUCTION', 'STRING', 'PRODUCTION or DEMO (admin only)', true],
    ['demo_emails', '', 'STRING', 'DEMO only: comma-separated Google emails', true],
    ['demo_default_role', 'ADMIN', 'STRING', 'DEMO only: default role for demo_emails', true],
    ['demo_roles', '', 'STRING', 'DEMO only: email:ROLE overrides (comma-separated)', true]
  ];

  function applyUsersValidations_(sheet) {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var roleCol = headers.indexOf('role') + 1;
    var statusCol = headers.indexOf('status') + 1;
    var lastRow = Math.max(sheet.getMaxRows(), 1000);
    if (roleCol > 0) {
      var roleRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['OWNER', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'], true)
        .setAllowInvalid(false)
        .build();
      sheet.getRange(2, roleCol, lastRow, roleCol).setDataValidation(roleRule);
    }
    if (statusCol > 0) {
      var statusRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['ACTIVE', 'DISABLED'], true)
        .setAllowInvalid(false)
        .build();
      sheet.getRange(2, statusCol, lastRow, statusCol).setDataValidation(statusRule);
    }
  }

  function ensureSheet_(ss, name, headers) {
    var sheet = ss.getSheetByName(name);
    var created = false;
    if (!sheet) {
      sheet = ss.insertSheet(name);
      created = true;
    }
    if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() === '') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
    if (name === HRMS.SHEETS.USERS && created) {
      applyUsersValidations_(sheet);
    }
    return { sheet: sheet, created: created };
  }

  function seedDefaultSettings_(ss) {
    var sheet = ss.getSheetByName(HRMS.SHEETS.SETTINGS);
    if (!sheet) return { inserted: 0 };
    var existing = {};
    if (sheet.getLastRow() >= 2) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var k = String(data[i][0] || '').trim();
        if (k) existing[k] = true;
      }
    }
    var now = new Date();
    var actor = Session.getActiveUser().getEmail().toLowerCase() || 'system';
    var inserted = 0;
    DEFAULT_SETTINGS_.forEach(function (row) {
      if (existing[row[0]]) return;
      sheet.appendRow([
        row[0], row[1], row[2], row[3], row[4], now, actor
      ]);
      inserted++;
    });
    ConfigService.clearSettingsCache();
    return { inserted: inserted };
  }

  /**
   * Create or bind spreadsheet, ensure all sheets/headers, seed missing settings.
   * @param {string=} spreadsheetId Optional existing spreadsheet ID.
   * @return {Object}
   */
  function setupDatabase(spreadsheetId) {
    var ss;
    var createdSpreadsheet = false;
    if (spreadsheetId) {
      ss = SpreadsheetApp.openById(spreadsheetId);
      ConfigService.setSpreadsheetId(spreadsheetId);
    } else if (ConfigService.getScriptProperty(HRMS.PROPS.SPREADSHEET_ID)) {
      ss = ConfigService.openSpreadsheet();
    } else {
      ss = SpreadsheetApp.create('AyurCentral HRMS Database');
      ConfigService.setSpreadsheetId(ss.getId());
      createdSpreadsheet = true;
    }

    var sheetResults = [];
    Object.keys(SHEET_HEADERS_).forEach(function (name) {
      var result = ensureSheet_(ss, name, SHEET_HEADERS_[name]);
      sheetResults.push({ name: name, created: result.created });
    });

    var settingsSeed = seedDefaultSettings_(ss);
    var moduleSheets = ensureModuleSheets_(ss);

    if (createdSpreadsheet) {
      var defaultSheet = ss.getSheetByName('Sheet1');
      if (defaultSheet && ss.getSheets().length > 1) {
        try {
          ss.deleteSheet(defaultSheet);
        } catch (ignore) {}
      }
    }

    return {
      spreadsheetId: ss.getId(),
      spreadsheetUrl: ss.getUrl(),
      createdSpreadsheet: createdSpreadsheet,
      sheets: sheetResults,
      settingsInserted: settingsSeed.inserted,
      moduleSheets: moduleSheets
    };
  }

  /**
   * PMS / ATS / Notification sheets. Does not add them to the locked 14-sheet core list.
   */
  function ensureModuleSheets_(ss) {
    var out = { pms: null, ats: null, notifications: null };
    try {
      if (typeof PmsSchemaService !== 'undefined' && PmsSchemaService.ensure) {
        out.pms = PmsSchemaService.ensure();
      }
    } catch (e) {
      Logger.log('ensureModuleSheets PMS: ' + (e.message || e));
    }
    try {
      if (typeof AtsSchemaService !== 'undefined' && AtsSchemaService.ensureSheets) {
        out.ats = AtsSchemaService.ensureSheets(ss || ConfigService.openSpreadsheet());
      }
    } catch (e2) {
      Logger.log('ensureModuleSheets ATS: ' + (e2.message || e2));
    }
    try {
      if (typeof NotificationSchema !== 'undefined' && NotificationSchema.ensureSheets) {
        out.notifications = NotificationSchema.ensureSheets();
      }
    } catch (e3) {
      Logger.log('ensureModuleSheets notifications: ' + (e3.message || e3));
    }
    return out;
  }

  function getSchemaInfo() {
    return {
      sheets: Object.keys(SHEET_HEADERS_),
      settingsKeys: DEFAULT_SETTINGS_.map(function (r) { return r[0]; })
    };
  }

  return {
    setupDatabase: setupDatabase,
    getSchemaInfo: getSchemaInfo,
    ensureModuleSheets: function () {
      return ensureModuleSheets_(ConfigService.openSpreadsheet());
    }
  };
})();
