# AyurCentral HRMS — Module roadmap / gap analysis

**Date:** 29 August 2026  
**Scope:** Analysis and documentation only. No application code was changed. No deploy.  
**Code inspected:** `apps-script/src` (live). Remote backups were not treated as product.  
**Interactive view:** Cursor canvas `hrms-gap-analysis.canvas.tsx` (open beside chat).

Classification: **A** essential · **B** important · **C** advanced/later · **D** not for our target.  
Existence: **full** / **partial** / **placeholder** / **missing** — from code, not README.

---

## 1. Where the artifacts live

| Artifact | Path |
| --- | --- |
| Interactive canvas | `C:\Users\MR\.cursor\projects\c-Users-MR-Projects\canvases\hrms-gap-analysis.canvas.tsx` |
| This report | `C:\Users\MR\Projects\Ayurcentral_HRMS\docs\HRMS_GAP_ANALYSIS.md` |

The canvas filters by class and existence, scores remaining work, and walks the phased roadmap. Filter state persists via the canvas host API (not `localStorage`).

---

## 2. Executive summary

AyurCentral HRMS is already a **working leave + payroll + employee-master app**, not an empty shell. Employee, Leave, Compensation, Payroll (through LOCKED), and Payslips are implemented with server-side RBAC. Ask HR is in active development (UI + HMAC client + tests) and must not be rebuilt by another stream.

It is **not yet a strong HRMS** because the Phase 1 product defined in `00_MASTER_SPEC.md` is unfinished in the places HR would use every day:

1. **Dashboard is a stub** (employee ID, role, “Phase 1 — Employee”) — not the attention dashboard in `07_DASHBOARD_NOTIFICATIONS.md`.
2. **Notifications, Settings, and Users are explicit nav placeholders** (`placeholder: true` in `PermissionService.gs`). Leave emails exist; payroll emails do not.
3. **Operators still need the spreadsheet** for users, roles, and settings (no `apiSaveSetting` / users admin API).
4. **Leave day-count ignores India holidays** (weekends only).
5. **Payroll working/paid/LOP is still typed per employee** — no CSV/paste from the existing biometric extract.
6. **Employment exit is deactivate-only** — no F&F, last working day, or relieving letter.

Kredily-style ATS, performance, expenses, assets, and punch attendance would **not** make this a stronger product for AyurCentral. The company already has biometric attendance; the master spec forbids storing punches. The smallest strong set is: **finish the current product, add a holiday calendar, import attendance into payroll, then a lite join/exit path and accountant extracts.**

---

## 3. What actually exists vs placeholder

### Full (usable in the web app)

| Area | What works | Evidence |
| --- | --- | --- |
| Auth | Google identity + email OTP, DEMO mode, session cache | `AuthService.gs`, `AuthSessionService.gs` |
| RBAC | ADMIN / HR / MANAGER / EMPLOYEE; every module API re-checks | `PermissionService.gs` |
| Employee | Directory, My Team, create/edit, activate/deactivate, profile tabs, self-edit phone/address, create User on hire | `EmployeeService.gs`, `EmployeeClient.html` |
| Documents | HR upload + RBAC download to Drive employee folder | `uploadDocument`, `DriveService.gs` |
| Leave | Types, balances, draft/submit/cancel, approve/reject, half-day, overlap, year start, month calendar of approved leave, LOP reader | `LeaveService.gs`, `LeaveEngine.gs`, `LeaveUi.html` |
| Payroll | Structures, revise, run DRAFT→LOCKED, inputs, calculate, correction runs, department totals, lock blocks | `PayrollService.gs`, `PayrollEngine.gs`, `CompensationService.gs` |
| Payslips | HTML files on Drive; My Payslips + profile tab download | `PayslipService.gs` |
| LOP bridge | Approved LOP leave → `lop_from_leave` on open runs | `LeaveLopService.gs`, `PayrollLeaveBridge.gs` |
| Audit writes | Create/update/status, leave, payroll, Ask HR | `AuditService.gs` |
| Leave email | SUBMITTED / APPROVED / REJECTED via `MailApp`; rows in Notifications sheet | `LeaveService.notifyLeave_` |

### Partial (backend or UI exists, not a complete capability)

