# AyurCentral HRMS — Master Specification

**Document:** `00_MASTER_SPEC.md`  
**Status:** Phase 1 source of truth (Round 2 audit)  
**Product:** AyurCentral HRMS (lightweight internal HRMS)

If documents conflict, use this order: this file → `02_DATABASE_SCHEMA.md` → `03_USER_ROLES_PERMISSIONS.md` → module specs → UI → architecture.

---

## 1. Product vision

A **simple internal web app** that replaces Excel/email for employee master data, leave, and monthly payroll. Not an enterprise HRMS. HR must be able to run it without being payroll specialists. Stack: Google Apps Script + Sheets + Drive + MailApp.

---

## 2. Phase 1 scope (only this)

**Visible modules**

1. Dashboard  
2. Employee Management  
3. Leave Management  
4. Payroll & Compensation  
5. Notifications  

**Cross-cutting**

6. User roles and permissions  
7. Audit log  
8. Google Drive document handling  
9. Configuration / Settings  

**Out of Phase 1 (do not design or build):** attendance capture, recruitment, performance, onboarding, exit, training, expenses, travel, Gemini/AI, mobile app, complex external integrations, enterprise payroll/tax engine, accounting/GL.

### Attendance boundary (mandatory)

The company **already has biometric attendance**. Phase 1 must **not** store punches, shifts, or attendance calendars.

Payroll **attendance-related inputs** (working days, paid days, LOP) are entered by **HR manually**. A later phase may import a file or biometric extract into the same `PayrollInputs` columns. Do not build that import now.

---

## 3. Priority (MUST / SHOULD / FUTURE)

### MUST HAVE

- Employee master with immutable `employee_id`
- Roles: Admin, HR, Manager, Employee (one primary role)
- Leave types (configurable), balances, apply → manager review → approve/reject → notify
- Overlap and insufficient-balance checks
- LOP suggestion into **open** payroll inputs (never into LOCKED payroll)
- Salary structure + monthly payroll inputs + server-side calculate
- Payroll states: `DRAFT` → `CALCULATED` → `UNDER_REVIEW` → `APPROVED` → `LOCKED`
- Locked payroll **immutable**; correction = **new run**, not overwrite
- Payslips on Drive; app-mediated access
- Actionable HR dashboard
- Email: leave submitted/approved/rejected; payroll ready; payroll approved; payslip available
- Audit of important actions only
- Server-side RBAC; no public Drive links

### SHOULD HAVE (build if time; do not block launch)

- Leave `DRAFT` (save before submit)
- Half-day leave
- Carry-forward via HR year-start action (not a complex engine)
- HR proxy apply / HR approve when manager missing
- CSV/paste import of working/paid/LOP into a DRAFT run
- Birthdays / work anniversaries on dashboard
- Failed-email retry button
- Employee self-edit of phone/address

### FUTURE (do not implement)

- Monthly leave accrual engine
- Company holiday calendar / biometric sync
- Days-weighted mid-month salary split (Phase 1 uses **structure in force on period end date**)
- `PercentOfGross` components; overtime hours×rate
- Unlocking a LOCKED run
- Multi-entity, multi-currency, tax/TDS engine, PF/ESI statutory logic
- Skip-level / matrix managers
- In-app notification inbox, SMS, WhatsApp
- Advanced leave reports / ageing
- Encashment, sandwich rules, compensatory off

---

## 4. Canonical identifier: `employee_id`

- Spreadsheet column name is always **`employee_id`**.  
- Do not use `emp_id`, `staff_id`, `employee_code`, or `employeeId` in Sheets.  
- UI labels may say “Employee ID”.  
- Format: Settings `employee_id_prefix` + zero-padded number (default `EMP` + 3 digits → `EMP001`).  
- Issued on create, **immutable**, unique.

---

## 5. Canonical states and roles

