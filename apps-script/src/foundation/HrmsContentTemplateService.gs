/**
 * Editable organisation content templates (Settings sheet). Used by welcome email,
 * bulk upload instruction sheets, and ATS offer letters. Placeholders: {{name}}, etc.
 */
var HRMS = HRMS || {};

var HrmsContentTemplateService = (function () {
  var DEFINITIONS_ = [
    {
      id: 'employee_welcome',
      label: 'New employee welcome email',
      description: 'Sent when a Google login is created (email body; subject line separate).',
      keys: {
        subject: 'template_employee_welcome_subject',
        body: 'template_employee_welcome_body'
      },
      defaults: {
        subject: '{{company}} - Welcome - HRMS access for {{employee_id}}',
        body: [
          'Dear {{display_name}},',
          '',
          'Welcome to {{company}}. We are pleased to welcome you to our organisation.',
          '',
          'An account has been created for you on the organisation HRMS portal.',
          '',
          'Portal: {{portal_url}}',
          'Login email: {{login_email}}',
          'Employee ID: {{employee_id}}',
          'Department: {{department}}',
          '',
          'Please use this portal for self-service HR requests. Do not share your login details.',
          '',
          'Regards,',
          'Human Resources',
          '{{company}}'
        ].join('\n')
      },
      placeholders: [
        '{{display_name}}', '{{company}}', '{{portal_url}}', '{{login_email}}', '{{employee_id}}', '{{department}}'
      ]
    },
    {
      id: 'bulk_new_hire',
      label: 'Bulk upload - new hires (Excel instructions)',
      description: 'Shown on the Instructions sheet of the new-hire bulk template.',
      keys: { body: 'template_bulk_new_hire_instructions' },
      defaults: {
        body: [
          'Use this template for new joiners who need HRMS login (create_login YES when applicable).',
          'Employee codes: SAPL-0001, AOPL-0001, AOMS-0001 (provided by HR).',
          'Dates: YYYY-MM-DD. System role on create is always EMPLOYEE.',
          'Review validation results before confirming import.'
        ].join('\n')
      },
      placeholders: []
    },
    {
      id: 'bulk_legacy',
      label: 'Bulk upload - existing / legacy employees',
      description: 'Shown on the Instructions sheet of the legacy employee bulk template.',
      keys: { body: 'template_bulk_legacy_instructions' },
      defaults: {
        body: [
          'Use this template for employees already on payroll before HRMS (historical records).',
          'Set create_login to NO unless you are issuing portal access now.',
          'Joining date should reflect actual date of joining (for leave balance history).',
          'Employee codes must match your master list (SAPL / AOPL / AOMS).',
          'Review validation results before confirming import.'
        ].join('\n')
      },
      placeholders: []
    },
    {
      id: 'ats_offer',
      label: 'Recruitment - offer letter email',
      description: 'Sent to the candidate when the application reaches the OFFER stage (email + PDF attachment).',
      keys: {
        subject: 'template_ats_offer_subject',
        body: 'template_ats_offer_body'
      },
      defaults: {
        subject: 'Offer of employment - {{job_title}} - {{company}}',
        body: [
          'Dear {{candidate_name}},',
          '',
          'Congratulations. We are pleased to offer you the position of {{job_title}} at {{company}}.',
          '',
          'This email includes a PDF copy of your offer letter for your records.',
          'Our HR team will contact you with next steps regarding documentation and joining.',
          '',
          'We look forward to welcoming you to the team.',
          '',
          'Regards,',
          'Human Resources',
          '{{company}}'
        ].join('\n')
      },
      placeholders: ['{{candidate_name}}', '{{job_title}}', '{{company}}', '{{application_id}}']
    }
  ];

  function trim_(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function findDef_(id) {
    id = String(id || '');
    for (var i = 0; i < DEFINITIONS_.length; i++) {
      if (DEFINITIONS_[i].id === id) return DEFINITIONS_[i];
    }
    return null;
  }

  function allSettingKeys_() {
    var keys = [];
    DEFINITIONS_.forEach(function (def) {
      Object.keys(def.keys).forEach(function (part) {
        keys.push(def.keys[part]);
      });
    });
    return keys;
  }

  function seedMissingTemplateSettings_() {
    if (typeof SchemaService === 'undefined' || !SchemaService.seedMissingDefaultSettings) return;
    SchemaService.seedMissingDefaultSettings();
  }

  function readRaw_(settingKey, fallback) {
    try {
      var v = ConfigService.getSetting(settingKey, fallback);
      if (v === null || v === undefined) return String(fallback || '');
      return String(v);
    } catch (ignore) {
      return String(fallback || '');
    }
  }

  function applyPlaceholders_(text, map) {
    text = String(text || '');
    map = map || {};
    Object.keys(map).forEach(function (key) {
      var token = key.indexOf('{{') === 0 ? key : '{{' + key + '}}';
      var val = map[key] != null ? String(map[key]) : '';
      text = text.split(token).join(val);
    });
    return text;
  }

  function getPart_(def, part) {
    var key = def.keys[part];
    if (!key) return '';
    return readRaw_(key, def.defaults[part] || '');
  }

  function render_(templateId, placeholderMap) {
    var def = findDef_(templateId);
    if (!def) throw configurationError_('Unknown template: ' + templateId);
    var out = { templateId: templateId };
    Object.keys(def.keys).forEach(function (part) {
      out[part] = applyPlaceholders_(getPart_(def, part), placeholderMap || {});
    });
    return out;
  }

  function listForClient_() {
    return DEFINITIONS_.map(function (def) {
      var fields = {};
      Object.keys(def.keys).forEach(function (part) {
        fields[part] = getPart_(def, part);
      });
      return {
        id: def.id,
        label: def.label,
        description: def.description,
        placeholders: def.placeholders || [],
        fields: fields
      };
    });
  }

  function upsertSetting_(settingKey, value, session) {
    ConfigService.clearSettingsCache();
    seedMissingTemplateSettings_();
    var row = DbService.findOne(HRMS.SHEETS.SETTINGS, { setting_key: settingKey });
    if (!row) {
      throw configurationError_('Unknown setting key: ' + settingKey + '. Re-run database setup to seed Settings.');
    }
    var actor = (session && session.email) ? String(session.email).trim().toLowerCase() : 'system';
    DbService.updateRecord(HRMS.SHEETS.SETTINGS, 'setting_key', settingKey, {
      setting_value: String(value),
      updated_at: new Date(),
      updated_by_email: actor
    });
    ConfigService.clearSettingsCache();
  }

  function saveTemplates_(session, templatesPatch) {
    templatesPatch = templatesPatch || {};
    DEFINITIONS_.forEach(function (def) {
      var patch = templatesPatch[def.id];
      if (!patch || typeof patch !== 'object') return;
      Object.keys(def.keys).forEach(function (part) {
        if (!patch.hasOwnProperty(part)) return;
        upsertSetting_(def.keys[part], String(patch[part] == null ? '' : patch[part]), session);
      });
    });
  }

  function defaultSettingsRows_() {
    var rows = [];
    DEFINITIONS_.forEach(function (def) {
      Object.keys(def.keys).forEach(function (part) {
        rows.push([
          def.keys[part],
          def.defaults[part] || '',
          'STRING',
          'Content template: ' + def.label + ' (' + part + ')',
          false
        ]);
      });
    });
    return rows;
  }

  return {
    definitions: DEFINITIONS_,
    defaultSettingsRows: defaultSettingsRows_,
    allSettingKeys: allSettingKeys_,
    seedMissingTemplateSettings: seedMissingTemplateSettings_,
    applyPlaceholders: applyPlaceholders_,
    render: render_,
    listForClient: listForClient_,
    saveTemplates: saveTemplates_
  };
})();
