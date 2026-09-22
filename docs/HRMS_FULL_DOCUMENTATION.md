# AyurCentral HRMS — Full documentation (reference PDF)

**Product:** AyurCentral Enterprise HRMS  
**Stack:** Google Apps Script web app + one Google Spreadsheet + Google Drive  
**Branch reference:** `cursor/experiment-500f` (two-stage leave, bulk approvals)

---

## 1. What this system is

AyurCentral HRMS is a single-tenant HRMS for employees, leave, payroll, recruitment (ATS), notifications, and an **Ask HR** knowledge assistant. All authoritative data lives in **Google Sheets** tabs; files (payslips, employee documents) live in **Google Drive**. Users sign in with **Google email + OTP**; authorization is enforced on every server API via `PermissionService`.

---

## 2. Modules at a glance

| Module | Purpose | Main UI routes |
|--------|---------|----------------|
| **Foundation** | Auth, permissions, DB, config, dashboard shell | Sign-in, Dashboard |
| **Employee** | Directory, profiles, bulk upload, documents | `employees`, `my-profile`, `my-team` |
| **Leave** | Apply, multi-stage approvals, types, balances | `my-leave`, `leave-approvals`, `leave-admin` |
| **Payroll** | Runs, inputs, calculate, lock, payslips | `payroll`, `my-payslips` |
| **Compensation** | Salary structures & components | `compensation` (often under Payroll nav) |
| **Notifications** | In-app bell, preferences, email log | `notifications` |
| **Ask HR** | RAG-style HR Q&A (Knowledge Hub) | Floating panel on all pages |
| **ATS (Recruitment)** | Jobs, candidates, applications, interviews | `ats`, `ats-jobs`, `ats-candidates` |

---

## 3. Roles and navigation (summary)

| Role | Typical access |
|------|----------------|
| **OWNER / ADMIN** | Setup, users (placeholders), all HR modules, final leave stages, payroll |
| **HR** | Employees, leave admin, payroll, recruitment, notifications |
| **MANAGER** | My team, **stage-1 leave approval** for direct reports, own leave/payslips, ATS |
| **EMPLOYEE** | My profile, my leave, my payslips (if `Users.access_*` flags allow) |

Detailed matrix: see `03_USER_ROLES_PERMISSIONS.md`.

---

## 4. Leave workflow (current policy)

### 4.1 Who approves whom

| Applicant (`Users.role`) | Approval chain |
|--------------------------|----------------|
| **Employee** (with manager) | **Manager** → then **HR or Admin** (either one completes stage 2) |
| **Employee** (no manager) | **HR or Admin** (one step) |
| **Manager** | **HR** → then **Admin** (both required, in order) |
| **HR** | **Admin only** |

Statuses on **LeaveRequests**: `PENDING_MANAGER`, `PENDING_HR`, `PENDING_ADMIN`, then `APPROVED` / `REJECTED` / `CANCELLED`. Legacy `SUBMITTED` is treated as `PENDING_MANAGER`.

### 4.2 Balances

- **Leave balances are not in the employee CSV.** On create/bulk upload, rows are seeded on **LeaveBalances** from **LeaveTypes** `annual_entitlement_days`.
- **New leave year:** Leave admin → **Start leave year (grant balances)**.

### 4.3 Bulk approval (UI)

On **Leave Approvals** and **Leave admin → Requests**: **Select all**, row checkboxes, **Approve selected** / **Reject selected** (one comment for the batch). Server runs the same rules per request.

---

## 5. Data storage (quick index)

| Sheet tab | Primary key | Purpose |
|-----------|-------------|---------|
| Employees | employee_id | Person master |
| Users | google_email | Login, role, access flags |
| LeaveTypes / LeaveBalances / LeaveRequests | various | Leave policy & workflow |
| SalaryStructures / SalaryComponents | various | Compensation |
| PayrollRuns / PayrollInputs / PayrollRecords | various | Monthly payroll |
| Documents | document_id | Drive file metadata |
| Notifications | notification_id | Email send log |
| NotificationInbox / NotificationPreferences | various | In-app bell |
| AuditLog | audit_id | Audit trail |
| Settings | setting_key | Config + ID sequences |
| JobRequisitions, Candidates, Applications, Interviews, CandidateActivity | ATS keys | Recruitment |

