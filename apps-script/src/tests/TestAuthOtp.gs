/**
 * OTP authentication tests — pure logic with in-memory store (no MailApp/Session).
 */

function testAuthOtp_All() {
  var results = [];
  function record(name, passed, detail) {
    results.push({ name: name, passed: passed, detail: detail || '' });
    Logger.log((passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
  }

  var store = {};
  var sent = [];
  var now = Date.now();

  function ctx(userMap, demoEmails) {
    userMap = userMap || {};
    demoEmails = demoEmails || [];
    return {
      findUser: function (email) {
        return userMap[hrmsAuthNormalizeEmail_(email)] || null;
      },
      isDemoAllowed: function (email) {
        return demoEmails.indexOf(hrmsAuthNormalizeEmail_(email)) >= 0;
      },
      sendMail: function (email, otp) {
        sent.push({ email: email, otp: otp });
      },
      store: store,
      memoryOnly: true,
      now: now
    };
  }

  function verifyCtx(customNow) {
    return { store: store, memoryOnly: true, now: customNow != null ? customNow : now };
  }

  function freshOtpState_() {
    // Clear in place so ctx()/verifyCtx() closures keep the same store object.
    Object.keys(store).forEach(function (key) {
      delete store[key];
    });
    sent = [];
  }

  function lastOtpOrFail_(label, reqResult) {
    if (!sent.length || !sent[sent.length - 1].otp) {
      var detail = reqResult && !reqResult.ok ? (reqResult.reason || reqResult.message) : 'no mail sent';
      throw new Error(label + ': expected OTP to be sent (' + detail + ')');
    }
    return sent[sent.length - 1].otp;
  }

  var activeUser = 'alice@client.com';
  var externalUser = 'bob@gmail.com';
  var disabledUser = 'disabled@client.com';
  var unknownUser = 'unknown@gmail.com';
  var demoUser = 'dev@gmail.com';

  var users = {};
  users[activeUser] = {
    google_email: activeUser,
    employee_id: 'EMP001',
    role: HRMS.ROLES.EMPLOYEE,
    status: HRMS.USER_STATUS.ACTIVE
  };
  users[externalUser] = {
    google_email: externalUser,
    employee_id: 'EMP002',
    role: HRMS.ROLES.HR,
    status: HRMS.USER_STATUS.ACTIVE
  };
  users[disabledUser] = {
    google_email: disabledUser,
    employee_id: 'EMP099',
    role: HRMS.ROLES.EMPLOYEE,
    status: HRMS.USER_STATUS.DISABLED
  };

  // 1. ActiveUser same-domain login (Path A)
  var pathA = hrmsResolveAuthAccess_(hrmsAuthBuildAccessInputForTest_(activeUser, users, HRMS.APP_MODE.PRODUCTION, []));
  record('activeUserSameDomainLogin', pathA.authorized === true && pathA.role === HRMS.ROLES.EMPLOYEE, pathA.role);

  // 2. External/personal email OTP login
  freshOtpState_();
  var reqExt = hrmsAuthOtpRequest_(externalUser, ctx(users));
  record('externalOtpRequestSent', reqExt.ok === true && sent.length === 1 && sent[0].email === externalUser,
    reqExt.ok ? 'sent' : (reqExt.reason || reqExt.message));
  var otpCode = reqExt.ok ? lastOtpOrFail_('externalOtp') : '';
  record('otpNotEmpty', reqExt.ok && /^\d{6}$/.test(otpCode), otpCode || reqExt.reason);
  var verifyExt = reqExt.ok
    ? hrmsAuthOtpVerify_(externalUser, otpCode, verifyCtx())
    : { ok: false };
  record('externalOtpLogin', verifyExt.ok === true && !!verifyExt.sessionToken);
  var emailFromToken = verifyExt.ok
    ? hrmsAuthSessionGetEmail_(verifyExt.sessionToken, store, true)
    : '';
  var sessionExt = emailFromToken
    ? hrmsResolveAuthAccess_(hrmsAuthBuildAccessInputForTest_(emailFromToken, users, HRMS.APP_MODE.PRODUCTION, []))
    : { authorized: false };
  record('externalSessionResolvesUser', sessionExt.authorized === true && sessionExt.role === HRMS.ROLES.HR, sessionExt.role);

  // 3. Unknown email
  var reqUnknown = hrmsAuthOtpRequest_(unknownUser, ctx(users));
  record('unknownEmailDenied', reqUnknown.ok === false && reqUnknown.reason === 'UNKNOWN_USER');

  // 4. Disabled user
  var reqDisabled = hrmsAuthOtpRequest_(disabledUser, ctx(users));
  record('disabledUserDenied', reqDisabled.ok === false && reqDisabled.reason === 'DISABLED');

  // 5. Invalid OTP
  freshOtpState_();
  hrmsAuthOtpRequest_(externalUser, ctx(users));
  var badVerify = hrmsAuthOtpVerify_(externalUser, '000000', verifyCtx());
  record('invalidOtpRejected', badVerify.ok === false && badVerify.reason === 'INVALID');

  // 6. Expired OTP
  freshOtpState_();
  hrmsAuthOtpRequest_(externalUser, ctx(users));
  var expiredVerify = hrmsAuthOtpVerify_(externalUser, lastOtpOrFail_('expiredOtp'), verifyCtx(now + HRMS.AUTH_LIMITS.OTP_TTL_MS + 1));
  record('expiredOtpRejected', expiredVerify.ok === false && expiredVerify.reason === 'EXPIRED');

  // 7. Reused OTP
  freshOtpState_();
  var reqReuse = hrmsAuthOtpRequest_(externalUser, ctx(users));
  var code = lastOtpOrFail_('reusedOtp', reqReuse);
  var firstUse = hrmsAuthOtpVerify_(externalUser, code, verifyCtx());
  var secondUse = hrmsAuthOtpVerify_(externalUser, code, verifyCtx(now + 1000));
  record('reusedOtpRejected', firstUse.ok === true && secondUse.ok === false && secondUse.reason === 'EXPIRED');

  // 8. New OTP invalidates previous OTP
  freshOtpState_();
  hrmsAuthOtpRequest_(externalUser, ctx(users));
  var oldCode = lastOtpOrFail_('invalidateOldOtp');
  hrmsAuthOtpRequest_(externalUser, ctx(users, []));
  var newCode = lastOtpOrFail_('invalidateNewOtp');
  var oldAfterNew = hrmsAuthOtpVerify_(externalUser, oldCode, verifyCtx(now + 2000));
  var newOk = hrmsAuthOtpVerify_(externalUser, newCode, verifyCtx(now + 2000));
  record('newOtpInvalidatesPrevious', oldAfterNew.ok === false && newOk.ok === true);

  // 9. More than 3 requests within 15 minutes
  freshOtpState_();
  var c = ctx(users);
  hrmsAuthOtpRequest_(externalUser, c);
  hrmsAuthOtpRequest_(externalUser, c);
  hrmsAuthOtpRequest_(externalUser, c);
  var fourth = hrmsAuthOtpRequest_(externalUser, c);
  record('otpRateLimit', fourth.ok === false && fourth.reason === 'RATE_LIMIT', fourth.reason);

  // 10. More than 5 verification attempts
  freshOtpState_();
  hrmsAuthOtpRequest_(externalUser, ctx(users));
  var attempts = 0;
  var locked = null;
  for (var i = 0; i < 6; i++) {
    locked = hrmsAuthOtpVerify_(externalUser, '111111', verifyCtx(now + 3000));
    if (locked.reason === 'LOCKED') {
      attempts = i + 1;
      break;
    }
  }
  record('otpVerifyAttemptLimit', locked.ok === false && locked.reason === 'LOCKED' && attempts === 5);

  // 11. Session active before expiry
  freshOtpState_();
  hrmsAuthOtpRequest_(externalUser, ctx(users));
  var v = hrmsAuthOtpVerify_(externalUser, lastOtpOrFail_('sessionActive'), verifyCtx());
  record('sessionActiveBeforeExpiry', v.ok === true &&
    hrmsAuthSessionGetEmail_(v.sessionToken, store, true) === externalUser);

  // 12. Logout
  freshOtpState_();
  hrmsAuthOtpRequest_(externalUser, ctx(users));
  var loggedIn = hrmsAuthOtpVerify_(externalUser, lastOtpOrFail_('logout'), verifyCtx());
  hrmsAuthSessionInvalidate_(loggedIn.sessionToken, store, true);
  record('logoutInvalidatesSession', hrmsAuthSessionGetEmail_(loggedIn.sessionToken, store, true) === '');

  // 13. RBAC after OTP authentication
  var hrSession = {
    authorized: true,
    role: HRMS.ROLES.HR,
    employee_id: 'EMP002',
    email: externalUser
  };
  record('rbacAfterOtpHrPayroll', PermissionService.can(HRMS.ACTIONS.PAYROLL_RUN, {}, hrSession));
  record('rbacAfterOtpEmployeeDenied', !PermissionService.can(HRMS.ACTIONS.PAYROLL_RUN, {}, {
    authorized: true, role: HRMS.ROLES.EMPLOYEE, employee_id: 'EMP001', email: activeUser
  }));

  // 14. Employee without Spreadsheet ACL (deployment model)
  record('employeeNoSpreadsheetAcl', HRMS.WEBAPP.EXECUTE_AS === 'USER_DEPLOYING');

  // 15. Employee without Drive ACL
  record('employeeNoDriveAcl', HRMS.WEBAPP.EXECUTE_AS === 'USER_DEPLOYING');

  // 16. DEMO mode still works
  var demoSession = hrmsResolveAuthAccess_(hrmsAuthBuildAccessInputForTest_(demoUser, {}, HRMS.APP_MODE.DEMO, [demoUser]));
  record('demoModeWorks', demoSession.authorized === true && demoSession.demo === true, demoSession.role);

  // 17. Production does not allow demo users unless configured
  var prodDemoDenied = hrmsResolveAuthAccess_(hrmsAuthBuildAccessInputForTest_(demoUser, {}, HRMS.APP_MODE.PRODUCTION, [demoUser]));
  record('productionBlocksUnconfiguredDemo', prodDemoDenied.authorized === false && prodDemoDenied.reason === 'UNKNOWN_USER');

  // 18. PermissionService accepts pre-resolved OTP/demo session (regression: require ignored session arg)
  var demoOtpSession = hrmsResolveAuthAccess_(hrmsAuthBuildAccessInputForTest_(demoUser, {}, HRMS.APP_MODE.DEMO, [demoUser]));
  record('permissionRequireUsesPassedSession', PermissionService.require(HRMS.ACTIONS.ACCESS_APP, {}, demoOtpSession).authorized === true);

  // 19. Demo allowlisted email exceeds production 3-request cap (demo bucket, limit 20)
  freshOtpState_();
  var demoCtx = ctx({}, [demoUser]);
  var demoReq4 = null;
  for (var d = 0; d < 4; d++) {
    demoReq4 = hrmsAuthOtpRequest_(demoUser, demoCtx);
  }
  record('demoAllowlistExceedsThreeRequests', demoReq4.ok === true, demoReq4.reason || '4th ok');

  // 20. Demo path still requires OTP verification (wrong code rejected, correct code works)
  freshOtpState_();
  hrmsAuthOtpRequest_(demoUser, demoCtx);
  var demoBad = hrmsAuthOtpVerify_(demoUser, '000000', verifyCtx());
  var demoCode = lastOtpOrFail_('demoVerify');
  var demoGood = hrmsAuthOtpVerify_(demoUser, demoCode, verifyCtx());
  record('demoStillRequiresOtpVerify',
    demoBad.ok === false && demoBad.reason === 'INVALID' &&
    demoGood.ok === true && !!demoGood.sessionToken,
    demoBad.reason);

  // 21. Demo and production rate buckets are independent (same store)
  freshOtpState_();
  var prodCtx = ctx(users);
  hrmsAuthOtpRequest_(externalUser, prodCtx);
  hrmsAuthOtpRequest_(externalUser, prodCtx);
  hrmsAuthOtpRequest_(externalUser, prodCtx);
  var prodBlocked = hrmsAuthOtpRequest_(externalUser, prodCtx);
  var demoAfterProd = hrmsAuthOtpRequest_(demoUser, demoCtx);
  record('demoBucketSeparateFromProduction',
    prodBlocked.ok === false && prodBlocked.reason === 'RATE_LIMIT' && demoAfterProd.ok === true,
    'prod=' + prodBlocked.reason + ' demo=' + (demoAfterProd.ok ? 'ok' : demoAfterProd.reason));

  // 22. Users row always uses production bucket even if email is also on demo allowlist
  freshOtpState_();
  var dualCtx = ctx(users, [externalUser]);
  hrmsAuthOtpRequest_(externalUser, dualCtx);
  hrmsAuthOtpRequest_(externalUser, dualCtx);
  hrmsAuthOtpRequest_(externalUser, dualCtx);
  var dualFourth = hrmsAuthOtpRequest_(externalUser, dualCtx);
  record('usersRowUsesProductionBucket',
    dualFourth.ok === false && dualFourth.reason === 'RATE_LIMIT', dualFourth.reason);

  // 23. Without demo allowlist, demo email cannot use demo bucket (UNKNOWN_USER)
  freshOtpState_();
  var prodOnlyCtx = ctx({}, []);
  var prodOnlyDemo = hrmsAuthOtpRequest_(demoUser, prodOnlyCtx);
  record('productionNeverUsesDemoBucket',
    prodOnlyDemo.ok === false && prodOnlyDemo.reason === 'UNKNOWN_USER', prodOnlyDemo.reason);

  // 24. devClearAuthOtpState helper clears rate limit without granting session
  freshOtpState_();
  hrmsAuthOtpRequest_(externalUser, prodCtx);
  hrmsAuthOtpRequest_(externalUser, prodCtx);
  hrmsAuthOtpRequest_(externalUser, prodCtx);
  var beforeClear = hrmsAuthOtpRequest_(externalUser, prodCtx);
  hrmsAuthClearOtpStateForEmail_(externalUser, store, true);
  var afterClear = hrmsAuthOtpRequest_(externalUser, prodCtx);
  record('clearOtpStateResetsRateLimit',
    beforeClear.ok === false && beforeClear.reason === 'RATE_LIMIT' && afterClear.ok === true,
    beforeClear.reason);
  record('clearOtpStateDoesNotGrantSession',
    hrmsAuthSessionGetEmail_('fake-token', store, true) === '', 'no session created');

  var failed = results.filter(function (r) { return !r.passed; });
  Logger.log('Auth OTP tests: ' + (results.length - failed.length) + '/' + results.length + ' passed');
  return { results: results, allPassed: failed.length === 0, failedCount: failed.length };
}

/** Test helper mirroring AuthService.buildAccessInput_ shape. */
function hrmsAuthBuildAccessInputForTest_(email, userMap, appMode, demoEmails) {
  userMap = userMap || {};
  email = hrmsAuthNormalizeEmail_(email);
  return {
    email: email,
    appMode: appMode,
    demoEmails: demoEmails || [],
    demoRole: HRMS.ROLES.ADMIN,
    user: userMap[email] || null,
    displayName: '',
    dbError: false
  };
}
