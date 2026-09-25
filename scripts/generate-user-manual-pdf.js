#!/usr/bin/env node
/**
 * Generate PDF from docs/user-manual/AyurCentral_HRMS_User_Manual.html
 * Usage: node scripts/generate-user-manual-pdf.js [outputPath]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'docs', 'user-manual', 'AyurCentral_HRMS_User_Manual.html');
const defaultOut = path.join(root, 'docs', 'user-manual', 'AyurCentral_HRMS_User_Manual.pdf');
const outPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultOut;

async function main() {
  if (!fs.existsSync(htmlPath)) {
    console.error('Missing HTML:', htmlPath);
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', bottom: '14mm', left: '12mm', right: '12mm' }
  });
  await browser.close();
  console.log('Wrote', outPath);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
