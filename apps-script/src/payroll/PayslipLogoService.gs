/**
 * Vertical-specific payslip logos (SAPL vs AyurvedaOne for AOMS/AOPL).
 */
var PayslipLogoService = (function () {
  function trim_(v) {
    return v == null ? '' : String(v).trim();
  }

  function normalizeVertical_(vertical) {
    return trim_(vertical).toUpperCase();
  }

  /**
   * Resolve vertical from employee master or employee_id prefix (SAPL-0001).
   */
  function resolveVertical_(emp, employeeId) {
    var v = normalizeVertical_(emp && emp.vertical_name);
    if (v) return v;
    var id = trim_(employeeId || (emp && emp.employee_id));
    if (!id) return '';
    var prefix = id.split('-')[0];
    return normalizeVertical_(prefix);
  }

  function logoKeyForVertical_(vertical) {
    if (vertical === 'SAPL') return 'SAPL';
    if (vertical === 'AOPL' || vertical === 'AOMS') return 'AYURVEDAONE';
    return '';
  }

  function dataUriForVertical_(vertical) {
    var key = logoKeyForVertical_(vertical);
    if (!key || typeof HRMS_PAYSLIP_LOGO_B64_ === 'undefined') return '';
    var b64 = HRMS_PAYSLIP_LOGO_B64_[key];
    if (!b64) return '';
    return 'data:image/png;base64,' + b64;
  }

  function dataUriForEmployee_(emp, employeeId) {
    var vertical = resolveVertical_(emp, employeeId);
    return dataUriForVertical_(vertical);
  }

  function logoCssClassForVertical_(vertical) {
    if (vertical === 'SAPL') return 'logo logo-sapl';
    if (vertical === 'AOPL' || vertical === 'AOMS') return 'logo logo-ayurvedaone';
    return 'logo';
  }

  return {
    resolveVertical: resolveVertical_,
    dataUriForEmployee: dataUriForEmployee_,
    logoCssClassForVertical: logoCssClassForVertical_
  };
})();
