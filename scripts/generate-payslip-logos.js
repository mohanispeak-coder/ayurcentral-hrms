/**
 * Embed payslip logo PNGs into Apps Script.
 * Run: node scripts/generate-payslip-logos.js
 */
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'apps-script', 'assets', 'payslip-logos');
const outFile = path.join(__dirname, '..', 'apps-script', 'src', 'payroll', 'PayslipLogos.gs');

function b64(file) {
  return fs.readFileSync(path.join(assetsDir, file)).toString('base64');
}

const sapl = b64('sapl.png');
const ayur = b64('ayurvedaone.png');

const content = `/**
 * Payslip logo payloads (base64 PNG). Regenerate: node scripts/generate-payslip-logos.js
 * Do not edit by hand.
 */
var HRMS_PAYSLIP_LOGO_B64_ = {
  SAPL: '${sapl}',
  AYURVEDAONE: '${ayur}'
};
`;

fs.writeFileSync(outFile, content, 'utf8');
console.log('Wrote', outFile, '(' + Math.round(content.length / 1024) + ' KB)');
