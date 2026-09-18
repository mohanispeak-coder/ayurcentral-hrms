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

**Recommended:** create **`Ayurcentral_HRMS-experiment/.env`** (gitignored):

```env
HRMS_BASE_URL=https://script.google.com/macros/s/YOUR_ID/exec
HRMS_STORAGE_STATE=tests/browser/.auth/user.json
```

No quotes, no spaces around `=`. The URL **must** end with **`/exec`** (Web app deployment), not `/dev`, not the script editor, not `script.google.com/home`.

Then run tests from the repo root — `npm run test:e2e:mobile` loads `.env` automatically.

**Verify in normal Chrome first:** paste `HRMS_BASE_URL` in the address bar — you should see HRMS sign-in or dashboard, not the generic Google Apps Script home page.

**Do not commit** `.env`, OTPs, passwords, or `storageState` JSON files.

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

1. Put `HRMS_BASE_URL` (and optionally `HRMS_STORAGE_STATE`) in **repo-root `.env`** (see below).
2. **Recommended** — save storage after login (works better with Google Apps Script redirects):

```bash
npm run test:e2e:auth:save
```

- Browser opens → complete **email + OTP** → wait for **dashboard**.
- Return to the terminal and **press Enter**.
- Script scans **every browser frame** for `hrms_session_token` (GAS often hosts `#app` in an iframe, not the top page).

3. If auth save lists a **`googleusercontent.com`** iframe origin, keep `HRMS_BASE_URL` as your normal **`/exec`** deploy URL; Playwright restores session storage per origin when that iframe loads again.

Alternative (less reliable for GAS):

```bash
npm run test:e2e:auth
```

4. Verify storage:

```bash
npm run test:e2e:check-storage
```

You should see `hrms_session_token: present` for at least one origin.

7. Point `HRMS_STORAGE_STATE` at `tests/browser/.auth/user.json` for test runs.

The storage file may contain session cookies/local storage entries for the deployment origin. Treat it like a credential: keep it local, `.gitignore`d.

If storage is missing or expired, authenticated tests are **skipped** with a clear message (load/overflow tests on the sign-in screen still run).

## Commands

| Command | Purpose |
|---------|---------|
| `npm run test:e2e` | All Playwright tests, all configured viewports |
| `npm run test:e2e:mobile` | `tests/browser/mobile.spec.js` only |
| `npm run test:e2e:headed` | Run with visible browser (1 worker — avoids 8 windows) |
| `npm run test:e2e:debug` | Single viewport (390px), headed, one browser — best for troubleshooting |
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
- Google Apps Script serves the HRMS UI in an **iframe**; session token and test locators target that frame, not the outer `script.google.com` wrapper.
- Role-dependent routes (e.g. Employees) skip when the session lacks access.
- Does not replace Node contract tests under `tests/*.test.js`.
