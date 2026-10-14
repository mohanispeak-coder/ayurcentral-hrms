/**
 * Payroll calculate using salary structure four execution sections:
 * 1 RATE_OF_PAY → 2 EARNED_PAY → 3 DEDUCTION (formulas) → 4 MANUAL_DEDUCTION.
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
    if (ref === HRMS.PERCENT_BASE_CTC || ref === 'CTC') return ctx.ctcMonthly;
    if (ref.indexOf('RATE_LINE:') === 0) {
      var rateCode = ref.substring(10);
      return ctx.rateByCode[rateCode] != null ? ctx.rateByCode[rateCode] : 0;
    }
    if (ref.indexOf('EARNED_LINE:') === 0) {
      var earnedCode = ref.substring(12);
      return ctx.earnedByCode[earnedCode] != null ? ctx.earnedByCode[earnedCode] : 0;
    }
    if (ctx.rateByCode[ref] != null) return ctx.rateByCode[ref];
    if (ctx.earnedByCode[ref] != null) return ctx.earnedByCode[ref];
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
    var out = {
      earned_prorate: 'ROUND_LINE',
      arrears_add_codes: ['ARREARS'],
      execution_sections: (HRMS.SALARY_EXECUTION_SECTIONS || []).slice()
    };
    if (!rules) return out;
    if (typeof rules === 'string') {
      try { rules = JSON.parse(rules); } catch (e) { rules = {}; }
    }
    if (rules.earned_prorate) {
      out.earned_prorate = trim_(rules.earned_prorate) || out.earned_prorate;
    }
    if (rules.arrears_add_codes) {
      out.arrears_add_codes = rules.arrears_add_codes;
    }
    if (rules.execution_sections && rules.execution_sections.length) {
      out.execution_sections = rules.execution_sections;
    }
    return out;
  }

  function templateBySection_(templateComponents, sec) {
    sec = trim_(sec).toUpperCase();
    return (templateComponents || []).filter(function (raw) {
      return section_(raw) === sec;
    });
  }

  function aliasCode_(map, code, amt) {
    code = trim_(code).toUpperCase();
    map[code] = amt;
    if (code === 'BP' || code === 'BASIC') {
      map.BP = amt;
      map.BASIC = amt;
    }
  }

  /** Section 1 — contractual monthly amounts (already expanded from CTC). */
  function executeRateOfPay_(rateComponents) {
    var rateByCode = {};
    var rateLines = [];
    var rateGross = 0;
    (rateComponents || []).forEach(function (c) {
      if (kind_(c) !== HRMS.COMPONENT_KIND.EARNING) return;
      var code = trim_(c.component_code).toUpperCase();
      var contractual = num_(c.amount);
      aliasCode_(rateByCode, code, contractual);
      rateGross = PayrollEngine.round2(rateGross + contractual);
      rateLines.push({
        component_code: c.component_code,
        component_name: c.component_name,
        component_kind: c.component_kind,
        structure_section: HRMS.STRUCTURE_SECTION.RATE_OF_PAY,
        phase: 'RATE',
        contractual: contractual,
        amount: contractual
      });
    });
    return { rateByCode: rateByCode, rateGross: rateGross, rateLines: rateLines };
  }

  function defaultEarnedRule_(rules) {
    return { calc_method: HRMS.CALC_METHOD.PRORATE_ROUND_LINE, round_mode: HRMS.FORMULA_ROUND.ROUND };
  }

  function normalizeEarnedMethod_(method) {
    method = trim_(method).toUpperCase();
    if (method === HRMS.CALC_METHOD.PRORATE_FACTOR) {
      return HRMS.CALC_METHOD.PRORATE_ROUND_LINE;
    }
    return method;
  }

  function earnedRuleForCode_(code, earnedTemplateRows, rules) {
    code = trim_(code).toUpperCase();
    var wildcard = null;
    var specific = null;
    (earnedTemplateRows || []).forEach(function (row) {
      var rc = trim_(row.component_code).toUpperCase();
      if (rc === '*' || rc === 'ALL') wildcard = row;
      else if (rc === code) specific = row;
    });
    var row = specific || wildcard;
    if (!row) return defaultEarnedRule_(rules);
    return {
      calc_method: normalizeEarnedMethod_(method_(row)),
      round_mode: trim_(row.round_mode).toUpperCase() || HRMS.FORMULA_ROUND.ROUND
    };
  }

  /** Section 2 — prorate each rate earning line by attendance. */
  function executeEarnedPay_(rateComponents, earnedTemplateRows, rules, workingDays, paidDays, factor) {
    var earnedByCode = {};
    var earnedLines = [];
    var earnedGross = 0;
    (rateComponents || []).forEach(function (c) {
      if (kind_(c) !== HRMS.COMPONENT_KIND.EARNING) return;
      var contractual = num_(c.amount);
      var code = trim_(c.component_code).toUpperCase();
      var rule = earnedRuleForCode_(code, earnedTemplateRows, rules);
      var earned;
      if (rule.calc_method === HRMS.CALC_METHOD.PRORATE_FACTOR) {
        earned = roundMode_(rule.round_mode, contractual * factor);
      } else {
        earned = roundMode_(rule.round_mode, (contractual / workingDays) * paidDays);
      }
      aliasCode_(earnedByCode, code, earned);
      earnedGross = PayrollEngine.round2(earnedGross + earned);
      earnedLines.push({
        component_code: c.component_code,
        component_name: c.component_name,
        component_kind: c.component_kind,
        structure_section: HRMS.STRUCTURE_SECTION.EARNED_PAY,
        phase: 'EARNED',
        contractual: contractual,
        amount: earned,
        calc_method: rule.calc_method,
        round_mode: rule.round_mode
      });
    });
    return {
      earnedByCode: earnedByCode,
      earnedGross: earnedGross,
      earnedLines: earnedLines,
      working_days: workingDays,
      paid_days: paidDays
    };
  }

  function computeFormulaDeduction_(raw, ctx) {
    var m = method_(raw);
    var amt = 0;
    if (m === HRMS.CALC_METHOD.PERCENT_CAPPED) {
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
    return amt;
  }

  /** Section 3 — statutory / automatic deduction formulas. */
  function executeDeductionFormulas_(deductionRows, ctx) {
    var lines = [];
    var total = 0;
    var employer = 0;
    (deductionRows || []).forEach(function (raw) {
      if (kind_(raw) === HRMS.COMPONENT_KIND.EMPLOYER) {
        employer = PayrollEngine.round2(employer + computeFormulaDeduction_(raw, ctx));
        return;
      }
      var amt = computeFormulaDeduction_(raw, ctx);
      lines.push({
        component_code: raw.component_code,
        component_name: raw.component_name,
        component_kind: raw.component_kind,
        structure_section: HRMS.STRUCTURE_SECTION.DEDUCTION,
        phase: 'DEDUCTION',
        contractual: amt,
        amount: amt
      });
      total = PayrollEngine.round2(total + amt);
    });
    return { lines: lines, total: total, employer: employer };
  }

  /** Section 4 — payroll-input deductions. */
  function executeManualDeductions_(manualRows, inputs) {
    var lines = [];
    var total = 0;
    (manualRows || []).forEach(function (raw) {
      var amt = manualAmount_(raw.component_code, inputs);
      lines.push({
        component_code: raw.component_code,
        component_name: raw.component_name,
        component_kind: raw.component_kind,
        structure_section: HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION,
        phase: 'DEDUCTION',
        contractual: amt,
        amount: amt,
        calc_method: HRMS.CALC_METHOD.MANUAL
      });
      total = PayrollEngine.round2(total + amt);
    });
    return { lines: lines, total: total };
  }

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

    var rateResult = executeRateOfPay_(rateComponents);
    var earnedTemplateRows = templateBySection_(templateComponents, HRMS.STRUCTURE_SECTION.EARNED_PAY);
    var earnedResult = executeEarnedPay_(
      rateComponents,
      earnedTemplateRows,
      rules,
      workingDays,
      paidDays,
      factorInfo.factor
    );

    var ctx = {
      ctcMonthly: ctcMonthly || rateResult.rateGross,
      rateGross: rateResult.rateGross,
      earnedGross: earnedResult.earnedGross,
      rateByCode: rateResult.rateByCode,
      earnedByCode: earnedResult.earnedByCode
    };

    var dedRows = templateBySection_(templateComponents, HRMS.STRUCTURE_SECTION.DEDUCTION);
    if (!dedRows.length) {
      dedRows = (templateComponents || []).filter(function (raw) {
        var sec = section_(raw);
        if (sec === HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION) return false;
        return sec === HRMS.STRUCTURE_SECTION.DEDUCTION ||
          (kind_(raw) === HRMS.COMPONENT_KIND.DEDUCTION && method_(raw) !== HRMS.CALC_METHOD.MANUAL);
      });
    }
    var formulaDed = executeDeductionFormulas_(dedRows, ctx);

    var manualRows = templateBySection_(templateComponents, HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION);
    if (!manualRows.length) {
      manualRows = (templateComponents || []).filter(function (raw) {
        return section_(raw) === HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION ||
          method_(raw) === HRMS.CALC_METHOD.MANUAL;
      });
    }
    var manualDed = executeManualDeductions_(manualRows, inputs);

    var arrears = 0;
    (rules.arrears_add_codes || []).forEach(function (code) {
      arrears = PayrollEngine.round2(arrears + manualAmount_(code, inputs));
    });

    var bonus = PayrollEngine.round2(num_(inputs.bonus));
    var incentive = PayrollEngine.round2(num_(inputs.incentive));
    var otherEarnings = PayrollEngine.round2(num_(inputs.other_earnings));

    var gross = PayrollEngine.round2(earnedResult.earnedGross + bonus + incentive + otherEarnings);
    var deductions = PayrollEngine.round2(formulaDed.total + manualDed.total);
    var netComputed = PayrollEngine.round2(gross - deductions + arrears);
    var net = PayrollEngine.roundNet(netComputed, settings.payroll_round);

    var lines = rateResult.rateLines
      .concat(earnedResult.earnedLines)
      .concat(formulaDed.lines)
      .concat(manualDed.lines);

    var breakdown = {
      meta: {
        employee_id: employee.employee_id || '',
        formula_engine: 'template_v2_four_sections',
        execution_sections: rules.execution_sections
      },
      factor: factorInfo.factor,
      sections: {
        rate_of_pay: {
          structure_section: HRMS.STRUCTURE_SECTION.RATE_OF_PAY,
          gross: rateResult.rateGross,
          lines: rateResult.rateLines
        },
        earned_pay: {
          structure_section: HRMS.STRUCTURE_SECTION.EARNED_PAY,
          gross: earnedResult.earnedGross,
          working_days: workingDays,
          paid_days: paidDays,
          lines: earnedResult.earnedLines
        },
        deduction_formulas: {
          structure_section: HRMS.STRUCTURE_SECTION.DEDUCTION,
          total: formulaDed.total,
          lines: formulaDed.lines
        },
        manual_deductions: {
          structure_section: HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION,
          total: manualDed.total,
          lines: manualDed.lines
        }
      },
      rate_gross: rateResult.rateGross,
      earned_gross: earnedResult.earnedGross,
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
      employer_contributions: formulaDed.employer,
      component_breakdown: JSON.stringify(breakdown),
      exception_flags: ''
    };
  }

  return {
    calculateEmployee: calculateEmployee_,
    executeRateOfPay: executeRateOfPay_,
    executeEarnedPay: executeEarnedPay_,
    executeDeductionFormulas: executeDeductionFormulas_,
    executeManualDeductions: executeManualDeductions_
  };
})();
