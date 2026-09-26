/**
 * ATS hire workflow (HIRED stage) static contracts.
 * Run: node tests/ats-hire-workflow.test.js
 */
const fs = require('fs');
const path = require('path');

const ats = path.join(__dirname, '..', 'apps-script', 'src', 'ats');
const failures = [];

function read(name) {
  return fs.readFileSync(path.join(ats, name), 'utf8');
}

function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else {
    failures.push(name);
    console.log('FAIL ' + name);
  }
}

const hire = read('AtsHireWorkflowService.gs');
const api = read('../ats/ApiAts.gs'.replace('../ats/', ''));
const client = read('AtsClient.html');
const schema = read('AtsSchemaService.gs');

check('hire-schema-columns', /hire_salary_structure_id/.test(schema) && /hire_joining_date/.test(schema) &&
  /appointment_letter_sent_at/.test(schema));
check('hire-offer-breakup', /salaryBreakupTableHtml_/.test(read('AtsLetterPdfService.gs')));
check('hire-appointment-joining', /hire_joining_date/.test(hire) && /joiningDate/.test(read('AtsAppointmentLetterService.gs')));
check('hire-service', /saveHireCompensation_/.test(hire) && /createEmployeeFromHire_/.test(hire));
check('hire-schema-ensure', /ensureHireApplicationColumns_/.test(hire) && /assertHireCompensationReady_/.test(hire));
check('hire-apis', /apiAtsSendHireOfferLetter/.test(read('ApiAts.gs')) && /apiAtsCreateEmployeeFromHire/.test(read('ApiAts.gs')));
check('hire-ui', /buildHireWorkflowCardHtml_/.test(client) && /apiAtsListHireSalaryStructures/.test(client));
check('hire-letter-branding', /resolveLetterBranding_/.test(read('AtsLetterPdfService.gs')) &&
  /PayslipLogoService\.dataUriForVertical/.test(read('AtsLetterPdfService.gs')));
check('appointment-template', /ats_appointment/.test(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'src', 'foundation', 'HrmsContentTemplateService.gs'), 'utf8')));

if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nAll ATS hire workflow checks passed');