Full field-level map: `docs/HRMS_COMPLETE_DATA_AND_FEATURES.md` (in workspace) or spreadsheet spec `02_DATABASE_SCHEMA.md`.

**Not in Sheets:** OTP and session tokens in **CacheService**.

---

## 6. Employee lifecycle (short)

- **Create:** Employees row + optional Users row + auto **LeaveBalances** + Drive folder + audit.
- **Deactivate:** `Employees.status` = INACTIVE, `Users.status` = DISABLED — history retained.
- **No app “delete person”** — do not delete sheet rows manually without fixing dependents.

---

## 7. Deploy checklist

1. `git pull origin cursor/experiment-500f`
2. `cd apps-script` → `clasp push` (folder with `.clasp.json`, not a nested clone)
3. Apps Script → **Deploy → Manage deployments → New version**
4. Hard refresh the web app URL

---

## Appendix A — Repository documentation files

Each file below lives in the **ayurcentral-hrms** Git repo. Use it for product, data, or implementation detail.

| File | What it is |
|------|------------|
| **00_MASTER_SPEC.md** | Top-level product scope and document index for the spec set |
| **01_PRODUCT_REQUIREMENTS.md** | MUST/SHOULD requirements (notifications, payroll states, etc.) |
| **02_DATABASE_SCHEMA.md** | Canonical column list for every sheet tab |
| **03_USER_ROLES_PERMISSIONS.md** | Roles, nav matrix, permission intent |
| **04_EMPLOYEE_MODULE.md** | Employee CRUD, profile, documents behavior |
| **05_LEAVE_MODULE.md** | Leave states, validation, balance rules (update with multi-stage in code) |
| **06_PAYROLL_COMPENSATION_MODULE.md** | Payroll run workflow and compensation structures |
| **07_DASHBOARD_NOTIFICATIONS.md** | Dashboard widgets and MailApp notification events |
| **08_UI_DESIGN_SYSTEM.md** | UI patterns, components, UX conventions |
| **09_APPS_SCRIPT_ARCHITECTURE.md** | Layers, services, concurrency, no Advanced APIs |
| **10_SECURITY_AUDIT.md** | Security assumptions and review notes |
| **11_TEST_PLAN.md** | Test strategy and P0 cases |
| **12_BUILD_PLAN.md** | Build/phasing notes |
| **apps-script/SETUP.md** | clasp, script properties, first-time setup |
| **docs/ATS_INTEGRATION_NOTES.md** | How ATS connects to HRMS sheets and Drive |
| **docs/BULK_UPLOAD_TESTING_GUIDE.md** | Testing employee/payroll bulk uploads |
| **docs/HRMS_GAP_ANALYSIS.md** | Known gaps vs requirements |
| **docs/NOTIFICATIONS_INTEGRATION_NOTES.md** | Wiring leave/payroll events to NotificationEngine |
| **docs/PERF_BASELINE.md** | Performance baseline measurements |
| **docs/SHEETS_PERFORMANCE_AUDIT.md** | Spreadsheet read/write patterns |
| **docs/HRMS_Bulk_Employee_Upload_Template.csv** | CSV template for employee bulk upload |
| **docs/HRMS_FULL_DOCUMENTATION.md** | This document (source for PDF) |

---

## Appendix B — Apps Script project files (module & feature)

In the Apps Script editor, files appear with a **folder prefix** (e.g. `ats/ApiAts.gs`). Below, **Module** = product area; **Feature** = what the file does.

### B.1 Project root

| File | Module | Feature |
|------|--------|---------|
| **appsscript.json** | Project | Manifest (time zone, web app, OAuth scopes) |

### B.2 foundation/ — Core platform

