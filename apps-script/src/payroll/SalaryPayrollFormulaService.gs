/**
 * Payroll calculate using salary structure template sections (rate, earned proration, deduction rules).
 */
var SalaryPayrollFormulaService = (function () {
  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function roundMode_(mode, n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    mode = trim_(mode).toUpperCase() || HRMS.FORMULA_ROUND.ROUND;
    if (mode === HRMS.FORMULA_ROUND.ROUNDUP) {
      return Math.ceil(x - 1e-9);
    }
    if (mode === HRMS.FORMULA_ROUND.NONE) {
      return x;
    }
    return PayrollEngine.round2(x);
  }

  function num_(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function section_(c) {
    return trim_(c.structure_section).toUpperCase();
  }

  function method_(c) {
    return trim_(c.calc_method).toUpperCase();
  }

  function kind_(c) {
    return trim_(c.component_kind).toUpperCase();
  }

  function compare_(left, op, right) {
    op = trim_(op).toUpperCase();
    if (op === 'LT') return left < right;
    if (op === 'LTE') return left <= right;
    if (op === 'GT') return left > right;
    if (op === 'GTE') return left >= right;
    return false;
  }

  function refAmount_(ref, ctx) {
    ref = trim_(ref).toUpperCase();
    if (ref === HRMS.FORMULA_REF.RATE_GROSS) return ctx.rateGross;
    if (ref === HRMS.FORMULA_REF.EARNED_GROSS) return ctx.earnedGross;
    if (ref === HRMS.PERCENT_BASE_CTC) return ctx.ctcMonthly;
    if (ctx.earnedByCode[ref] != null) return ctx.earnedByCode[ref];
    if (ctx.rateByCode[ref] != null) return ctx.rateByCode[ref];
    return 0;
  }

  function manualAmount_(code, inputs) {
    code = trim_(code).toUpperCase();
    inputs = inputs || {};
    if (code === 'TDS') return num_(inputs.tds_amount);
    if (code === 'ADVANCE' || code === 'LCD' || code === 'LWF' || code === 'LWE') {
      return num_(inputs.other_deductions);
    }
    return 0;
  }

  function parseRules_(rules) {
    if (!rules) return { earned_prorate: 'ROUND_LINE', arrears_add_codes: ['ARREARS'] };
    if (typeof rules === 'string') {
      try { rules = JSON.parse(rules); } catch (e) { rules = {}; }
    }
    return {
      earned_prorate: trim_(rules.earned_prorate) || 'ROUND_LINE',
      arrears_add_codes: rules.arrears_add_codes || ['ARREARS']
    };
  }

  /**
   * @param {Object} args structure, components (expanded rate FIXED amounts), templateComponents, inputs, settings, employee
   */
  function calculateEmployee_(args) {
    args = args || {};
    var inputs = args.inputs || {};
    var settings = args.settings || {};
    var employee = args.employee || {};
    var structure = args.structure || null;
    var rateComponents = args.components || [];
    var templateComponents = args.templateComponents || [];
    var rules = parseRules_(args.payroll_rules);

    var factorInfo = PayrollEngine.prorationFactor(inputs.paid_days, inputs.working_days);
    if (!factorInfo.ok) {
      return PayrollEngine.calculateEmployee(args);
    }

    var workingDays = num_(inputs.working_days);
    var paidDays = num_(inputs.paid_days);
    var ctcMonthly = num_(structure && structure.ctc_monthly);

    var rateByCode = {};
    var rateLines = [];
    var rateGross = 0;
    rateComponents.forEach(function (c) {
      if (kind_(c) !== HRMS.COMPONENT_KIND.EARNING) return;
      var code = trim_(c.component_code).toUpperCase();
      var contractual = num_(c.amount);
      rateByCode[code] = contractual;
      if (code === 'BP' || code === 'BASIC') {
        rateByCode.BP = contractual;
        rateByCode.BASIC = contractual;
      }
      rateGross = PayrollEngine.round2(rateGross + contractual);
      rateLines.push({
        component_code: c.component_code,
        component_name: c.component_name,
        component_kind: c.component_kind,
        phase: 'RATE',
        contractual: contractual,
        amount: contractual
      });
    });

    var earnedByCode = {};
    var earnedLines = [];
    var earnedGross = 0;
    rateComponents.forEach(function (c) {
      if (kind_(c) !== HRMS.COMPONENT_KIND.EARNING) return;
      var contractual = num_(c.amount);
      var earned = rules.earned_prorate === 'ROUND_LINE'
        ? roundMode_(HRMS.FORMULA_ROUND.ROUND, (contractual / workingDays) * paidDays)
        : PayrollEngine.round2(contractual * factorInfo.factor);
      var code = trim_(c.component_code).toUpperCase();
      earnedByCode[code] = earned;
      if (code === 'BP' || code === 'BASIC') {
        earnedByCode.BP = earned;
        earnedByCode.BASIC = earned;
      }
      earnedGross = PayrollEngine.round2(earnedGross + earned);
      earnedLines.push({
        component_code: c.component_code,
        component_name: c.component_name,
        component_kind: c.component_kind,
        phase: 'EARNED',
        contractual: contractual,
        amount: earned
      });
    });

    var ctx = {
      ctcMonthly: ctcMonthly || rateGross,
      rateGross: rateGross,
      earnedGross: earnedGross,
      rateByCode: rateByCode,
      earnedByCode: earnedByCode
    };

    var dedLines = [];
    var totalDed = 0;
    var employer = 0;
    (templateComponents || []).forEach(function (raw) {
      var sec = section_(raw);
      if (sec !== HRMS.STRUCTURE_SECTION.DEDUCTION &&
          sec !== HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION &&
          kind_(raw) !== HRMS.COMPONENT_KIND.DEDUCTION &&
          kind_(raw) !== HRMS.COMPONENT_KIND.EMPLOYER) {
        return;
      }
      var m = method_(raw);
      var amt = 0;
      if (m === HRMS.CALC_METHOD.MANUAL || sec === HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION) {
        amt = manualAmount_(raw.component_code, inputs);
      } else if (m === HRMS.CALC_METHOD.PERCENT_CAPPED) {
        var base = refAmount_(raw.percent_base, ctx);
        var cap = num_(raw.cap_amount);
        if (cap > 0) base = Math.min(base, cap);
        amt = roundMode_(raw.round_mode, base * num_(raw.percent) / 100);
      } else if (m === HRMS.CALC_METHOD.PERCENT_IF) {
        var test = refAmount_(raw.cond_ref, ctx);
        if (compare_(test, raw.cond_op, num_(raw.cond_value))) {
          var pctBase = refAmount_(raw.percent_base, ctx);
          amt = roundMode_(raw.round_mode, pctBase * num_(raw.percent) / 100);
        }
      } else if (m === HRMS.CALC_METHOD.THRESHOLD_FEE) {
        var g = refAmount_(raw.cond_ref, ctx);
        if (compare_(g, raw.cond_op || 'LTE', num_(raw.cond_value))) {
          amt = 0;
        } else {
          amt = roundMode_(raw.round_mode, num_(raw.amount));
        }
      } else if (m === HRMS.CALC_METHOD.FIXED) {
        amt = roundMode_(raw.round_mode, num_(raw.amount));
      } else if (m === HRMS.CALC_METHOD.PERCENT) {
        var b = refAmount_(raw.percent_base, ctx);
        amt = roundMode_(raw.round_mode, b * num_(raw.percent) / 100);
      }
      var line = {
        component_code: raw.component_code,
        component_name: raw.component_name,
        component_kind: raw.component_kind,
        phase: 'DEDUCTION',
        contractual: amt,
        amount: amt
      };
      if (kind_(raw) === HRMS.COMPONENT_KIND.EMPLOYER) {
        employer = PayrollEngine.round2(employer + amt);
      } else {
        dedLines.push(line);
        totalDed = PayrollEngine.round2(totalDed + amt);
      }
    });

    var arrears = 0;
    (rules.arrears_add_codes || []).forEach(function (code) {
      arrears = PayrollEngine.round2(arrears + manualAmount_(code, inputs));
    });

    var bonus = PayrollEngine.round2(num_(inputs.bonus));
    var incentive = PayrollEngine.round2(num_(inputs.incentive));
    var otherEarnings = PayrollEngine.round2(num_(inputs.other_earnings));

    var gross = PayrollEngine.round2(earnedGross + bonus + incentive + otherEarnings);
    var deductions = PayrollEngine.round2(totalDed);
    var netComputed = PayrollEngine.round2(gross - deductions + arrears);
    var net = PayrollEngine.roundNet(netComputed, settings.payroll_round);

    var lines = rateLines.concat(earnedLines).concat(dedLines);
    var breakdown = {
      meta: { employee_id: employee.employee_id || '', formula_engine: 'template_v1' },
      factor: factorInfo.factor,
      rate_gross: rateGross,
      earned_gross: earnedGross,
      lines: lines,
      bonus: bonus,
      incentive: incentive,
      other_earnings: otherEarnings,
      arrears: arrears,
      tds_amount: num_(inputs.tds_amount)
    };

    return {
      skipped: false,
      employee_id: employee.employee_id || '',
      salary_structure_id: structure ? (structure.salary_structure_id || '') : '',
      working_days: workingDays,
      paid_days: paidDays,
      lop_days: num_(inputs.lop_days),
      bonus: bonus,
      incentive: incentive,
      other_earnings: otherEarnings,
      other_deductions: num_(inputs.other_deductions),
      tds_amount: num_(inputs.tds_amount),
      gross_earnings: gross,
      total_deductions: deductions,
      net_pay: net,
      employer_contributions: employer,
      component_breakdown: JSON.stringify(breakdown),
      exception_flags: ''
    };
  }

  return {
    calculateEmployee: calculateEmployee_
  };
})();
