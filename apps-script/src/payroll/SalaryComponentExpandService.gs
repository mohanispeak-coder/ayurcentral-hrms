/**
 * Expand salary structure templates into payroll-ready FIXED (+ PERCENT_OF_BASIC) rows.
 * Supports PERCENT + percent_base (CTC or prior component code), FIXED, BALANCE_OF_CTC,
 * and legacy PERCENT_OF_CTC / PERCENT_OF_BASIC.
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

  function canonicalMethod_(c) {
    var m = method_(c);
    if (m === HRMS.CALC_METHOD.PERCENT_OF_CTC) {
      return { method: HRMS.CALC_METHOD.PERCENT, percent_base: HRMS.PERCENT_BASE_CTC };
    }
    if (m === HRMS.CALC_METHOD.PERCENT_OF_BASIC) {
      var legacyBase = trim_(c.percent_base).toUpperCase();
      return {
        method: HRMS.CALC_METHOD.PERCENT,
        percent_base: legacyBase || 'BP'
      };
    }
    if (m === HRMS.CALC_METHOD.PERCENT) {
      return {
        method: HRMS.CALC_METHOD.PERCENT,
        percent_base: trim_(c.percent_base).toUpperCase() || HRMS.PERCENT_BASE_CTC
      };
    }
    return { method: m, percent_base: trim_(c.percent_base).toUpperCase() };
  }

  function aliasAmounts_(amounts, code, amt) {
    var u = trim_(code).toUpperCase();
    amounts[u] = amt;
    if (u === 'BP' || u === 'BASIC') {
      amounts.BP = amt;
      amounts.BASIC = amt;
    }
  }

  function baseAmount_(amounts, ctc, baseKey) {
    baseKey = trim_(baseKey).toUpperCase();
    if (!baseKey || baseKey === HRMS.PERCENT_BASE_CTC) return round2_(ctc);
    if (amounts[baseKey] != null) return round2_(amounts[baseKey]);
    if (baseKey === 'BP' && amounts.BASIC != null) return round2_(amounts.BASIC);
    if (baseKey === 'BASIC' && amounts.BP != null) return round2_(amounts.BP);
    return null;
  }

  /**
   * @param {Array} templateComponents rows from SalaryComponents (template)
   * @param {number} ctcMonthly employee monthly CTC
   * @return {Array} components for PayrollEngine
   */
  function expandTemplateComponents_(templateComponents, ctcMonthly) {
    var sorted = sortComponents_(templateComponents);
    var ctc = Number(ctcMonthly) || 0;
    var amounts = {};
    var out = [];
    var earningSum = 0;
    var balanceLines = [];

    sorted.forEach(function (raw) {
      var canon = canonicalMethod_(raw);
      var m = canon.method;
      var kind = kind_(raw);
      var code = trim_(raw.component_code).toUpperCase();

      if (m === HRMS.CALC_METHOD.BALANCE_OF_CTC) {
        if (kind !== HRMS.COMPONENT_KIND.EARNING) {
          throw validationError_('Remainder of CTC is only allowed on EARNING components.');
        }
        balanceLines.push(raw);
        return;
      }

      var payrollCode = normalizeBasicCode_(raw.component_code);
      var row = {
        component_code: payrollCode,
        component_name: raw.component_name,
        component_kind: raw.component_kind,
        calc_method: HRMS.CALC_METHOD.FIXED,
        amount: 0,
        percent: '',
        sort_order: raw.sort_order
      };

      if (m === HRMS.CALC_METHOD.PERCENT) {
        var pct = Number(raw.percent) || 0;
        var baseAmt = baseAmount_(amounts, ctc, canon.percent_base);
        if (baseAmt == null) {
          throw validationError_('Component ' + code + ': base "' + canon.percent_base +
            '" is not defined yet. Place base components above this row.');
        }
        var amt = round2_(baseAmt * pct / 100);
        row.amount = amt;
        aliasAmounts_(amounts, code, amt);
        if (kind === HRMS.COMPONENT_KIND.EARNING) earningSum = round2_(earningSum + amt);
        out.push(row);
      } else if (m === HRMS.CALC_METHOD.FIXED) {
        var fixed = round2_(Number(raw.amount) || 0);
        row.amount = fixed;
        aliasAmounts_(amounts, code, fixed);
        if (kind === HRMS.COMPONENT_KIND.EARNING) earningSum = round2_(earningSum + fixed);
        out.push(row);
      } else {
        throw validationError_('Unsupported calc_method on template: ' + m);
      }
    });

    if (balanceLines.length > 1) {
      throw validationError_('Only one EARNING component can use Remainder of CTC.');
    }
    if (balanceLines.length === 1) {
      var bal = round2_(ctc - earningSum);
      if (bal < -0.01) {
        throw validationError_('Earning components exceed monthly CTC by ' + round2_(-bal) + '.');
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
    var sum = 0;
    expanded.forEach(function (c) {
      if (kind_(c) !== HRMS.COMPONENT_KIND.EARNING) return;
      if (method_(c) === HRMS.CALC_METHOD.FIXED) {
        sum = round2_(sum + (Number(c.amount) || 0));
      }
    });
    return sum;
  }

  function earningsReconcileWarning_(components, sampleCtc) {
    sampleCtc = Number(sampleCtc) || 50000;
    try {
      var expanded = expandTemplateComponents_(components, sampleCtc);
      var sum = sumExpandedEarnings_(expanded);
      if (Math.abs(sum - sampleCtc) > 0.02) {
        return 'On a sample CTC of ' + sampleCtc + ', earnings total ' + sum +
          ' (expected ' + sampleCtc + '). Check %, base, fixed lines, and remainder.';
      }
    } catch (e) {
      return (e && e.message) ? String(e.message) : 'Could not validate earnings against CTC.';
    }
    return '';
  }

  return {
    expandTemplateComponents: expandTemplateComponents_,
    earningsReconcileWarning: earningsReconcileWarning_,
    canonicalMethod: canonicalMethod_,
    isBasicCode: isBasicCode_
  };
})();
