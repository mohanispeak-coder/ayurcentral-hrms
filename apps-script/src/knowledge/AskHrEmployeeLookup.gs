/**
 * Ask HR self-profile answers from the authenticated employee record.
 * Only MY_MANAGER and MY_DEPARTMENT are handled locally.
 * All other questions (including directory lookups) fall through to Ayurveda-AI.
 */
var HRMS = HRMS || {};

var AskHrEmployeeLookup = (function () {
  function trim_(s) {
    return String(s || '').replace(/^\s+|\s+$/g, '');
  }

  function normalize_(s) {
    return trim_(s).toLowerCase().replace(/\s+/g, ' ');
  }

  function displayName_(emp) {
    return emp.display_name || trim_(emp.first_name + ' ' + emp.last_name);
  }

  function managerNameMap_(employees) {
    var map = {};
    employees.forEach(function (e) {
      map[e.employee_id] = displayName_(e);
    });
    return map;
  }

  function classifyQuestion_(question) {
    var q = normalize_(question);
    if (!q) return null;

    if (/\bmy\s+(reporting\s+)?manager\b/.test(q) || /\bwho\s+is\s+my\s+manager\b/.test(q)) {
      return { kind: 'MY_MANAGER' };
    }
    if (/\bmy\s+department\b/.test(q) || /\bwhich\s+department\s+am\s+i\b/.test(q)) {
      return { kind: 'MY_DEPARTMENT' };
    }

    return null;
  }

  function notFoundAnswer_(message) {
    return {
      handled: true,
      answer: message || "I couldn't find enough information in the HR knowledge base to answer this confidently.",
      keyPoints: [],
      references: [],
      notFound: true
    };
  }

  function successAnswer_(answer) {
    return {
      handled: true,
      answer: answer,
      keyPoints: [],
      references: [],
      notFound: false
    };
  }

  function answerMyProfile_(session, kind, nameMap) {
    if (!session.employee_id) {
      return notFoundAnswer_('Your account is not linked to an employee record.');
    }
    var self = EmployeeRepository.findById(session.employee_id);
    if (!self) {
      return notFoundAnswer_('Your employee record could not be found.');
    }
    if (kind === 'MY_MANAGER') {
      if (!self.manager_employee_id) {
        return successAnswer_('No reporting manager is recorded for your profile.');
      }
      var mgrName = nameMap[self.manager_employee_id] || self.manager_employee_id;
      return successAnswer_('Your reporting manager is **' + mgrName + '**.');
    }
    return successAnswer_('You belong to the **' + (self.department || '—') + '** department.');
  }

  /**
   * @param {Object} session Authorized HRMS session
   * @param {string} question
   * @return {{ handled: boolean, answer?: string, keyPoints?: Array, references?: Array, notFound?: boolean }}
   */
  function tryAnswer(session, question) {
    var classified = classifyQuestion_(question);
    if (!classified) {
      return { handled: false };
    }

    var nameMap = managerNameMap_(EmployeeRepository.listAll());
    return answerMyProfile_(session, classified.kind, nameMap);
  }

  return {
    tryAnswer: tryAnswer,
    classifyQuestion: classifyQuestion_
  };
})();