| Area | Gap |
| --- | --- |
| Org / dept / designation / location | Free-text on Employees; filters from unique values; no masters |
| Lifecycle | ACTIVE/INACTIVE only; no last working day, probation, transfers |
| Documents | No types, expiry, employee self-upload, policy ack |
| Leave approval | Single manager + HR override; no multi-level |
| Statutory | PF/ESI as configurable components; TDS as HR input; no ceilings/slabs/engine |
| Payroll reports | Department totals on the run only |
| Notifications | Leave only; `notification_payroll` setting unused; no log UI |
| Ask HR | Substantial code; depends on `KH_WEBAPP_URL` / `KH_HMAC_SECRET` |
| Audit | `apiGetRecentAudit` exists; no screen |
| Settings | Sheet + `ConfigService`; no admin UI |

### Placeholders (nav or stub UI)

| Route | Evidence |
| --- | --- |
| Dashboard | `Scripts.html` `renderDashboard` — three KPIs, welcome copy. Not “module not yet implemented”, but not the spec either. |
| Notifications | `PermissionService` `placeholder: true`; `Scripts.html` `renderPlaceholder` |
| Settings | Same |
| Users | Same |

Sidebar footer still says “Phase 1”. Bootstrap payload still sends `phase: 'foundation'`.

### Missing as modules (no sheets, APIs, or routes)

Attendance store, holiday calendar, recruitment, performance, expenses, assets, onboarding checklist, resignation/F&F, announcements, Form 16, compliance extracts, headcount/attrition reports.

---

## 4. Recommended implementation order

Optimized for the **smallest set that is a genuine HRMS**, not Kredily parity.

### Parallel (do not block)

Finish **Ask HR / Knowledge Hub** (other agents). Inspect only; do not modify those files in this stream.

### Phase 0 — Finish the current product (do this first)

Not new modules. These are Phase 1 MUST items already specified.

1. **Attention dashboard** — active headcount, on leave today, pending `SUBMITTED`, current payroll status, exception count, failed emails, recent audit, role-appropriate quick links (`07_DASHBOARD_NOTIFICATIONS.md`).
2. **Notifications complete** — `PAYROLL_READY_REVIEW`, `PAYROLL_APPROVED`, `PAYSLIP_AVAILABLE`; failed-email retry; Notifications log UI (replace placeholder).
3. **Users admin UI** — list Users, set role/status, map `google_email` ↔ `employee_id` (replace placeholder). Create-on-hire already exists.
4. **Settings admin UI** — company name, leave year, working days, rounding, lock flags, notification toggles, timezone (replace placeholder). Keys already in `SchemaService`.
5. **Audit log viewer** — wrap `apiGetRecentAudit` / `getRecent`.
6. **Holiday calendar** — company holidays; `LeaveEngine` day-count must skip them (today: weekends only).
7. **Payroll input CSV/paste** — working/paid/LOP/bonus/TDS into a DRAFT run (spec SHOULD; this is the biometric *bridge*, not a timeclock).

After Phase 0, HR can run the month without living in Sheets, leave math is credible in India, and payroll can ingest a biometric extract.

### Phase 1 — Lifecycle lite (what Excel cannot do)

8. **Org picklists** — Departments, designations, locations as small masters (stop free-text drift).
9. **Onboarding lite** — joining checklist, required-document list (reuse Drive upload), policy acknowledgement, `probation_end` + dashboard alert.
10. **Offboarding lite** — resignation + last working day, clearance checklist, **F&F** (last payroll / leave encashment as inputs, not a new engine), relieving/experience letter to Drive (same pattern as payslips).

This is the smallest *new* HR surface. It is not a BPM suite.

### Phase 2 — Reports accountants will actually use

11. Directory + leave-balance CSV.
12. Payroll register, bank transfer list, PF/ESI/TDS extracts from **LOCKED** snapshots.
13. Attrition once last working day exists.

Still **not** a statutory engine and **not** Form 16.

### Phase 3 — Only if operations demand it

Announcements; multi-level leave; PT as a salary component.

### Phase 4 / skip

| Build later | Do not build for this target |
| --- | --- |
| Performance reviews | Punch attendance / check-in / shifts / late-early |
| Expense claims | ATS, pipeline, interviews, offers |
| Asset register | Form 16 generator, PF wage-ceiling engine |
| Org chart visualization | WhatsApp/SMS, workflow designer, custom roles |

---

## 5. Catalog (every evaluated item)

Legend: **Cls** A/B/C/D · **Ex** full / partial / placeholder / missing.

### Core HR