| File | Feature |
|------|---------|
| **Main.gs** | Web app `doGet`, HTML `include()`, spreadsheet menu (setup, ATS/notification schema) |
| **Constants.gs** | Sheet names, roles, actions, employee/user status enums |
| **ApiFoundation.gs** | Auth OTP APIs, home dashboard bundle, lazy module UI loader, setup runners |
| **AuthService.gs** | Login, OTP issue/verify, session resolution |
| **AuthSessionService.gs** | Session token storage and validation helpers |
| **PermissionService.gs** | Role-based actions and sidebar navigation |
| **UserAccessService.gs** | Per-user flags: `access_leave`, `access_payslips`, `access_documents` |
| **DbService.gs** | Spreadsheet CRUD, sequences, batch insert |
| **SchemaService.gs** | Bootstrap sheet headers and setup |
| **ConfigService.gs** | Settings key/value with cache |
| **AuditService.gs** | Append audit log rows |
| **Errors.gs** | Typed errors (validation, auth, conflict, not found) |
| **DriveService.gs** | HRMS Drive root and employee document folders |
| **HomeDashboardService.gs** | Role-scoped dashboard counts (leave queue, payroll, ATS, notifications) |
| **LockUtil.gs** | Script lock helpers |
| **PerfUtil.gs** | `HrmsPerf` timing for slow-path investigation |

### B.3 employee/ — People & directory

| File | Feature |
|------|---------|
| **EmployeeService.gs** | Create/update/status, validation, leave balance seed on hire, Drive folder |
| **EmployeeRepository.gs** | Sheet access for Employees, Users, leave types/balances lookups |
| **EmployeeBulkService.gs** | Validate/commit bulk employee CSV upload |
| **ApiEmployee.gs** | Client APIs: list, get, create, update, status |
| **ApiEmployeeBulk.gs** | Bulk upload validate/commit APIs |
| **ApiEmployeeAccess.gs** | Document access APIs for employee files |
| **EmployeeClient.html** | Employees UI: directory, create, profile client logic |
| **EmployeePages.html** | Employee page templates/partials |

### B.4 leave/ — Time off

| File | Feature |
|------|---------|
| **LeaveEngine.gs** | Pure rules: day count, overlap, multi-stage approval auth, status labels |
| **LeaveService.gs** | Types, balances, submit/approve/reject/cancel/revoke, bulk approve/reject, calendar, year start |
| **LeaveLopService.gs** | LOP days from approved leave for open payroll runs |
| **ApiLeave.gs** | All `apiLeave*` endpoints for client |
| **LeaveUi.html** | Leave screens: apply, my leave, approvals (incl. bulk select), admin, calendar |
| **LeaveClient.html** | Leave module registration and route hooks |

### B.5 payroll/ — Payroll & compensation

| File | Feature |
|------|---------|
| **PayrollEngine.gs** | Pure pay calculation from structure + inputs |
| **PayrollService.gs** | Runs lifecycle: draft, calculate, review, approve, lock |
| **PayrollBulkService.gs** | Bulk attendance / payroll input upload |
| **PayrollLeaveBridge.gs** | Refresh LOP from leave on unlocked runs |
| **CompensationService.gs** | Salary structure CRUD and components |
| **CompensationBulkService.gs** | Bulk compensation upload |
| **PayslipService.gs** | Payslip generation and document records |
| **ApiPayroll.gs** | Client payroll and compensation APIs |
| **PayrollClient.html** | Payroll UI: runs, inputs, bulk sections, payslips |

### B.6 notifications/ — Notification center

| File | Feature |
|------|---------|
| **NotificationEngine.gs** | Event catalog, payloads, routing (leave, payroll, ATS) |
| **NotificationService.gs** | Create inbox rows, email via MailApp, preferences |
| **NotificationSchema.gs** | Ensure NotificationInbox / Preferences sheets |
| **NotificationAdapters.gs** | `NotificationLeaveAdapter` etc. — called after business commits |
| **NotificationTriggers.gs** | Time-driven or batch trigger helpers |
| **ApiNotifications.gs** | Bell, inbox, preferences, announcements APIs |
| **NotificationClient.html** | Notifications page UI |
| **NotificationBell.html** | Header bell dropdown |

