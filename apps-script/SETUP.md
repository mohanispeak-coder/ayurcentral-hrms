# HRMS Apps Script — Foundation Setup

Deploy the `apps-script/` folder as a Google Apps Script project (clasp or copy files in the Apps Script editor).

## 1. Create / bind project

1. Create a new Apps Script project (or use `clasp create --type webapp`).
2. Copy all files from `apps-script/` into the project.
3. Deploy as **Web app** with these settings (also reflected in `src/appsscript.json`):

| Deployment field | Value | Why |
| --- | --- | --- |
| **Execute as** | **Me** (`USER_DEPLOYING`) | Spreadsheet and Drive are accessed with the **script owner's** permissions. Employees do **not** need direct file access. |
| **Who has access** | **Anyone, even anonymous** (`ANYONE_ANONYMOUS`) | Lets the `/exec` URL serve the HRMS shell without Google’s multi-account chooser. Application auth (Google identity when available + email OTP + session token) remains the access control. |

**Do not** use **Anyone with Google account** (`ANYONE`) for client production — Chrome with multiple signed-in Google accounts often fails before `doGet` with Google’s “Sorry, unable to open the file at present” page.

**Do not** use **User accessing the web app** for production — that forces every employee to hold Spreadsheet/Drive ACLs on the HRMS database.

### Redeploy note

Changing `appsscript.json` alone does **not** change an already deployed web app. After updating access to `ANYONE_ANONYMOUS`, create a **new** web-app deployment (or a new version) in the Apps Script UI and use that `/exec` URL.

### Resource ownership

- The **script owner** (deploying account) must own or have Editor access to the HRMS spreadsheet and `HRMS Root` Drive folder.
- **Do not** share the spreadsheet or Drive folders with employees. The web app is the only interface.

### Authentication (dual path)

| Path | When | How |
| --- | --- | --- |
| **A — Google identity** | `Session.getActiveUser().getEmail()` is available (often same Workspace domain as script owner; may be empty under anonymous access) | Seamless login → `Users.google_email` lookup |
| **B — Email OTP** | Active user email is empty, or the active Google account is not an HRMS user | User enters registered email → MailApp 6-digit code → application session token |

- `Session.getEffectiveUser()` is the **script owner** (Sheets/Drive only) — never used for HRMS login.
- OTPs and session tokens live in **CacheService only** — never in the spreadsheet.
- Application sessions expire after **6 hours** (Apps Script cache maximum).
- OTP codes expire after **10 minutes** and are single-use.
- **Production** OTP request limit: **3 per email per 15 minutes**.
- **DEMO** allowlisted emails (no Users row): **20 per email per 15 minutes** — separate cache bucket; verify limits unchanged.
- Anonymous web-app access does **not** grant anonymous HRMS data access — every API still requires Google identity, OTP session, or admin checks.

### User provisioning

Add each user to the **Users** sheet with `google_email` set to the **exact email they will sign in with**:

- Organization Workspace email for Path A users, **or**
- Personal Gmail / external Google email for Path B users

`Employees.work_email` may differ; login always uses `Users.google_email`.

## 2. First-time database setup

In the Apps Script editor, run **`apiRunDatabaseSetup`** with an empty argument (or from the spreadsheet menu after binding):

- Creates a new spreadsheet **or** uses `HRMS_SPREADSHEET_ID` if already set in Script Properties.
- Creates all sheets and headers (idempotent — safe to rerun).
- Seeds default Settings rows only if missing.
- If the Users sheet is empty, bootstraps the **running user** as the first ADMIN (requires Google identity in the editor).

Save the spreadsheet ID from Script Properties key `HRMS_SPREADSHEET_ID`.

## 3. Drive setup (Admin)

Run **`apiRunDriveSetup`** while signed in as an ADMIN user. Creates:

```
HRMS Root/
  Employee Documents/
  Payslips/
```

## 4. Script properties

| Key | Purpose |
| --- | --- |
| `HRMS_SPREADSHEET_ID` | Google Sheets database ID |
| `HRMS_DRIVE_ROOT_FOLDER_ID` | Drive root folder ID |

## 5. Foundation self-test

Run from the Apps Script editor:

- `testFoundation_All`
- `testAuthOtp_All`
- `testWebAppExecution_All`
- `testAuthDemo_All`

Use the deployed web app URL for end-to-end UI checks.

## 6. Adding users

After first admin bootstrap, add Employees + Users rows via the future Users module, or manually in Sheets following `02_DATABASE_SCHEMA.md`.

## 7. Development / demo access mode

Use **DEMO** mode only on non-production spreadsheets while building or demonstrating the app. **PRODUCTION** is the safe default.

### Settings (Settings sheet)

| setting_key | setting_value (example) | Notes |
| --- | --- | --- |
| `app_mode` | `PRODUCTION` or `DEMO` | Defaults to `PRODUCTION` when missing |
| `demo_emails` | `dev1@gmail.com,dev2@yourdomain.com` | Comma-separated emails |
| `demo_default_role` | `ADMIN` | Role for allowlisted emails without a `demo_roles` override |
| `demo_roles` | `dev2@gmail.com:HR` | Optional `email:ROLE` pairs (comma-separated) |

### DEMO behaviour

- Allowlisted emails can access **without** Users or Employees rows (via Google identity or OTP).
- No Users/Employees rows are created automatically.
- `PermissionService` and server RBAC are unchanged.
- Demo allowlisted emails use a **separate OTP rate-limit bucket** (20 requests / 15 min). Users-sheet emails always use the production bucket (3 / 15 min) even in DEMO mode.

### Clear OTP rate-limit during development

Run from the **Apps Script editor** (not exposed via web API):

```javascript
devClearAuthOtpState('your.email@gmail.com');
```

Clears OTP and rate-limit cache keys for that email only. Does **not** grant a session.

### Switch DEMO → PRODUCTION (client go-live)

1. Set `app_mode` → `PRODUCTION`.
2. Clear `demo_emails` and `demo_roles`.
3. Ensure every real user has **Users** + **Employees** rows.
4. Confirm deployment: **Execute as Me**, **Anyone, even anonymous**.
5. Run all auth tests from §5.

In **PRODUCTION**, `demo_emails` has **no effect** — only the Users → employee_id → role → status chain grants access.