| Capability | Cls | Ex | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Employee directory | A | full | `EmployeeService.listDirectory`, `EmployeeClient.html` | Search, filters, pagination; no salary |
| Employee profiles | A | full | Profile tabs in `EmployeeClient.html` | Personal, employment, payroll IDs, leave, docs, payslips |
| Org structure | B | partial | `manager_employee_id`, `listMyTeam` | Direct reports only |
| Departments | B | partial | Free-text `department` | Filter exists; no master |
| Designations | B | partial | Free-text `designation` | Same |
| Locations | B | partial | Free-text `location` | Same |
| Employment lifecycle | A | partial | `ACTIVE`/`INACTIVE`, types, `joining_date` | No history, LWD, probation |
| Onboarding process | B | missing | Hire seeds leave/user/folder only | See Onboarding |
| Offboarding process | A | partial | `setStatus` disables user | Not F&F |
| Employee documents | A | partial | `uploadDocument` / `downloadDocument` | No expiry/types/self-upload |
| Employee self-service | A | full | My Profile / Leave / Payslips | Phone/address self-edit |

### Attendance

| Capability | Cls | Ex | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Attendance register / punches | D | missing | Spec forbids; no sheet | Biometric owns this |
| Check-in / check-out | D | missing | None | Skip |
| Work schedules | C | missing | `default_working_days` only | Monthly number, not roster |
| Shifts | C | missing | None | Skip for now |
| Late / early | C | missing | None | Biometric |
| Overtime engine | C | missing | `other_earnings` can hold amount | No hours×rate |
| Regularization | C | missing | None | Skip |
| Import working/paid/LOP | A | missing | `saveInputs` per row; no CSV | **Smallest-set** attendance bridge |

### Leave

| Capability | Cls | Ex | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Policies / type rules | A | full | `LeaveTypes`, `saveType` | Entitlement, CF max, LOP flag |
| Balances | A | full | `LeaveBalances`, year start | No monthly accrual (FUTURE by spec) |
| Types admin | A | full | Leave admin UI | CRUD |
| Approval workflows | A | partial | Single manager + HR | Enough for a strong HRMS |
| Holiday calendar | A | missing | `WEEKDAYS_ONLY` / `CALENDAR_DAYS` | **Smallest-set** |
| LOP ↔ payroll | A | full | `LeaveLopService`, bridge | Never writes LOCKED runs |

### Payroll

| Capability | Cls | Ex | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Compensation admin | A | full | `CompensationService` | Revise, not edit superseded |
| Salary structures | A | full | Components FIXED / % basic | |
| Processing workflow | A | full | DRAFT→LOCKED, corrections | Server net pay |
| LOP in inputs | A | full | `lop_days`, `lop_from_leave` | HR may override |
| Statutory engine | B | partial | PF/ESI components; TDS input | Correct: not Indian statute |
| Payslips | A | full | `PayslipService` | No payslip email yet |
| Payroll reports | A | partial | `departmentTotals_` | Need bank/register/extracts |
| History | A | full | Locked runs + corrections | |

### Performance

All **C** or **D**, **missing**. Not in the smallest set. Development plans are **D**.

### Recruitment

Requisitions, postings, candidate DB, pipeline, interviews, offers: **D**, **missing**. Hiring→employee is **C** / missing as ATS — `apiCreateEmployee` is already the conversion.

### Onboarding

| Capability | Cls | Ex | Notes |
| --- | --- | --- | --- |
| Joining checklist | B | missing | Phase 1 lite |
| Document collection | A | partial | HR upload exists; no required list |
| Policy acknowledgement | B | missing | Pair with Ask HR |
| Task assignment | C | missing | Checklist is enough |
| Probation tracking | B | missing | Date + dashboard alert |

### Offboarding

| Capability | Cls | Ex | Notes |
| --- | --- | --- | --- |
| Resignation | B | missing | Phase 1 |
| Notice period | B | missing | LWD field is the minimum |
| Exit interview | C | missing | Drive form |
| Clearance | B | missing | Phase 1 |
| Asset return | C | missing | One clearance line |
| Final settlement | A | missing | **Essential** lifecycle item |
| Experience / relieving | B | missing | Payslip-style Drive letter |

### Expenses

All **C**, **missing**. Pay rare amounts via `other_earnings`. Not required.

### Assets

Register / assignment / returns / history: **C**, missing. Maintenance: **D**. Skip for smallest set.

### Documents

| Capability | Cls | Ex | Notes |
| --- | --- | --- | --- |
| Employee files | A | partial | Works; no expiry |
| Policy library UI | B | missing | Hub is Q&A |
| Expiry tracking | B | missing | Phase 1 |
| Acknowledgement | B | missing | Same as policy ack |

### Communication

