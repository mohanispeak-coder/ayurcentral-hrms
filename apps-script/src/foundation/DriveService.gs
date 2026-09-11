/**
 * Drive folder abstraction — no public links.
 */
var HRMS = HRMS || {};

var DriveService = (function () {
  function getRootFolderId_() {
    var fromProp = ConfigService.getDriveRootFolderId();
    if (fromProp) return fromProp;
    var fromSetting = ConfigService.getSetting('drive_root_folder_id', '');
    return fromSetting || '';
  }

  /**
   * Returns HRMS Drive root, auto-creating folder structure when missing or stale.
   * Web app runs as script owner — no manual Drive setup required for HR uploads.
   */
  function getRootFolder() {
    var id = getRootFolderId_();
    if (id) {
      try {
        return DriveApp.getFolderById(id);
      } catch (ignore) {
        // Configured folder was deleted or is inaccessible — recreate below.
      }
    }
    var result = setupRootStructure();
    return DriveApp.getFolderById(result.rootFolderId);
  }

  function findChildFolder_(parent, name) {
    var it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : null;
  }

  function getOrCreateChildFolder_(parent, name) {
    var existing = findChildFolder_(parent, name);
    if (existing) return existing;
    return parent.createFolder(name);
  }

  /**
   * Create HRMS Root with Employee Documents and Payslips subfolders.
   * Idempotent — reuses existing root when configured and accessible.
   * @return {Object}
   */
  function setupRootStructure() {
    return withScriptLock_(function () {
      var existingId = getRootFolderId_();
      if (existingId) {
        try {
          DriveApp.getFolderById(existingId);
          var ensured = ensureRootStructure();
          return {
            rootFolderId: ensured.rootFolderId,
            rootFolderUrl: DriveApp.getFolderById(ensured.rootFolderId).getUrl(),
            employeeDocumentsFolderId: ensured.employeeDocumentsFolderId,
            payslipsFolderId: ensured.payslipsFolderId,
            reusedExisting: true
          };
        } catch (ignore) {
          // Configured ID invalid — create a new root below.
        }
      }

      var root = DriveApp.createFolder(HRMS.DRIVE.ROOT_NAME);
      var employeeDocs = getOrCreateChildFolder_(root, HRMS.DRIVE.EMPLOYEE_DOCS);
      var payslips = getOrCreateChildFolder_(root, HRMS.DRIVE.PAYSLIPS);
      ConfigService.setDriveRootFolderId(root.getId());
      try {
        DbService.updateRecord(HRMS.SHEETS.SETTINGS, 'setting_key', 'drive_root_folder_id', {
          setting_value: root.getId(),
          updated_at: new Date(),
          updated_by_email: Session.getActiveUser().getEmail().toLowerCase() || 'system'
        });
        ConfigService.clearSettingsCache();
      } catch (ignore) {}
      return {
        rootFolderId: root.getId(),
        rootFolderUrl: root.getUrl(),
        employeeDocumentsFolderId: employeeDocs.getId(),
        payslipsFolderId: payslips.getId(),
        reusedExisting: false
      };
    });
  }

  function ensureRootStructure() {
    var root = getRootFolder();
    var employeeDocs = getOrCreateChildFolder_(root, HRMS.DRIVE.EMPLOYEE_DOCS);
    var payslips = getOrCreateChildFolder_(root, HRMS.DRIVE.PAYSLIPS);
    return {
      rootFolderId: root.getId(),
      employeeDocumentsFolderId: employeeDocs.getId(),
      payslipsFolderId: payslips.getId()
    };
  }

  function getEmployeeDocumentsFolder(employeeId) {
    var root = getRootFolder();
    var parent = getOrCreateChildFolder_(root, HRMS.DRIVE.EMPLOYEE_DOCS);
    return getOrCreateChildFolder_(parent, String(employeeId));
  }

  function getPayslipYearFolder(year) {
    var root = getRootFolder();
    var payslips = getOrCreateChildFolder_(root, HRMS.DRIVE.PAYSLIPS);
    return getOrCreateChildFolder_(payslips, String(year));
  }

  function getPayslipMonthFolder(year, month) {
    var yearFolder = getPayslipYearFolder(year);
    var m = String(Number(month));
    if (m.length < 2) m = '0' + m;
    var monthLabel = m + '-' + monthName_(month);
    return getOrCreateChildFolder_(yearFolder, monthLabel);
  }

  function monthName_(month) {
    var names = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return names[Number(month) - 1] || 'Month';
  }

  function verifyAccess() {
    var root = getRootFolder();
    return {
      accessible: true,
      rootFolderId: root.getId(),
      rootFolderName: root.getName()
    };
  }

  return {
    setupRootStructure: setupRootStructure,
    ensureRootStructure: ensureRootStructure,
    getRootFolder: getRootFolder,
    getEmployeeDocumentsFolder: getEmployeeDocumentsFolder,
    getPayslipMonthFolder: getPayslipMonthFolder,
    verifyAccess: verifyAccess
  };
})();
