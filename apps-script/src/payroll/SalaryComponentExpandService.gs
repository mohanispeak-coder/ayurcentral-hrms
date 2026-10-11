/**
 * Expand salary structure *templates* (PERCENT_OF_CTC, PERCENT_OF_BASIC, BALANCE_OF_CTC)
 * into payroll-ready component rows (FIXED amounts + PERCENT_OF_BASIC where needed).
 */
var SalaryComponentExpandService = (function () {
  var BASIC_CODES_ = ['BASIC', 'BP', 'BASIC_DA', 'BASIC+DA'];

  function round2_(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    var sign = x < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(x) * 100 + 1e-8) / 100;
  }

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function isBasicCode_(code) {
    return BASIC_CODES_.indexOf(trim_(code).toUpperCase()) >= 0;
  }

  function normalizeBasicCode_(code) {
    var c = trim_(code).toUpperCase();
    return c === 'BP' ? 'BASIC' : c;
  }

  function sortComponents_(components) {
    return (components || []).slice().sort(function (a, b) {
      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });
  }

  function method_(c) {
    return trim_(c.calc_method).toUpperCase();
  }

  function kind_(c) {
    return trim_(c.component_kind).toUpperCase();
  }

  /** Resolve monthly basic (BP) from template lines before expanding dependents. */
  function resolveBasicAmount_(sorted, ctcMonthly) {
    var ctc = Number(ctcMonthly) || 0;
    for (var i = 0; i < sorted.length; i++) {
      var c = sorted[i];
      if (!isBasicCode_(c.component_code)) continue;
      var m = method_(c);
      if (m === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
        return round2_(ctc * (Number(c.percent) || 0) / 100);
      }
      if (m === HRMS.CALC_METHOD.FIXED) {
        return round2_(Number(c.amount) || 0);
      }
    }
    return 0;
  }

  function earningAmountForTemplateLine_(c, ctcMonthly, basicAmount) {
    var m = method_(c);
    var ctc = Number(ctcMonthly) || 0;
    if (m === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
      return round2_(ctc * (Number(c.percent) || 0) / 100);
    }
    if (m === HRMS.CALC_METHOD.PERCENT_OF_BASIC) {
      return round2_(basicAmount * (Number(c.percent) || 0) / 100);
    }
    if (m === HRMS.CALC_METHOD.FIXED) {
      return round2_(Number(c.amount) || 0);
    }
    return 0;
  }

  /**
   * @param {Array} templateComponents rows from SalaryComponents (template)
   * @param {number} ctcMonthly employee monthly CTC
   * @return {Array} components for PayrollEngine (BASIC code, FIXED + PERCENT_OF_BASIC)
   */
  function expandTemplateComponents_(templateComponents, ctcMonthly) {
    var sorted = sortComponents_(templateComponents);
    var ctc = Number(ctcMonthly) || 0;
    var basicAmount = resolveBasicAmount_(sorted, ctc);
    var out = [];
    var earningSum = 0;
    var balanceLines = [];

    sorted.forEach(function (c) {
      var m = method_(c);
      var kind = kind_(c);
      if (m === HRMS.CALC_METHOD.BALANCE_OF_CTC) {
        if (kind !== HRMS.COMPONENT_KIND.EARNING) {
          throw validationError_('BALANCE_OF_CTC is only allowed on EARNING components.');
        }
        balanceLines.push(c);
        return;
      }

      var code = normalizeBasicCode_(c.component_code);
      var row = {
        component_code: code,
        component_name: c.component_name,
        component_kind: c.component_kind,
        calc_method: c.calc_method,
        amount: c.amount,
        percent: c.percent,
        sort_order: c.sort_order
      };

      if (m === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
        var amt = round2_(ctc * (Number(c.percent) || 0) / 100);
        row.calc_method = HRMS.CALC_METHOD.FIXED;
        row.amount = amt;
        row.percent = '';
        if (isBasicCode_(c.component_code)) basicAmount = amt;
        if (kind === HRMS.COMPONENT_KIND.EARNING) earningSum = round2_(earningSum + amt);
      } else if (m === HRMS.CALC_METHOD.PERCENT_OF_BASIC) {
        row.percent = Number(c.percent) || 0;
        row.amount = '';
        if (kind === HRMS.COMPONENT_KIND.EARNING) {
          earningSum = round2_(earningSum + round2_(basicAmount * row.percent / 100));
        }
      } else if (m === HRMS.CALC_METHOD.FIXED) {
        row.amount = round2_(Number(c.amount) || 0);
        if (kind === HRMS.COMPONENT_KIND.EARNING) earningSum = round2_(earningSum + row.amount);
      }

      out.push(row);
    });

    if (balanceLines.length > 1) {
      throw validationError_('Only one EARNING component can use Remainder of CTC (balance).');
    }
    if (balanceLines.length === 1) {
      var bal = round2_(ctc - earningSum);
      if (bal < -0.01) {
        throw validationError_('Earning components exceed monthly CTC by ' + round2_(-bal) + ' (check BP, HRA, and other lines).');
      }
      if (bal < 0) bal = 0;
      var bc = balanceLines[0];
      out.push({
        component_code: normalizeBasicCode_(bc.component_code),
        component_name: bc.component_name,
        component_kind: bc.component_kind,
        calc_method: HRMS.CALC_METHOD.FIXED,
        amount: bal,
        percent: '',
        sort_order: bc.sort_order
      });
    }

    out.sort(function (a, b) {
      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });
    return out;
  }

  function sumExpandedEarnings_(expanded) {
    var basicAmount = 0;
    expanded.forEach(function (c) {
      if (isBasicCode_(c.component_code) && method_(c) === HRMS.CALC_METHOD.FIXED) {
        basicAmount = round2_(Number(c.amount) || 0);
      }
    });
    var sum = 0;
    expanded.forEach(function (c) {
      if (kind_(c) !== HRMS.COMPONENT_KIND.EARNING) return;
      var m = method_(c);
      if (m === HRMS.CALC_METHOD.FIXED) {
        sum = round2_(sum + (Number(c.amount) || 0));
      } else if (m === HRMS.CALC_METHOD.PERCENT_OF_BASIC) {
        sum = round2_(sum + round2_(basicAmount * (Number(c.percent) || 0) / 100));
      }
    });
    return sum;
  }

  /** Non-blocking warning when expanded earnings do not match sample CTC. */
  function earningsReconcileWarning_(components, sampleCtc) {
    sampleCtc = Number(sampleCtc) || 50000;
    try {
      var expanded = expandTemplateComponents_(components, sampleCtc);
      var sum = sumExpandedEarnings_(expanded);
      if (Math.abs(sum - sampleCtc) > 0.02) {
        return 'On a sample CTC of ' + sampleCtc + ', earnings total ' + sum +
          ' (expected ' + sampleCtc + '). Check BP %, HRA % of basic, and balance line.';
      }
    } catch (e) {
      return (e && e.message) ? String(e.message) : 'Could not validate earnings against CTC.';
    }
    return '';
  }

  return {
    expandTemplateComponents: expandTemplateComponents_,
    earningsReconcileWarning: earningsReconcileWarning_,
    resolveBasicAmount: resolveBasicAmount_,
    isBasicCode: isBasicCode_
  };
})();
