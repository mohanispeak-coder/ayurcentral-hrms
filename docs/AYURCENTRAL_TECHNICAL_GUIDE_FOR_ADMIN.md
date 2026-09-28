# AyurCentral HRMS - Technical Guide (for system owner / developer)

**Audience:** System owners and technical administrators. Complements the HR-facing manual.  
**Pair with:** `docs/AYURCENTRAL_HR_USER_MANUAL.md` (share only that one with HR).

---

## 1. What the product is

| Layer | Technology |
| --- | --- |
| UI | Single-page web app (HTML/JS) served by **Google Apps Script** web app (`doGet` → `Index.html` + lazy-loaded module HTML). |
| API | Apps Script server functions (`api*` entry points) called via `google.script.run` wrapper in `Scripts.html`. |
| Data | Google **Spreadsheet** tabs (Employees, PayrollRuns, PayrollInputs, etc.) via `DbService`. |
| Files | Google **Drive** (documents, payslip HTML, bulk upload staging). |
| Email | `MailApp` + `Notifications` sheet log. |

**Security model:** UI hides routes by role, but **every API call re-checks** `PermissionService` / session. Spreadsheet editor access is **not** the app security boundary.

---

## 2. Repository layout (high level)

```
apps-script/src/
  foundation/     Auth, Db, Schema, Permissions, Constants, ApiFoundation
  ui/             Shell, Scripts.html, Styles, SettingsClient
  employee/       Directory, profiles, mandatory fields
  leave/          Types, balances, apply, approve
  payroll/        PayrollService, Compensation, Attendance bulk, Form T, Salary statement
  ats/            Jobs, candidates, hire letters, create employee from hire
  notifications/  Bell, inbox, email log
tests/            Node-based string/regression tests (not full E2E)
docs/             Integration notes + user manuals
```

Deploy: `apps-script/SETUP.md` - `clasp push`, `clasp deploy`, set web app URL.

**Client cache bust:** `HRMS.CLIENT_ASSETS_VERSION` in `Constants.gs`; bootstrap returns `clientAssetsVersion` to the browser.

---

## 3. Authentication and users

- Sign-in: Google account → `AuthService` resolves session (`Users` sheet: `google_email`, `employee_id`, `role`, status).
- Roles: `OWNER`, `ADMIN`, `HR`, `MANAGER`, `EMPLOYEE` (see `03_USER_ROLES_PERMISSIONS.md`).
- OTP / session token stored client-side (`hrms_session_token`); expired session returns authorization errors on API calls.
- **OWNER** bypasses some module-matrix restrictions; treat as super-admin.

Navigation items: `PermissionService.NAV_ITEMS_` filtered by role; optional **Settings → HRMS module access by role** matrix persists overrides.

---

## 4. Routing and modules

`Scripts.html` maps **route → module id** for lazy load (`apiLoadModuleUi`):

| Route | Module | Purpose |
| --- | --- | --- |
| `payroll`, `payroll-run`, `salary-structure`, `compensation`, `attendance-bulk-upload`, `attendance-form-t` | payroll / payroll-attendance | Monthly payroll path |
| `salary-statement` | payroll-statement | CTC statement export |
| `employees`, `employee-profile`, `employee-mandatory-fields`, … | employee | HR master data |
| `leave-*` | leave | Leave lifecycle |
| `ats-*` | ats | Recruitment |
| `notifications` | notifications | Inbox + email log |
| `settings` | settings | Admin configuration |

The sidebar groups **Attendance** and **Payroll** as separate collapsible sections for HR users.

---

## 5. Payroll - backend design (what HR screens depend on)

### 5.1 Data flow

```
SalaryStructures (+ components)     ← Compensation / salary-structure UI
        ↓
PayrollRuns (header: year, month, vertical_name, status)
PayrollInputs (per employee: days, daily_attendance_json, bonus, TDS, …)
        ↓
PayrollService.calculate() → PayrollEngine
        ↓
PayrollRecords (snapshot + component_breakdown JSON)
        ↓
LOCK → PayslipService → Drive + Documents
```

### 5.2 Run IDs and verticals

| Pattern | Example | `vertical_name` |
| --- | --- | --- |
| Legacy combined | `PR-2026-09` | empty |
| Per vertical | `PR-2026-09-SAPL` | `SAPL` |
| Correction | `PR-2026-09-SAPL-C1` | same as source |

- `findOpenRun_(year, month, vertical)` - only one open draft per vertical per month.
- `eligibleEmployees_` filters by employee `vertical_name` (or ID prefix) when run has a vertical.
- `AttendanceBulkService.assertRunVerticalMatches_` blocks uploading SAPL register into AOPL run.

### 5.3 Legacy import

- `importInputsFromLegacyRun` / `apiPayrollImportLegacyInputs` - copies inputs (including `daily_attendance_json`) from combined run to vertical run for matching employees.
- `tryAutoImportFromLegacy_` on `createRunInsideLock_` after `seedInputs_`.
- Client: `legacyImportHint`, `attendance_input_count` on run list, banners, `resolveTargetRunForPeriod_` fallback to legacy when vertical draft has zero attendance.

