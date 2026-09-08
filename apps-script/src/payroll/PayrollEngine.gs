/**
 * Pure payroll calculation — no spreadsheet I/O.
 * Frontend net_pay is never read.
 */
var PayrollEngine = (function () {
  function round2(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    var sign = x < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(x) * 100 + 1e-8) / 100;
  }

  function roundNet(net, payrollRound) {
    var n = round2(net);
    if (String(payrollRound || '').toUpperCase() === 'NEAREST_RUPEE') {
      var sign = n < 0 ? -1 : 1;
      return sign * Math.round(Math.abs(n) + 1e-8);
    }
    return n;
  }

  function prorationFactor(paidDays, workingDays) {
    var w = Number(workingDays);
    var p = Number(paidDays);
    if (!isFinite(w) || w <= 0) {
      return { ok: false, factor: 0, reason: HRMS.PAYROLL_EXCEPTION.WORKING_DAYS_ZERO };
    }
    if (!isFinite(p) || p < 0) p = 0;
    return { ok: true, factor: p / w, reason: '' };
  }

  function findBasic_(components) {
    components = components || [];
    for (var i = 0; i < components.length; i++) {
      if (String(components[i].component_code || '').toUpperCase() === 'BASIC') {
        return components[i];
      }
    }
    return null;
  }

  function contractualAmount(component, basicContractual) {
    var method = String(component.calc_method || '').toUpperCase();
    if (method === HRMS.CALC_METHOD.PERCENT_OF_BASIC) {
      var pct = Number(component.percent);
      if (!isFinite(pct)) pct = 0;
      return round2(basicContractual * (pct / 100));
    }
    return round2(component.amount);
  }

  function sortComponents_(components) {
    return (components || []).slice().sort(function (a, b) {
      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });
  }

  function num_(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /**
   * @param {Object} args
   * @param {Object|null} args.structure
   * @param {Array} args.components
   * @param {Object} args.inputs working_days, paid_days, bonus, incentive, other_*, tds_amount
   * @param {Object} args.settings payroll_round
   * @param {Object} args.employee pan, bank_ifsc, bank_account_number, display_name, department, designation, employee_id
   * @return {Object} snapshot fields + flags (ignores any client net_pay)
   */
  function calculateEmployee(args) {
    args = args || {};
    var inputs = args.inputs || {};
    var employee = args.employee || {};
    var settings = args.settings || {};
    var structure = args.structure || null;
    var components = sortComponents_(args.components || []);

    var flags = [];
    var factorInfo = prorationFactor(inputs.paid_days, inputs.working_days);
    if (!factorInfo.ok) {
      flags.push(factorInfo.reason);
      return {
        skipped: true,
        employee_id: employee.employee_id || '',
        salary_structure_id: structure ? structure.salary_structure_id : '',
        exception_flags: flags.join(';'),
        gross_earnings: 0,
        total_deductions: 0,
        net_pay: 0,
        employer_contributions: 0,
        component_breakdown: JSON.stringify({ lines: [], meta: snapshotMeta_(employee), skipped: true })
      };
    }

    var F = factorInfo.factor;
    var basicComp = findBasic_(components);
    var basicContractual = 0;
    if (basicComp) {
      if (String(basicComp.calc_method || '').toUpperCase() === HRMS.CALC_METHOD.PERCENT_OF_BASIC) {
        basicContractual = 0;
      } else {
        basicContractual = round2(basicComp.amount);
      }
    }

    if (!structure || !components.length) {
      flags.push(HRMS.PAYROLL_EXCEPTION.MISSING_STRUCTURE);
    }

    var lines = [];
    var grossFromStructure = 0;
    var dedFromStructure = 0;
    var employer = 0;

    if (structure && components.length) {
      for (var i = 0; i < components.length; i++) {
        var c = components[i];
        var kind = String(c.component_kind || '').toUpperCase();
        var contractual = contractualAmount(c, basicContractual);
        var prorated = round2(contractual * F);
        lines.push({
          component_code: c.component_code,
          component_name: c.component_name,
          component_kind: kind,
          calc_method: c.calc_method,
          contractual: contractual,
          amount: prorated
        });
        if (kind === HRMS.COMPONENT_KIND.EARNING) {
          grossFromStructure = round2(grossFromStructure + prorated);
        } else if (kind === HRMS.COMPONENT_KIND.DEDUCTION) {
          dedFromStructure = round2(dedFromStructure + prorated);
        } else if (kind === HRMS.COMPONENT_KIND.EMPLOYER) {
          employer = round2(employer + prorated);
        }
      }
    }

    var bonus = round2(num_(inputs.bonus));
    var incentive = round2(num_(inputs.incentive));
    var otherEarnings = round2(num_(inputs.other_earnings));
    var otherDeductions = round2(num_(inputs.other_deductions));
    var tds = round2(num_(inputs.tds_amount));

    var gross = round2(grossFromStructure + bonus + incentive + otherEarnings);
    var deductions = round2(dedFromStructure + tds + otherDeductions);
    var netComputed = round2(gross - deductions);
    var net = roundNet(netComputed, settings.payroll_round);

    if (net < 0) {
      flags.push(HRMS.PAYROLL_EXCEPTION.NEGATIVE_NET);
    }
    if (!hasBank_(employee)) {
      flags.push(HRMS.PAYROLL_EXCEPTION.MISSING_BANK);
    }
    if (!String(employee.pan || '').trim()) {
      flags.push(HRMS.PAYROLL_EXCEPTION.MISSING_PAN);
    }

    var breakdown = {
      meta: snapshotMeta_(employee),
      factor: F,
      payroll_round: settings.payroll_round || '',
      lines: lines,
      bonus: bonus,
      incentive: incentive,
      other_earnings: otherEarnings,
      other_deductions: otherDeductions,
      tds_amount: tds
    };

    return {
      skipped: false,
      employee_id: employee.employee_id || '',
      salary_structure_id: structure ? (structure.salary_structure_id || '') : '',
      working_days: num_(inputs.working_days),
      paid_days: num_(inputs.paid_days),
      lop_days: num_(inputs.lop_days),
      bonus: bonus,
      incentive: incentive,
      other_earnings: otherEarnings,
      other_deductions: otherDeductions,
      tds_amount: tds,
      gross_earnings: gross,
      total_deductions: deductions,
      net_pay: net,
      employer_contributions: employer,
      component_breakdown: JSON.stringify(breakdown),
      exception_flags: flags.join(';')
    };
  }

  function snapshotMeta_(employee) {
    return {
      employee_id: employee.employee_id || '',
      display_name: employee.display_name || '',
      department: employee.department || '',
      designation: employee.designation || '',
      bank_masked: maskBank_(employee.bank_account_number)
    };
  }

  function hasBank_(employee) {
    var acc = String(employee.bank_account_number || '').trim();
    var ifsc = String(employee.bank_ifsc || '').trim();
    return !!(acc && ifsc);
  }

  function maskBank_(accountNumber) {
    var s = String(accountNumber || '').replace(/\s/g, '');
    if (!s) return '';
    if (s.length <= 4) return '****';
    return 'XXXX' + s.substring(s.length - 4);
  }

  function flagsInclude(flagsStr, code) {
    var parts = String(flagsStr || '').split(';');
    return parts.indexOf(code) >= 0;
  }

  return {
    round2: round2,
    roundNet: roundNet,
    prorationFactor: prorationFactor,
    contractualAmount: contractualAmount,
    calculateEmployee: calculateEmployee,
    maskBank: maskBank_,
    hasBank: hasBank_,
    flagsInclude: flagsInclude
  };
})();