| Capability | Cls | Ex | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Announcements | B | missing | None | Phase 3 |
| Operational notifications | A | partial | Leave `MailApp` + Notifications sheet; nav placeholder | Payroll events missing |
| Employee alerts | B | missing | Dashboard stub | Birthdays SHOULD |
| Ask HR chatbot | B | partial | `AskHrService`, `KnowledgeHubClient`, FAB in `Index.html` | In development |

### Reporting

| Capability | Cls | Ex | Notes |
| --- | --- | --- | --- |
| Attention dashboard | A | placeholder | Spec MUST; stub UI |
| Headcount | A | missing | Dashboard widget |
| Attrition | B | missing | Needs LWD |
| Leave reports | B | partial | Admin list + calendar |
| Attendance reports | D | missing | Stay in biometric |
| Payroll reports | A | partial | Dept totals only |
| Department analytics | C | partial | Blocked on masters |
| Employee exports | B | missing | Directory CSV |

### Administration

| Capability | Cls | Ex | Notes |
| --- | --- | --- | --- |
| Users UI | A | placeholder | Sheet + hire-create only |
| Roles | A | partial | Four hardcoded roles — keep; need assign UI |
| Permissions | A | partial | Server matrix; no editor (good) |
| Settings UI | A | placeholder | Sheet only |
| Workflow config | C | missing | Hardcoded states are fine |
| Leave policy config | A | full | Types UI |
| Payroll config UI | A | partial | Keys exist |
| Audit viewer | A | partial | API, no UI |

### Compliance (India)

| Capability | Cls | Ex | Notes |
| --- | --- | --- | --- |
| Statutory config | B | partial | Components, not law |
| PF | B | partial | % of basic; no ceiling |
| ESI | B | partial | Sample FIXED line |
| Professional Tax | C | missing | Add as component if needed |
| TDS | A | partial | Monthly input by design |
| Form 16 | C | missing | Accountant tool |
| Compliance extracts | B | missing | Phase 2 from LOCKED snapshots |

---

## 6. Files inspected (read only)

No files under `apps-script/src` were modified.

**Foundation:** `Constants.gs`, `SchemaService.gs`, `PermissionService.gs`, `Main.gs`, `ApiFoundation.gs`, `AuthService.gs`, `AuthSessionService.gs`, `ConfigService.gs`, `AuditService.gs`, `DriveService.gs`, `DbService.gs`

**Employee:** `EmployeeService.gs`, `EmployeeRepository.gs`, `ApiEmployee.gs`, `EmployeeClient.html`, `EmployeePages.html`

**Leave:** `LeaveService.gs`, `LeaveEngine.gs`, `LeaveLopService.gs`, `ApiLeave.gs`, `LeaveUi.html`, `LeaveClient.html`

**Payroll:** `PayrollService.gs`, `PayrollEngine.gs`, `CompensationService.gs`, `PayslipService.gs`, `PayrollLeaveBridge.gs`, `ApiPayroll.gs`, `PayrollClient.html`

**Ask HR (inspect only):** `AskHrService.gs`, `ApiAskHr.gs`, `KnowledgeHubClient.gs`, `TestAskHr.gs`

**UI shell:** `Index.html`, `Scripts.html`, `Styles.html`

**Specs (claims vs code):** `00_MASTER_SPEC.md`, `01_PRODUCT_REQUIREMENTS.md`, `03_USER_ROLES_PERMISSIONS.md`, `04_EMPLOYEE_MODULE.md`, `06_PAYROLL_COMPENSATION_MODULE.md`, `07_DASHBOARD_NOTIFICATIONS.md`, `12_BUILD_PLAN.md`

---

## 7. Scoring used in the canvas

`score = classWeight × gapWeight`

| Class | Weight | Existence | Weight |
| --- | ---: | --- | ---: |
| A essential | 4 | missing | 3 |
| B important | 3 | placeholder | 2.5 |
| C later | 1 | partial | 1.5 |
| D skip | 0 | full | 0 |

Example: holiday calendar (A + missing) = 12; dashboard (A + placeholder) = 10; payroll reports (A + partial) = 6.

---

## 8. Definition of “strong HRMS” for this product

After Phase 0–2, AyurCentral HRMS should let HR:

- Maintain a clean employee master with picklists and ESS  
- Run leave with holidays, approvals, and LOP into payroll  
- Close monthly payroll, lock it, issue payslips, and email the right people  
- Import biometric working/paid/LOP instead of retyping  
- See what needs attention today without opening Sheets  
- Join and exit people with a short checklist and F&F  
- Give accounts PF/ESI/TDS extracts from locked snapshots  
- Ask policy questions in Ask HR  

That is competitive for an internal India HRMS on Apps Script. It is not Kredily.
