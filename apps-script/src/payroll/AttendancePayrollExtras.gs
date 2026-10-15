/**
 * Month-specific payroll amounts captured on the attendance register (not salary structure).
 * TDS, Advance, LCD, LWF reduce net; Arrears add to net after deductions.
 */
var HRMS = HRMS || {};

var AttendancePayrollExtras = (function () {
  var SPECS_ = [
    { header: 'TDS', component_code: 'TDS', component_name: 'TDS', input_field: 'tds_amount', kind: 'DEDUCTION' },
    { header: 'Advance', component_code: 'ADVANCE', component_name: 'Advance', input_field: 'deduction_advance', kind: 'DEDUCTION' },
    { header: 'LCD', component_code: 'LCD', component_name: 'LCD', input_field: 'deduction_lcd', kind: 'DEDUCTION' },
    { header: 'LWF', component_code: 'LWF', component_name: 'LWF', input_field: 'deduction_lwf', kind: 'DEDUCTION' },
    { header: 'Arrears', component_code: 'ARREARS', component_name: 'Arrears', input_field: 'arrears_amount', kind: 'ARREAR' }
  ];

  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function num_(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function round2_(n) {
    return Math.round(num_(n) * 100) / 100;
  }

  function headerKey_(label) {
    return trim_(label).toLowerCase().replace(/\s+/g, '_');
  }

  function specs_() {
    return SPECS_.slice();
  }

  function deductionSpecs_() {
    return SPECS_.filter(function (s) { return s.kind === 'DEDUCTION'; });
  }

  function templateHeaders_() {
    return SPECS_.map(function (s) { return s.header; });
  }

  function emptyInputFields_() {
    var o = {
      tds_amount: 0,
      deduction_advance: 0,
      deduction_lcd: 0,
      deduction_lwf: 0,
      arrears_amount: 0,
      other_deductions: 0
    };
    return o;
  }

  function parseAmount_(raw, fieldLabel) {
    var s = trim_(raw);
    if (!s) return 0;
    var n = Number(s.replace(/,/g, ''));
    if (!isFinite(n) || n < 0) {
      throw validationError_((fieldLabel || 'Amount') + ' must be a non-negative number.');
    }
    return round2_(n);
  }

  /** Parse extras from attendance sheet row headers. */
  function parseFromSheetRow_(line, headers) {
    var out = {};
    SPECS_.forEach(function (spec) {
      out[spec.input_field] = 0;
    });
    var byKey = {};
    headers.forEach(function (h, i) {
      byKey[headerKey_(h)] = i;
    });
    SPECS_.forEach(function (spec) {
      var idx = byKey[headerKey_(spec.header)];
      if (idx == null || idx < 0) return;
      var val = line[idx];
      if (val === '' || val == null) return;
      out[spec.input_field] = parseAmount_(val, spec.header);
    });
    return normalizeInputUpdates_(out);
  }

  function readFromInput_(inp) {
    inp = inp || {};
    return {
      tds_amount: round2_(num_(inp.tds_amount)),
      deduction_advance: round2_(num_(inp.deduction_advance)),
      deduction_lcd: round2_(num_(inp.deduction_lcd)),
      deduction_lwf: round2_(num_(inp.deduction_lwf)),
      arrears_amount: round2_(num_(inp.arrears_amount)),
      other_deductions: round2_(num_(inp.other_deductions))
    };
  }

  /** Legacy: single other_deductions → advance when split columns empty. */
  function migrateLegacyBuckets_(fields) {
    fields = fields || {};
    var adv = num_(fields.deduction_advance);
    var lcd = num_(fields.deduction_lcd);
    var lwf = num_(fields.deduction_lwf);
    var legacy = num_(fields.other_deductions);
    if (adv + lcd + lwf <= 0 && legacy > 0) {
      fields.deduction_advance = round2_(legacy);
    }
    return fields;
  }

  function syncOtherDeductions_(fields) {
    fields = migrateLegacyBuckets_(fields);
    fields.other_deductions = round2_(
      num_(fields.deduction_advance) + num_(fields.deduction_lcd) + num_(fields.deduction_lwf));
    return fields;
  }

  function normalizeInputUpdates_(partial) {
    partial = partial || {};
    var out = emptyInputFields_();
    SPECS_.forEach(function (spec) {
      if (partial[spec.input_field] != null && partial[spec.input_field] !== '') {
        out[spec.input_field] = round2_(Math.max(0, num_(partial[spec.input_field])));
      }
    });
    return syncOtherDeductions_(out);
  }

  function templateValuesFromInput_(inp) {
    var f = readFromInput_(inp);
    return SPECS_.map(function (spec) {
      var v = f[spec.input_field];
      return v > 0 ? v : '';
    });
  }

  function buildManualDeductionLines_(inputs) {
    inputs = migrateLegacyBuckets_(readFromInput_(inputs));
    var lines = [];
    var total = 0;
    deductionSpecs_().forEach(function (spec) {
      var amt = round2_(num_(inputs[spec.input_field]));
      if (amt <= 0) return;
      lines.push({
        component_code: spec.component_code,
        component_name: spec.component_name,
        component_kind: HRMS.COMPONENT_KIND.DEDUCTION,
        structure_section: HRMS.STRUCTURE_SECTION.MANUAL_DEDUCTION,
        phase: 'DEDUCTION',
        contractual: amt,
        amount: amt,
        calc_method: HRMS.CALC_METHOD.MANUAL,
        source: 'attendance_register'
      });
      total = round2_(total + amt);
    });
    return { lines: lines, total: total };
  }

  function arrearsFromInput_(inputs) {
    return round2_(num_(readFromInput_(inputs).arrears_amount));
  }

  return {
    specs: specs_,
    deductionSpecs: deductionSpecs_,
    templateHeaders: templateHeaders_,
    emptyInputFields: emptyInputFields_,
    parseFromSheetRow: parseFromSheetRow_,
    readFromInput: readFromInput_,
    normalizeInputUpdates: normalizeInputUpdates_,
    templateValuesFromInput: templateValuesFromInput_,
    buildManualDeductionLines: buildManualDeductionLines_,
    arrearsFromInput: arrearsFromInput_,
    syncOtherDeductions: syncOtherDeductions_
  };
})();
