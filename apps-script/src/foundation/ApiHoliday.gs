/**
 * Holiday calendar APIs (HR / attendance).
 */

function apiHolidayList(query, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return HolidayCalendarService.listForClient(session, query || {});
  }, sessionToken);
}

function apiHolidaySave(payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return HolidayCalendarService.saveHoliday(session, payload || {});
  }, sessionToken);
}

function apiHolidayDelete(holidayId, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return HolidayCalendarService.deleteHoliday(session, holidayId);
  }, sessionToken);
}

function apiHolidayValidateImport(meta, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return HolidayCalendarService.validateImport(session, meta || {});
  }, sessionToken);
}

function apiHolidayCommitImport(payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return HolidayCalendarService.commitImport(session, payload || {});
  }, sessionToken);
}

function apiHolidayApplyPreset(payload, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return HolidayCalendarService.applyPreset(session, payload || {});
  }, sessionToken);
}

function apiHolidayDownloadImportTemplate(sessionToken) {
  return hrmsRun_(function () {
    AuthService.requireAuth();
    return HolidayCalendarService.downloadImportTemplate();
  }, sessionToken);
}

function apiHolidayDownloadYearTemplate(calendarYear, sessionToken) {
  return hrmsRun_(function () {
    AuthService.requireAuth();
    var y = calendarYear;
    if (y && typeof y === 'object') {
      y = y.calendar_year || y.year;
    }
    return HolidayCalendarService.downloadYearTemplate(y);
  }, sessionToken);
}

function apiHolidayListForMonth(year, month, vertical, sessionToken) {
  return hrmsRun_(function () {
    var session = AuthService.requireAuth();
    return HolidayCalendarService.listForMonthClient(session, year, month, vertical);
  }, sessionToken);
}