### B.7 knowledge/ — Ask HR

| File | Feature |
|------|---------|
| **AskHrService.gs** | Orchestrates question → Knowledge Hub / grounding |
| **KnowledgeHubClient.gs** | HTTP client to external Knowledge Hub web app |
| **AskHrEmployeeLookup.gs** | Optional employee context for answers |
| **AskHrDiagnostic.gs** | Admin/diagnostic helpers for Ask HR setup |
| **ApiAskHr.gs** | `apiAskHr*` client endpoints |

### B.8 ats/ — Recruitment (ATS)

| File | Feature |
|------|---------|
| **AtsConstants.gs** | ATS sheet names and enums |
| **AtsSchemaService.gs** | ATS tab headers and ensure schema |
| **AtsRepository.gs** | CRUD for jobs, candidates, applications, interviews |
| **AtsEngine.gs** | Business rules and permissions helpers |
| **AtsPermissionService.gs** | ATS-specific role checks |
| **AtsService.gs** | Jobs, candidates, pipeline, interviews orchestration |
| **AtsBulkService.gs** | Bulk import for candidates/applications |
| **AtsDriveService.gs** | Resume and attachment folders on Drive |
| **ApiAts.gs** | Authenticated ATS APIs for HRMS UI |
| **ApiAtsBulk.gs** | Bulk ATS APIs |
| **ApiAtsPublic.gs** | Public job board / apply endpoints (unauthenticated) |
| **AtsWeb.gs** | Public `doGet` routing for careers/apply URLs |
| **AtsApp.html** | ATS shell / layout in Apps Script |
| **AtsClient.html** | ATS module UI (jobs, candidates, kanban-style flows) |
| **AtsPublicApply.html** | Public application form HTML |

### B.9 ui/ — HRMS shell (all modules)

| File | Feature |
|------|---------|
| **Index.html** | Main SPA shell: auth gate, sidebar, route container |
| **Scripts.html** | Router, `callServer`, nav groups, dashboard, module loader |
| **Styles.html** | Global CSS, design tokens, tables, bulk toolbars |

### B.10 tests/ — Apps Script unit tests (run in editor)

| File | Feature |
|------|---------|
| **TestFoundation.gs** | Schema, auth, permissions smoke tests |
| **TestEmployee.gs** | Employee service tests |
| **TestLeave.gs** | Leave workflow tests |
| **TestPayroll.gs** | Payroll engine/service tests |
| **TestAts.gs** | ATS tests |
| **TestNotifications.gs** | Notification tests |
| **TestAskHr.gs** | Ask HR tests |
| **TestAuthOtp.gs** / **TestAuthDemo.gs** | Auth flows |
| **TestStartupPerf.gs** / **TestPerfInvestigation.gs** | Performance |
| **TestWebAppExecution.gs** | Web app smoke |

### B.11 Repo tests/ (Node, on your PC)

Node tests under `tests/*.test.js` validate HTML/`.gs` contracts (leave, payroll, nav, notifications) without deploying. Run: `node tests/leave-engine.test.js`.

---

## Appendix C — How files map to the Apps Script editor

- **clasp** pushes `apps-script/src/**` to the cloud project; folder names become the prefix you see (e.g. `ats/ApiAts.gs`).
- **HTML** files in `ui/`, `leave/`, `employee/`, etc. are included via `include()` or lazy-loaded through `apiGetModuleUi`.
- **Entry point** for employees using HRMS: `foundation/Main.gs` → `ui/Index.html`.
- **Entry point** for public careers pages: `ats/AtsWeb.gs` + `ats/AtsPublicApply.html` when configured.

---

*Generated for AyurCentral HRMS operators and implementers. For the widest data dictionary, also keep `HRMS_COMPLETE_DATA_AND_FEATURES.md` in your docs folder.*
