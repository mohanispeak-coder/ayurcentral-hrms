/**
 * Drive root auto-setup behavior (Node mock).
 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

function folderMock(id) {
  return {
    getId: function () { return id; },
    getName: function () { return 'folder'; },
    getUrl: function () { return 'https://drive/' + id; },
    getFoldersByName: function () { return { hasNext: function () { return false; } }; },
    createFolder: function (name) { return folderMock(id + '-' + name); }
  };
}

function loadDriveService() {
  var rootId = '';
  var createdRoot = false;
  var ctx = {
    HRMS: {
      SHEETS: { SETTINGS: 'Settings' },
      DRIVE: { ROOT_NAME: 'HRMS Root', EMPLOYEE_DOCS: 'Employee Documents', PAYSLIPS: 'Payslips' },
      PROPS: { DRIVE_ROOT_FOLDER_ID: 'HRMS_DRIVE_ROOT_FOLDER_ID' }
    },
    ConfigService: {
      getDriveRootFolderId: function () { return rootId; },
      getSetting: function () { return ''; },
      setDriveRootFolderId: function (id) { rootId = id; },
      clearSettingsCache: function () {}
    },
    DbService: {
      updateRecord: function () {},
      invalidateSheetData: function () {}
    },
    DriveApp: {
      getFolderById: function (id) {
        if (id === 'valid-root' || id === 'new-root') return folderMock(id);
        throw new Error('not found');
      },
      createFolder: function () {
        createdRoot = true;
        return folderMock('new-root');
      }
    },
    Session: { getActiveUser: function () { return { getEmail: function () { return 'admin@test.com'; } }; } },
    withScriptLock_: function (fn) { return fn(); },
    configurationError_: function (msg) { throw new Error(msg); }
  };
  vm.runInNewContext(fs.readFileSync(
    path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'DriveService.gs'), 'utf8'), ctx);
  return {
    DriveService: ctx.DriveService,
    setRootId: function (id) { rootId = id; },
    wasCreated: function () { return createdRoot; }
  };
}

var env = loadDriveService();
var fails = 0;

function check(name, ok, detail) {
  if (!ok) {
    fails++;
    console.error('FAIL', name, detail || '');
  } else {
    console.log('PASS', name);
  }
}

env.setRootId('valid-root');
check('reuses valid root', env.DriveService.getRootFolder().getId() === 'valid-root');

env.setRootId('stale-root');
check('recreates stale root', env.DriveService.getRootFolder().getId() === 'new-root');
check('setup created root', env.wasCreated());

if (fails) {
  console.error(fails + ' test(s) failed');
  process.exit(1);
}
console.log('All drive auto-setup tests passed');
