/**
 * Employee master — create, edit, status, directory, documents, profile views.
 */
var HRMS = HRMS || {};

var EmployeeService = (function () {
  var NAME_MAX_ = 80;
  var DIRECTORY_FIELDS_ = [
    'employee_id', 'first_name', 'last_name', 'display_name', 'department',
    'designation', 'location', 'employment_type', 'status', 'manager_employee_id', 'work_email'
  ];
  var WORK_FIELDS_ = DIRECTORY_FIELDS_.concat(['joining_date']);
  var PERSONAL_FIELDS_ = [
    'first_name', 'last_name', 'display_name', 'date_of_birth', 'gender', 'phone', 'address'
  ];
  var SENSITIVE_FIELDS_ = ['pan', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'bank_name'];
  var EMPLOYMENT_EDIT_FIELDS_ = [
    'first_name', 'last_name', 'display_name', 'date_of_birth', 'gender', 'phone', 'address',
    'work_email', 'department', 'designation', 'manager_employee_id', 'joining_date',
    'employment_type', 'location', 'notes'
  ].concat(SENSITIVE_FIELDS_);
  var SELF_EDIT_FIELDS_ = ['phone', 'address'];
  var EMPLOYMENT_TYPES_ = ['PERMANENT', 'CONTRACT', 'INTERN', 'CONSULTANT'];
  var EMPLOYEE_ID_PATTERN_ = /^(SAPL|AOPL|AOMS)-\d{4}$/;

  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function normalizeEmail_(email) {
    return trim_(email).toLowerCase();
  }

  function isValidEmail_(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function panLooksValid_(pan) {
    return /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(pan);
  }

  function toIsoDate_(value) {
    if (value === null || value === undefined || value === '') return '';
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return Utilities.formatDate(value, ConfigService.getTimezone(), 'yyyy-MM-dd');
    }
    var s = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, ConfigService.getTimezone(), 'yyyy-MM-dd');
    }
    return s;
  }

  function toIsoDateTime_(value) {
    if (value === null || value === undefined || value === '') return '';
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toISOString();
  }

  function currentLeaveYear_() {
    var startMonth = Number(ConfigService.getSetting('leave_year_start_month', 1)) || 1;
    var tz = ConfigService.getTimezone();
    var now = new Date();
    var y = Number(Utilities.formatDate(now, tz, 'yyyy'));
    var m = Number(Utilities.formatDate(now, tz, 'M'));
    if (m < startMonth) y -= 1;
    return String(y);
  }

  function pick_(row, keys) {
    var out = {};
    keys.forEach(function (k) {
      if (row.hasOwnProperty(k)) out[k] = row[k];
    });
    return out;
  }

  function serializeEmployee_(row) {
    if (!row) return null;
    var out = {};
    Object.keys(row).forEach(function (k) {
      var v = row[k];
      if (k === 'date_of_birth' || k === 'joining_date') {
        out[k] = toIsoDate_(v);
      } else if (k === 'created_at' || k === 'updated_at') {
        out[k] = toIsoDateTime_(v);
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  function managerNameMap_(employees) {
    var map = {};
    employees.forEach(function (e) {
      map[e.employee_id] = e.display_name || trim_(e.first_name + ' ' + e.last_name);
    });
    return map;
  }

  /**
   * Who may see this employee record at all.
   */
  function canAccessEmployee_(session, emp) {
    if (!session || !session.authorized || !emp) return false;
    if (PermissionService.isHrOrAdmin(session)) return true;
    if (session.employee_id && session.employee_id === emp.employee_id) return true;
    if (session.role === HRMS.ROLES.MANAGER && emp.manager_employee_id === session.employee_id) return true;
    return false;
  }

  function canSeeSensitive_(session, emp) {
    if (PermissionService.isHrOrAdmin(session)) return true;
    return session.employee_id === emp.employee_id;
  }

  function isTeamWorkOnly_(session, emp) {
    return session.role === HRMS.ROLES.MANAGER &&
      session.employee_id !== emp.employee_id &&
      emp.manager_employee_id === session.employee_id;
  }

  /**
   * Strip salary/bank/PAN/notes according to viewer. Used by API and tests.
   * @param {Object} row
   * @param {Object} session
   * @return {Object}
   */
  function sanitizeForViewer(row, session) {
    if (!row) return null;
    var emp = serializeEmployee_(row);
    if (!canAccessEmployee_(session, row)) {
      throw authorizationError_('You do not have access to this employee.');
    }
    if (isTeamWorkOnly_(session, row)) {
      var work = pick_(emp, WORK_FIELDS_);
      work.view_mode = 'TEAM_WORK';
      work.can_edit = false;
      work.can_edit_contact = false;
      work.can_change_status = false;
      work.can_upload_documents = false;
      work.can_view_documents = false;
      work.can_view_payroll_ids = false;
      work.can_view_salary_summary = false;
      work.can_view_payslips = false;
      return work;
    }

    var out;
    if (canSeeSensitive_(session, row)) {
      out = emp;
      if (!PermissionService.isHrOrAdmin(session)) {
        delete out.notes;
      }
      out.can_view_payroll_ids = true;
      out.can_view_salary_summary = true;
      out.can_view_payslips = true;
    } else {
      out = pick_(emp, PERSONAL_FIELDS_.concat(WORK_FIELDS_).concat([
        'created_at', 'created_by_email', 'updated_at', 'updated_by_email'
      ]));
      SENSITIVE_FIELDS_.forEach(function (f) { delete out[f]; });
      delete out.notes;
      out.can_view_payroll_ids = false;
      out.can_view_salary_summary = false;
      out.can_view_payslips = PermissionService.isHrOrAdmin(session);
    }

    var isSelf = session.employee_id === row.employee_id;
    var hr = PermissionService.isHrOrAdmin(session);
    out.view_mode = hr ? 'HR' : (isSelf ? 'SELF' : 'OTHER');
    out.can_edit = hr;
    out.can_edit_contact = hr || isSelf;
    out.can_change_status = hr;
    out.can_upload_documents = hr;
    out.can_view_documents = hr || isSelf;
    if (!out.hasOwnProperty('can_view_payslips')) {
      out.can_view_payslips = hr || isSelf;
    }
    return out;
  }

  function directoryRow_(emp, nameMap) {
    return {
      employee_id: emp.employee_id,
      display_name: emp.display_name || trim_(emp.first_name + ' ' + emp.last_name),
      department: emp.department || '',
      designation: emp.designation || '',
      location: emp.location || '',
      employment_type: emp.employment_type || '',
      status: emp.status || '',
      manager_employee_id: emp.manager_employee_id || '',
      manager_name: emp.manager_employee_id ? (nameMap[emp.manager_employee_id] || emp.manager_employee_id) : ''
    };
  }

  function scopedEmployees_(session) {
    var all = EmployeeRepository.listAll();
    if (PermissionService.isHrOrAdmin(session)) return all;
    if (session.role === HRMS.ROLES.MANAGER) {
      return all.filter(function (e) {
        return e.employee_id === session.employee_id || e.manager_employee_id === session.employee_id;
      });
    }
    return all.filter(function (e) { return e.employee_id === session.employee_id; });
  }

  function uniqueSorted_(values) {
    var seen = {};
    var out = [];
    values.forEach(function (v) {
      var s = trim_(v);
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    });
    out.sort();
    return out;
  }

  function listDirectory(session, query) {
    PermissionService.require(HRMS.ACTIONS.EMPLOYEE_DIRECTORY);
    query = query || {};
    if (session.role === HRMS.ROLES.EMPLOYEE) {
      throw authorizationError_('Employees cannot open the company directory.');
    }
    var all = scopedEmployees_(session);
    if (session.role === HRMS.ROLES.MANAGER && query.teamOnly) {
      all = all.filter(function (e) { return e.manager_employee_id === session.employee_id; });
    }
    var q = trim_(query.q).toLowerCase();
    var status = trim_(query.status).toUpperCase();
    var department = trim_(query.department);
    var location = trim_(query.location);
    var filtered = all.filter(function (e) {
      if (status && String(e.status || '').toUpperCase() !== status) return false;
      if (department && String(e.department || '') !== department) return false;
      if (location && String(e.location || '') !== location) return false;
      if (q) {
        var hay = (
          String(e.employee_id || '') + ' ' +
          String(e.display_name || '') + ' ' +
          String(e.first_name || '') + ' ' +
          String(e.last_name || '')
        ).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    filtered.sort(function (a, b) {
      return String(a.employee_id).localeCompare(String(b.employee_id));
    });
    var nameMap = managerNameMap_(EmployeeRepository.listAll());
    var pageSize = Number(query.pageSize) || 25;
    if (pageSize < 1) pageSize = 25;
    var page = Number(query.page) || 1;
    if (page < 1) page = 1;
    var start = (page - 1) * pageSize;
    var rows = filtered.slice(start, start + pageSize).map(function (e) {
      return directoryRow_(e, nameMap);
    });
    return {
      rows: rows,
      total: filtered.length,
      page: page,
      pageSize: pageSize,
      departments: uniqueSorted_(all.map(function (e) { return e.department; })),
      locations: uniqueSorted_(all.map(function (e) { return e.location; }))
    };
  }

  function listMyTeam(session, query) {
    PermissionService.require(HRMS.ACTIONS.EMPLOYEE_DIRECTORY);
    if (session.role !== HRMS.ROLES.MANAGER && !PermissionService.isHrOrAdmin(session)) {
      throw authorizationError_();
    }
    query = query || {};
    query.teamOnly = true;
    if (PermissionService.isHrOrAdmin(session) && session.role !== HRMS.ROLES.MANAGER) {
      query.teamOnly = false;
    }
    return listDirectory(session, query);
  }

  function listPicker(session) {
    AuthService.requireAuth();
    if (!PermissionService.isHrOrAdmin(session)) {
      throw authorizationError_();
    }
    return EmployeeRepository.listAll()
      .filter(function (e) { return String(e.status).toUpperCase() === HRMS.EMPLOYEE_STATUS.ACTIVE; })
      .map(function (e) {
        return {
          employee_id: e.employee_id,
          display_name: e.display_name || trim_(e.first_name + ' ' + e.last_name)
        };
      })
      .sort(function (a, b) { return a.employee_id.localeCompare(b.employee_id); });
  }

  function normalizeEmployeeId_(value) {
    return trim_(value).toUpperCase();
  }

  function isValidEmployeeIdFormat_(employeeId) {
    return EMPLOYEE_ID_PATTERN_.test(normalizeEmployeeId_(employeeId));
  }

  function validatePayload_(payload, employeeIdForSelfCheck, isCreate) {
    var errors = {};
    var warnings = [];
    if (isCreate) {
      var employeeId = normalizeEmployeeId_(payload.employee_id);
      if (!employeeId) {
        errors.employee_id = 'Employee code is required.';
      } else if (!isValidEmployeeIdFormat_(employeeId)) {
        errors.employee_id = 'Use format SAPL-0001, AOPL-0001, or AOMS-0001.';
      } else if (EmployeeRepository.findById(employeeId)) {
        errors.employee_id = 'Employee code already exists.';
      }
    }
    var first = trim_(payload.first_name);
    var last = trim_(payload.last_name);
    if (!first) errors.first_name = 'First name is required.';
    else if (first.length > NAME_MAX_) errors.first_name = 'First name must be 80 characters or fewer.';
    if (!last) errors.last_name = 'Last name is required.';
    else if (last.length > NAME_MAX_) errors.last_name = 'Last name must be 80 characters or fewer.';

    var email = normalizeEmail_(payload.work_email);
    if (!email) errors.work_email = 'Work email is required.';
    else if (!isValidEmail_(email)) errors.work_email = 'Enter a valid work email.';

    if (!trim_(payload.department)) errors.department = 'Department is required.';
    if (!trim_(payload.designation)) errors.designation = 'Designation is required.';
    if (!trim_(payload.joining_date)) errors.joining_date = 'Joining date is required.';
    var empType = trim_(payload.employment_type).toUpperCase();
    if (!empType) errors.employment_type = 'Employment type is required.';
    else if (EMPLOYMENT_TYPES_.indexOf(empType) < 0) errors.employment_type = 'Invalid employment type.';
    if (!trim_(payload.location)) errors.location = 'Location is required.';

    var managerId = trim_(payload.manager_employee_id);
    if (managerId && employeeIdForSelfCheck && managerId === employeeIdForSelfCheck) {
      errors.manager_employee_id = 'An employee cannot be their own manager.';
    }
    if (managerId) {
      var mgr = EmployeeRepository.findById(managerId);
      if (!mgr) errors.manager_employee_id = 'Manager employee ID was not found.';
      else if (String(mgr.status).toUpperCase() === HRMS.EMPLOYEE_STATUS.INACTIVE) {
        warnings.push('Selected manager is inactive.');
      }
    }

    var bankNo = trim_(payload.bank_account_number);
    var ifsc = trim_(payload.bank_ifsc);
    if (bankNo && !ifsc) errors.bank_ifsc = 'IFSC is required when a bank account number is provided.';
    if (ifsc && !bankNo) errors.bank_account_number = 'Bank account number is required when IFSC is provided.';

    var pan = trim_(payload.pan);
    if (pan && !panLooksValid_(pan)) {
      warnings.push('PAN format looks unusual (expected AAAAA9999A). Saved anyway.');
    }

    if (Object.keys(errors).length) {
      throw validationError_('Please correct the highlighted fields.', { fields: errors, warnings: warnings });
    }
    return { warnings: warnings, employment_type: empType, work_email: email };
  }

  function ensureUniqueEmail_(email, exceptEmployeeId) {
    var existing = EmployeeRepository.findByWorkEmail(email);
    if (existing && existing.employee_id !== exceptEmployeeId) {
      throw validationError_('Work email is already used by another employee.', {
        fields: { work_email: 'Work email must be unique.' }
      });
    }
  }

  function seedLeaveBalances_(employeeId, now) {
    var types;
    try {
      types = EmployeeRepository.listActiveLeaveTypes();
    } catch (e) {
      return 0;
    }
    if (!types.length) return 0;
    var year = currentLeaveYear_();
    var existing = EmployeeRepository.listLeaveBalances(employeeId);
    var seeded = 0;
    types.forEach(function (t) {
      var already = existing.some(function (b) {
        return String(b.leave_type_id) === String(t.leave_type_id) && String(b.leave_year) === year;
      });
      if (already) return;
      var entitled = Number(t.annual_entitlement_days) || 0;
      EmployeeRepository.insertLeaveBalance({
        leave_balance_id: DbService.generateId('LB'),
        employee_id: employeeId,
        leave_type_id: t.leave_type_id,
        leave_year: year,
        entitled_days: entitled,
        used_days: 0,
        pending_days: 0,
        carried_forward_days: 0,
        available_days: entitled,
        updated_at: now
      });
      seeded++;
    });
    return seeded;
  }

  function maybeCreateDriveFolder_(employeeId) {
    try {
      var folder = DriveService.getEmployeeDocumentsFolder(employeeId);
      return { created: true, folderId: folder.getId() };
    } catch (e) {
      return { created: false, error: e.message };
    }
  }

  function parseCreateUserFlag_(value) {
    if (value === false || value === 0) return false;
    var normalized = trim_(value).toUpperCase();
    if (normalized === 'NO' || normalized === 'N' || normalized === 'FALSE' || normalized === '0') return false;
    return true;
  }

  function resolveGoogleLoginEmail_(payload, workEmail) {
    var loginEmail = normalizeEmail_(payload.google_login_email);
    if (loginEmail) return loginEmail;
    return workEmail;
  }

  function createEmployee(session, payload, options) {
    PermissionService.require(HRMS.ACTIONS.EMPLOYEE_CREATE);
    payload = payload || {};
    options = options || {};
    var validated = validatePayload_(payload, '', true);
    var displayName = trim_(payload.display_name) || (trim_(payload.first_name) + ' ' + trim_(payload.last_name));
    var createUser = parseCreateUserFlag_(payload.create_user);
    var employeeId = normalizeEmployeeId_(payload.employee_id);
    var loginEmail = resolveGoogleLoginEmail_(payload, validated.work_email);
    var now = new Date();

    var runCreate = function () {
      ensureUniqueEmail_(validated.work_email, null);
      if (createUser) {
        if (!loginEmail) {
          throw validationError_('Google login email is required when creating a user login.', {
            fields: { google_login_email: 'Enter the Google sign-in email.' }
          });
        }
        var existingUser = EmployeeRepository.findUserByEmail(loginEmail);
        if (existingUser) {
          throw validationError_('A user login already exists for this email.', {
            fields: { google_login_email: 'This email is already mapped to a user.' }
          });
        }
      }

      var record = {
        employee_id: employeeId,
        first_name: trim_(payload.first_name),
        last_name: trim_(payload.last_name),
        display_name: displayName,
        date_of_birth: trim_(payload.date_of_birth) || '',
        gender: trim_(payload.gender),
        phone: trim_(payload.phone),
        address: trim_(payload.address),
        work_email: validated.work_email,
        department: trim_(payload.department),
        designation: trim_(payload.designation),
        manager_employee_id: trim_(payload.manager_employee_id),
        joining_date: trim_(payload.joining_date),
        employment_type: validated.employment_type,
        location: trim_(payload.location),
        status: HRMS.EMPLOYEE_STATUS.ACTIVE,
        pan: trim_(payload.pan).toUpperCase(),
        bank_account_name: trim_(payload.bank_account_name),
        bank_account_number: trim_(payload.bank_account_number),
        bank_ifsc: trim_(payload.bank_ifsc).toUpperCase(),
        bank_name: trim_(payload.bank_name),
        notes: trim_(payload.notes),
        created_at: now,
        created_by_email: session.email,
        updated_at: now,
        updated_by_email: session.email
      };
      EmployeeRepository.insert(record);

      var leaveSeeded = 0;
      if (typeof LeaveService !== 'undefined' && LeaveService.grantBalancesForEmployee) {
        try {
          var granted = LeaveService.grantBalancesForEmployee(employeeId, null, { alreadyLocked: true });
          leaveSeeded = granted ? granted.length : 0;
        } catch (ignore) {
          leaveSeeded = seedLeaveBalances_(employeeId, now);
        }
      } else {
        leaveSeeded = seedLeaveBalances_(employeeId, now);
      }

      if (createUser) {
        EmployeeRepository.insertUser({
          google_email: loginEmail,
          employee_id: employeeId,
          role: HRMS.ROLES.EMPLOYEE,
          status: HRMS.USER_STATUS.ACTIVE,
          created_at: now,
          updated_at: now
        });
      }

      var drive = maybeCreateDriveFolder_(employeeId);
      var auditNote = 'Created ' + displayName + ' (' + record.department + ', ' + record.employment_type + ')' +
        (createUser ? '; user login enabled' : '');
      if (options.source === 'bulk_upload') auditNote += '; source=bulk_upload';
      AuditService.log('EMPLOYEE_CREATE', 'Employees', employeeId, auditNote, employeeId);

      return {
        employee: sanitizeForViewer(EmployeeRepository.findById(employeeId), session),
        warnings: validated.warnings,
        leave_balances_seeded: leaveSeeded,
        drive_folder_created: drive.created,
        user_created: createUser
      };
    };

    if (options.alreadyLocked) return runCreate();
    return withScriptLock_(runCreate);
  }

  function getEmployee(session, employeeId) {
    AuthService.requireAuth();
    var id = trim_(employeeId);
    if (!id) throw validationError_('employee_id is required.');
    var row = EmployeeRepository.findById(id);
    if (!row) throw notFoundError_('Employee not found.');
    if (!canAccessEmployee_(session, row)) {
      throw authorizationError_('You do not have access to this employee.');
    }
    var view = sanitizeForViewer(row, session);
    if (view.can_view_salary_summary) {
      var structure = EmployeeRepository.findCurrentSalaryStructure(id);
      view.current_structure = structure ? {
        salary_structure_id: structure.salary_structure_id,
        status: structure.status,
        effective_from: toIsoDate_(structure.effective_from),
        ctc_monthly: structure.ctc_monthly,
        currency: structure.currency || 'INR'
      } : null;
    } else {
      view.current_structure = null;
    }
    return view;
  }

  function getMyProfile(session) {
    AuthService.requireAuth();
    if (!session.employee_id) throw authorizationError_('Your account is not linked to an employee record.');
    return getEmployee(session, session.employee_id);
  }

  function applySelfContact_(payload) {
    var updates = {};
    SELF_EDIT_FIELDS_.forEach(function (k) {
      if (payload.hasOwnProperty(k)) updates[k] = trim_(payload[k]);
    });
    return updates;
  }

  function applyHrUpdates_(payload) {
    var updates = {};
    EMPLOYMENT_EDIT_FIELDS_.forEach(function (k) {
      if (payload.hasOwnProperty(k)) {
        updates[k] = (k === 'pan' || k === 'bank_ifsc') ? trim_(payload[k]).toUpperCase() : trim_(payload[k]);
      }
    });
    if (updates.work_email) updates.work_email = normalizeEmail_(updates.work_email);
    if (updates.employment_type) updates.employment_type = String(updates.employment_type).toUpperCase();
    if (updates.first_name || updates.last_name) {
      if (!trim_(payload.display_name) && payload.first_name && payload.last_name) {
        updates.display_name = trim_(payload.first_name) + ' ' + trim_(payload.last_name);
      }
    }
    return updates;
  }

  function updateEmployee(session, employeeId, payload) {
    PermissionService.require(HRMS.ACTIONS.EMPLOYEE_UPDATE);
    payload = payload || {};
    var id = trim_(employeeId);
    var row = EmployeeRepository.findById(id);
    if (!row) throw notFoundError_('Employee not found.');
    if (!canAccessEmployee_(session, row)) {
      throw authorizationError_('You do not have access to this employee.');
    }

    if (payload.hasOwnProperty('employee_id') && trim_(payload.employee_id) && trim_(payload.employee_id) !== id) {
      throw validationError_('Employee ID cannot be changed.', {
        fields: { employee_id: 'Employee ID is immutable.' }
      });
    }

    var hr = PermissionService.isHrOrAdmin(session);
    var isSelf = session.employee_id === id;
    if (!hr && !isSelf) {
      throw authorizationError_('You cannot edit this employee.');
    }
    if (isTeamWorkOnly_(session, row)) {
      throw authorizationError_('Managers cannot edit team employment records.');
    }

    var updates;
    var validated = { warnings: [] };
    if (hr) {
      var merged = {};
      Object.keys(row).forEach(function (k) { merged[k] = row[k]; });
      Object.keys(payload).forEach(function (k) {
        if (k !== 'employee_id') merged[k] = payload[k];
      });
      validated = validatePayload_(merged, id, false);
      updates = applyHrUpdates_(payload);
      if (!updates.work_email) updates.work_email = normalizeEmail_(row.work_email);
    } else {
      updates = applySelfContact_(payload);
    }

    updates.updated_at = new Date();
    updates.updated_by_email = session.email;

    return withScriptLock_(function () {
      if (hr && updates.work_email) {
        ensureUniqueEmail_(updates.work_email, id);
        var user = EmployeeRepository.findUserByEmployeeId(id);
        if (user && normalizeEmail_(user.google_email) !== updates.work_email) {
          var clash = EmployeeRepository.findUserByEmail(updates.work_email);
          if (clash && clash.employee_id !== id) {
            throw validationError_('A user login already exists for this email.', {
              fields: { work_email: 'This email is already mapped to a user.' }
            });
          }
          EmployeeRepository.updateUser(user.google_email, {
            google_email: updates.work_email,
            updated_at: updates.updated_at
          });
        }
      }
      EmployeeRepository.update(id, updates);
      AuditService.log(
        'EMPLOYEE_UPDATE',
        'Employees',
        id,
        hr ? 'Updated employment/personal fields' : 'Updated contact details',
        id
      );
      return {
        employee: getEmployee(session, id),
        warnings: hr ? validated.warnings : []
      };
    });
  }

  function setStatus(session, employeeId, status) {
    PermissionService.require(HRMS.ACTIONS.EMPLOYEE_STATUS);
    var id = trim_(employeeId);
    var next = trim_(status).toUpperCase();
    if (next !== HRMS.EMPLOYEE_STATUS.ACTIVE && next !== HRMS.EMPLOYEE_STATUS.INACTIVE) {
      throw validationError_('Status must be ACTIVE or INACTIVE.');
    }
    var row = EmployeeRepository.findById(id);
    if (!row) throw notFoundError_('Employee not found.');

    return withScriptLock_(function () {
      var now = new Date();
      EmployeeRepository.update(id, {
        status: next,
        updated_at: now,
        updated_by_email: session.email
      });
      var user = EmployeeRepository.findUserByEmployeeId(id);
      if (user) {
        EmployeeRepository.updateUser(user.google_email, {
          status: next === HRMS.EMPLOYEE_STATUS.INACTIVE ? HRMS.USER_STATUS.DISABLED : HRMS.USER_STATUS.ACTIVE,
          updated_at: now
        });
      }
      AuditService.log(
        'EMPLOYEE_STATUS',
        'Employees',
        id,
        'Status set to ' + next + (user ? '; user ' + (next === HRMS.EMPLOYEE_STATUS.INACTIVE ? 'DISABLED' : 'ACTIVE') : ''),
        id
      );
      return getEmployee(session, id);
    });
  }

  function listDocuments(session, employeeId) {
    AuthService.requireAuth();
    var emp = EmployeeRepository.findById(trim_(employeeId));
    if (!emp) throw notFoundError_('Employee not found.');
    if (!canAccessEmployee_(session, emp)) throw authorizationError_();
    var view = sanitizeForViewer(emp, session);
    if (!view.can_view_documents) {
      throw authorizationError_('You cannot view these documents.');
    }
    return EmployeeRepository.listDocuments(emp.employee_id, HRMS.DOCUMENT_CATEGORY.EMPLOYEE_FILE).map(function (d) {
      return {
        document_id: d.document_id,
        title: d.title,
        category: d.category,
        uploaded_at: toIsoDateTime_(d.uploaded_at),
        uploaded_by_email: d.uploaded_by_email
      };
    });
  }

  function listPayslips(session, employeeId) {
    AuthService.requireAuth();
    var emp = EmployeeRepository.findById(trim_(employeeId));
    if (!emp) throw notFoundError_('Employee not found.');
    if (!canAccessEmployee_(session, emp)) throw authorizationError_();
    var view = sanitizeForViewer(emp, session);
    if (!view.can_view_payslips) {
      throw authorizationError_('You cannot view these payslips.');
    }
    return EmployeeRepository.listDocuments(emp.employee_id, HRMS.DOCUMENT_CATEGORY.PAYSLIP).map(function (d) {
      return {
        document_id: d.document_id,
        title: d.title,
        category: d.category,
        payroll_run_id: d.payroll_run_id || '',
        uploaded_at: toIsoDateTime_(d.uploaded_at),
        uploaded_by_email: d.uploaded_by_email
      };
    });
  }

  function uploadDocument(session, employeeId, meta) {
    PermissionService.require(HRMS.ACTIONS.EMPLOYEE_DOCUMENTS);
    if (!PermissionService.isHrOrAdmin(session)) {
      throw authorizationError_('Only HR or Admin can upload employee files.');
    }
    meta = meta || {};
    var emp = EmployeeRepository.findById(trim_(employeeId));
    if (!emp) throw notFoundError_('Employee not found.');
    var title = trim_(meta.title) || trim_(meta.fileName) || 'Document';
    var fileName = trim_(meta.fileName) || 'upload';
    var mimeType = trim_(meta.mimeType) || 'application/octet-stream';
    var base64 = trim_(meta.base64);
    if (!base64) throw validationError_('File data is required.');

    var folder = DriveService.getEmployeeDocumentsFolder(emp.employee_id);
    var bytes = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(bytes, mimeType, fileName);
    var file = folder.createFile(blob);
    var now = new Date();
    var doc = {
      document_id: DbService.generateId('DOC'),
      employee_id: emp.employee_id,
      category: HRMS.DOCUMENT_CATEGORY.EMPLOYEE_FILE,
      title: title,
      drive_file_id: file.getId(),
      drive_folder_id: folder.getId(),
      payroll_run_id: '',
      uploaded_at: now,
      uploaded_by_email: session.email
    };
    EmployeeRepository.insertDocument(doc);
    AuditService.log(
      'DOCUMENT_UPLOAD',
      'Documents',
      doc.document_id,
      'Uploaded file "' + title + '"',
      emp.employee_id
    );
    return {
      document_id: doc.document_id,
      title: title,
      uploaded_at: toIsoDateTime_(now)
    };
  }

  function downloadDocument(session, documentId) {
    AuthService.requireAuth();
    var doc = EmployeeRepository.findDocument(trim_(documentId));
    if (!doc) throw notFoundError_('Document not found.');
    var emp = EmployeeRepository.findById(doc.employee_id);
    if (!emp) throw notFoundError_('Employee not found.');
    if (!canAccessEmployee_(session, emp)) throw authorizationError_();
    var view = sanitizeForViewer(emp, session);
    var cat = String(doc.category || '').toUpperCase();
    if (cat === HRMS.DOCUMENT_CATEGORY.PAYSLIP) {
      if (!view.can_view_payslips) throw authorizationError_('You cannot download this payslip.');
    } else {
      if (!view.can_view_documents) throw authorizationError_('You cannot download this document.');
    }
    var file = DriveApp.getFileById(doc.drive_file_id);
    var blob = file.getBlob();
    return {
      fileName: blob.getName() || doc.title,
      mimeType: blob.getContentType() || 'application/octet-stream',
      base64: Utilities.base64Encode(blob.getBytes()),
      title: doc.title
    };
  }

  function getLeaveSummary(session, employeeId) {
    AuthService.requireAuth();
    var emp = EmployeeRepository.findById(trim_(employeeId));
    if (!emp) throw notFoundError_('Employee not found.');
    if (!canAccessEmployee_(session, emp)) throw authorizationError_();
    var types = [];
    try {
      types = DbService.getAllRecords(HRMS.SHEETS.LEAVE_TYPES);
    } catch (ignore) {}
    var typeName = {};
    types.forEach(function (t) { typeName[t.leave_type_id] = t.name || t.code; });
    return EmployeeRepository.listLeaveBalances(emp.employee_id).map(function (b) {
      return {
        leave_balance_id: b.leave_balance_id,
        leave_type_id: b.leave_type_id,
        leave_type_name: typeName[b.leave_type_id] || b.leave_type_id,
        leave_year: b.leave_year,
        entitled_days: Number(b.entitled_days) || 0,
        used_days: Number(b.used_days) || 0,
        pending_days: Number(b.pending_days) || 0,
        carried_forward_days: Number(b.carried_forward_days) || 0,
        available_days: Number(b.available_days) || 0
      };
    });
  }

  function isActive(employeeId) {
    var row = EmployeeRepository.findById(employeeId);
    return !!(row && String(row.status).toUpperCase() === HRMS.EMPLOYEE_STATUS.ACTIVE);
  }

  /**
   * Server-side master for Leave/Payroll. Callers must enforce their own AuthZ
   * before returning any fields to a client.
   */
  function getMasterRecord(employeeId) {
    return EmployeeRepository.findById(employeeId);
  }

  function getDirectReportIds(managerEmployeeId) {
    return EmployeeRepository.listAll()
      .filter(function (e) { return e.manager_employee_id === managerEmployeeId; })
      .map(function (e) { return e.employee_id; });
  }

  function listActiveEmployees() {
    return EmployeeRepository.listAll().filter(function (e) {
      return String(e.status).toUpperCase() === HRMS.EMPLOYEE_STATUS.ACTIVE;
    });
  }

  function matchesDirectoryFilter(employees, query) {
    query = query || {};
    var q = trim_(query.q).toLowerCase();
    var status = trim_(query.status).toUpperCase();
    return employees.filter(function (e) {
      if (status && String(e.status || '').toUpperCase() !== status) return false;
      if (q) {
        var hay = (String(e.employee_id || '') + ' ' + String(e.display_name || '') + ' ' +
          String(e.first_name || '') + ' ' + String(e.last_name || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  return {
    listDirectory: listDirectory,
    listMyTeam: listMyTeam,
    listPicker: listPicker,
    getEmployee: getEmployee,
    getMyProfile: getMyProfile,
    createEmployee: createEmployee,
    updateEmployee: updateEmployee,
    setStatus: setStatus,
    listDocuments: listDocuments,
    listPayslips: listPayslips,
    uploadDocument: uploadDocument,
    downloadDocument: downloadDocument,
    getLeaveSummary: getLeaveSummary,
    isActive: isActive,
    getMasterRecord: getMasterRecord,
    getDirectReportIds: getDirectReportIds,
    listActiveEmployees: listActiveEmployees,
    sanitizeForViewer: sanitizeForViewer,
    matchesDirectoryFilter: matchesDirectoryFilter,
    normalizeEmployeeId: normalizeEmployeeId_,
    isValidEmployeeIdFormat: isValidEmployeeIdFormat_,
    parseCreateUserFlag: parseCreateUserFlag_
  };
})();
