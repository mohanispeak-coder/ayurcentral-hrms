/**
 * Builds a standalone HTML page that loads the real shell + bell with mocked RPCs.
 * Run: node tests/generate-shell-smoke.js
 */
var fs = require('fs');
var path = require('path');

var src = path.join(__dirname, '..', 'apps-script', 'src');
var bell = fs.readFileSync(path.join(src, 'notifications', 'NotificationBell.html'), 'utf8');
var scripts = fs.readFileSync(path.join(src, 'ui', 'Scripts.html'), 'utf8');
var styles = '';
try {
  styles = fs.readFileSync(path.join(src, 'ui', 'Styles.html'), 'utf8')
    .replace(/^[\s\S]*?<style>/i, '<style>').replace(/<\/style>[\s\S]*$/i, '</style>');
} catch (ignore) {}

var mock = fs.readFileSync(path.join(__dirname, 'fixtures', 'hrms-shell-smoke-mock.js'), 'utf8');

var html = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>HRMS shell smoke</title>' + styles + '</head><body>\n' +
  fs.readFileSync(path.join(__dirname, 'fixtures', 'hrms-shell-smoke-body.html'), 'utf8') +
  '<script>' + mock + '</script>\n' +
  bell + '\n' + scripts + '\n' +
  '<script>window.__HRMS_SMOKE_READY = true;</script>\n</body></html>\n';

var out = path.join(__dirname, 'fixtures', 'hrms-shell-smoke.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + out + ' (' + html.length + ' chars)');