### 5.4 Workflow states

`DRAFT → CALCULATED → UNDER_REVIEW → APPROVED → LOCKED`  
No unlock in Phase 1 - `createCorrectionRun` from LOCKED source seeds inputs from source (including `daily_attendance_json` on corrections).

### 5.5 Key APIs (Payroll)

| API | Service method |
| --- | --- |
| `apiListPayrollRuns` | `listRuns` |
| `apiGetPayrollRun` | `getRunDetail` (+ sync eligible employees) |
| `apiCreatePayrollRun` | `createRun(year, month, vertical, notes)` |
| `apiCreatePayrollRunsAllVerticals` | `createRunsForAllVerticals` |
| `apiPayrollImportLegacyInputs` | `importInputsFromLegacyRun` |
| `apiSavePayrollInputs` | `saveInputs` |
| `apiCalculatePayroll` | `calculate` |
| `apiLockPayroll` / `apiFinalizePayroll` | lock / finalize |
| `apiCreatePayrollCorrection` | `createCorrectionRun` |
| Attendance bulk | `AttendanceBulkService.validateUpload` / `commitUpload` |

Full list: `ApiPayroll.gs`.

---

## 6. Leave ↔ payroll bridge

- `PayrollLeaveBridge.getApprovedLopMapForPayroll` → `lop_from_leave` on inputs.
- `refreshLopFromLeave` / `applyLeaveLopToDays` - HR opt-in to copy into `lop_days` and recompute `paid_days`.
- Approved leave changes do **not** alter LOCKED runs.

---

## 7. Employee module (backend hooks)

- Create: allocate `employee_id`, seed `LeaveBalances`, optional Drive folder, audit log.
- `PayrollService.syncOpenPayrollRunsForEmployee` adds new active employees to open draft runs.
- Mandatory fields: configurable required columns for create/bulk (employee-mandatory-fields route).

---

## 8. ATS → HRMS hire path

- Stages in `AtsConstants` / `AtsEngine`; terminal hire stage `HIRED`.
- Letters: PDF generation + email (templates in Settings + code-managed HTML layouts).
- `CompensationService` + `PayrollEngine` for offer salary breakup on PDF.
- Create employee from hire: RPC creates `Employees` row with new ID; links application to employee.

See `docs/ATS_INTEGRATION_NOTES.md`.

---

## 9. Notifications

- Event types: leave submitted/approved/rejected, payroll review, payslip available, etc.
- Rows in `Notifications` sheet; HR views delivery log in app.
- Toggles in Settings → email section.

See `docs/NOTIFICATIONS_INTEGRATION_NOTES.md`.

---

## 10. Settings and schema maintenance

- **Settings** sheet: booleans, role module matrix, content templates, company emails.
- **Database setup:** HRMS menu in spreadsheet or `SchemaService.ensureSheetHeaders` - adds columns such as `PayrollRuns.vertical_name`, template rows.
- If Settings templates missing, UI shows warning to run database setup.

---

## 11. Deploy and verify

```bash
cd apps-script
clasp push
clasp deploy   # or update existing deployment
```

Pull the latest application source from your repository before deploying, if your team uses version control.

**Verify in browser:**

1. Footer on payroll pages shows `clientAssetsVersion` (version string updates when IT deploys a new build).
2. Sidebar shows Attendance + Payroll sections for HR roles.
3. Combined legacy + import banner on vertical runs when older combined data exists.

**Tests (local):**

```bash
node tests/payroll-vertical-runs.test.js
```

---

## 12. Operational troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| HR sees old UI | Deployment not updated or cached | New deployment + hard refresh; check `CLIENT_ASSETS_VERSION`. |
| Empty vertical payroll | Data on `PR-YYYY-MM` | Import legacy or open combined run. |
| Calculate skips employees | `MISSING_STRUCTURE` / zero working days | Fix structure or attendance. |
| Cannot finalize | Still DRAFT or exception flags | Calculate; resolve Payroll check blockers. |
| 403 on API | Role or module matrix | Users sheet role; Settings module access. |
| Ask HR errors | Feature flag / API key | Settings + `AskHr` service config. |

---

## 13. Spec documents (source of truth)

| Doc | Topic |
| --- | --- |
| `00_MASTER_SPEC.md` | Product scope |
| `03_USER_ROLES_PERMISSIONS.md` | Roles matrix |
| `04_EMPLOYEE_MODULE.md` | Employee master |
| `05_LEAVE_MODULE.md` | Leave workflow |
| `06_PAYROLL_COMPENSATION_MODULE.md` | Payroll math and states |
| `07_DASHBOARD_NOTIFICATIONS.md` | Dashboard + mail events |
| `09_APPS_SCRIPT_ARCHITECTURE.md` | Code structure |

---

## 14. Regenerating the PDF manuals

From the `docs` folder:

```bash
python3 build-ayurcentral-manuals-pdf.py
```

This writes `AYURCENTRAL_HR_USER_MANUAL.pdf` and `AYURCENTRAL_TECHNICAL_GUIDE_FOR_ADMIN.pdf` next to the markdown sources.

---

*Internal technical guide - not for distribution to end-user HR staff.*