| Domain | Values |
| --- | --- |
| Employee status | `ACTIVE` \| `INACTIVE` |
| Leave request | `DRAFT` \| `SUBMITTED` \| `APPROVED` \| `REJECTED` \| `CANCELLED` |
| Payroll run | `DRAFT` \| `CALCULATED` \| `UNDER_REVIEW` \| `APPROVED` \| `LOCKED` |
| User role | `ADMIN` \| `HR` \| `MANAGER` \| `EMPLOYEE` |
| Employment type | `PERMANENT` \| `CONTRACT` \| `INTERN` \| `CONSULTANT` |
| Currency | `INR` |

Leave **DRAFT** is SHOULD HAVE. If not built, apply creates `SUBMITTED` directly. Do not invent extra leave or payroll states.

---

## 6. Technology and cost

| Layer | Choice |
| --- | --- |
| App | Apps Script web app |
| Database | One Google Spreadsheet |
| Files | `DriveApp` |
| Email | `MailApp` only |
| Identity | Google account email → `Users` |

Native only: `SpreadsheetApp`, `DriveApp`, `MailApp`, `PropertiesService`, `LockService`, `CacheService`, `Utilities`, time-based triggers.

**No** Advanced Google APIs, Firebase, Supabase, external DB/hosting/auth, `GmailApp` (Phase 1).

Quotas exist (runtime, email, sheet size). Do not claim unlimited or free.

---

## 7. Core principles

1. Server calculates payroll, leave days, balances, and permissions.  
2. Company policy lives in **data** (leave types, component amounts), not coded law.  
3. TDS is an **HR input**. PF/ESI/PT are **configurable amounts/percents** — HR/accounts must review.  
4. Locked payroll and superseded salary structures are **never silently rewritten**.  
5. One primary role per user. Managers do **not** see salary.  
6. Professional HR UI first; Ayurveda is a restrained palette only.

---

## 8. Module relationships

```
Employees (employee_id)
    ├── Users
    ├── LeaveBalances / LeaveRequests
    ├── SalaryStructures / SalaryComponents
    ├── PayrollInputs / PayrollRecords
    ├── Documents (Drive IDs only)
    └── Notifications / AuditLog (employee_id when relevant)

LeaveTypes → LeaveBalances, LeaveRequests
PayrollRuns → PayrollInputs, PayrollRecords
Approved LOP leave → suggestion on unlocked PayrollInputs.lop_days
```

---

## 9. High-level workflows

**Employee:** HR creates → `employee_id` issued → optional Drive folder + user mapping → `ACTIVE`.

**Leave:** Apply → validate → `SUBMITTED` → manager (or HR override) → `APPROVED`/`REJECTED` → balance update → email → if LOP, suggest days on open payroll run.

**Payroll:** Create run `DRAFT` → HR enters inputs → Calculate → `CALCULATED` → `UNDER_REVIEW` → `APPROVED` → `LOCKED` (snapshot + payslips). Correction: **new** run with `correction_of_run_id`.

---

## 10. Drive (simple)

```
HRMS Root
 ├── Employee Documents
 │    └── {employee_id}
 └── Payslips
      └── {year}          e.g. 2026
           └── {month}   e.g. 04-April
```

Files are referenced from `Documents` (`drive_file_id`). No public links. No files stored inside Sheets.

---

## 11. Definition of done (product)

HR can maintain employees, run leave with manager approval, complete one monthly payroll through LOCKED, issue payslips, and use an attention-first dashboard. Employees cannot read another person’s salary or profile. P0 tests in `11_TEST_PLAN.md` pass.

---

## 12. Assumptions

1. Single company, monthly payroll, INR.  
2. Workspace domain Google login.  
3. Leave year starts 1 January unless Settings say otherwise.  
4. Weekends: leave day-count default `WEEKDAYS_ONLY`; **no** holiday calendar in Phase 1.  
5. Structure for a payroll month = structure whose `effective_from` ≤ period end and (`effective_to` empty or ≥ period end) — i.e. **in force on the last day of the month**.
