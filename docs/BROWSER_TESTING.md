# HRMS browser testing (Playwright)

End-to-end checks run against your **deployed** Google Apps Script web app in **Chromium**. They do not modify Apps Script code or bypass HRMS authentication.

## Prerequisites

- Node.js 18+
- A deployed HRMS web app URL (`/exec` deployment URL)
- For authenticated flows: a local Playwright **storage state** file (not committed to Git)

## Install

From the repository root:

```bash
npm install
npm run test:e2e:install
```

(`test:e2e:install` downloads Chromium only.)

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HRMS_BASE_URL` | **Yes** | Full web app URL, e.g. `https://script.google.com/macros/s/…/exec` |
| `HRMS_STORAGE_STATE` | For authenticated tests | Path to a JSON file created by Playwright after you sign in manually |

**Do not commit** deployment URLs with secrets, OTPs, passwords, or `storageState` JSON files.

### PowerShell

```powershell
$env:HRMS_BASE_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT/exec"
$env:HRMS_STORAGE_STATE = "tests/browser/.auth/user.json"
npm run test:e2e:mobile
```

### bash

```bash
export HRMS_BASE_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT/exec"
export HRMS_STORAGE_STATE="tests/browser/.auth/user.json"
npm run test:e2e:mobile
```

## Authentication (no bypass)

HRMS uses **email + one-time verification code** via `google.script.run`. Playwright tests **do not** automate Google login or OTP.

### Capture a session (one-time / when expired)

1. Set `HRMS_BASE_URL`.
2. Run codegen and sign in manually in the browser:

```bash
npx playwright codegen --save-storage=tests/browser/.auth/user.json "%HRMS_BASE_URL%"
```

On macOS/Linux, use `$HRMS_BASE_URL` instead of `%HRMS_BASE_URL%`.

3. Complete email + OTP in the opened browser.
4. Close codegen when the HRMS dashboard is visible.
5. Point `HRMS_STORAGE_STATE` at `tests/browser/.auth/user.json` for test runs.

The storage file may contain session cookies/local storage entries for the deployment origin. Treat it like a credential: keep it local, `.gitignore`d.

If storage is missing or expired, authenticated tests are **skipped** with a clear message (load/overflow tests on the sign-in screen still run).

## Commands

| Command | Purpose |
|---------|---------|
| `npm run test:e2e` | All Playwright tests, all configured viewports |
| `npm run test:e2e:mobile` | `tests/browser/mobile.spec.js` only |
| `npm run test:e2e:headed` | Run with visible browser |
| `npm run test:e2e:report` | Open the HTML report from the last run |

## Viewports

Each test runs under Playwright projects:

- 320×800, 360×800, 375×812, 390×844, 414×896  
- 768×1024, 1024×768, 1366×768  

## Reports and artifacts

- HTML report: `playwright-report/` → `npm run test:e2e:report`
- Traces (on failure): `test-results/`
- Extra failure screenshots: `test-results/screenshots/<viewport>/<module>/`

These folders are gitignored.

## Current tests (`tests/browser/mobile.spec.js`)

- HRMS shell loads (auth or signed-in)
- No horizontal overflow on load
- **With storage state:** sidebar open/close, dashboard, my leave, employees (if RBAC allows), Ask HR in viewport, main content width

## Limitations

- No OTP automation; manual storage capture required for signed-in tests.
- Google Apps Script iframes/redirects may require using the exact deployment URL Google provides.
- Role-dependent routes (e.g. Employees) skip when the session lacks access.
- Does not replace Node contract tests under `tests/*.test.js`.
