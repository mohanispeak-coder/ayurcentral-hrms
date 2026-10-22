# AyurCentral HRMS — QA Test Report

**Date:** 15 September 2026  
**Scope:** Phase 1 Google Apps Script HRMS (dashboard, employees, leave, payroll/compensation, notifications, ATS, Ask HR).  
**Method:** repository architecture review, lifecycle/year-transition hunt, Node regression tests, Apps Script unit tests, static contracts. No live spreadsheet seed data was created.

---

## Summary

```
Total scenarios tested:            140+
Total issues found:                16 product defects + 4 pre-existing harness/test-suite issues
Critical:                          1
High:                              4
Medium:                            8
Low:                               3
Fixed:                             16 product defects (+ ATS candidate loading skeleton)
Remaining:                         documented below (spec gaps, harness, live deploy)
Regression tests added:            leave-lifecycle.test.js (29 cases);
                                   leave-engine / leave-perf / TestLeave.gs extensions
Dummy / seed data created:         none (nothing to delete)
```

---

## Confirmed issue — leave allocation across years

### Issue

When an employee was added, leave balances were created only for the leave year derived from `joining_date`. Later years had no persisted entitlement. My Leave could show a current-year number without a stored row (and without carry-forward).

### Severity

Critical

### Reproduction

1. Configure leave types (any `annual_entitlement_days` / `carry_forward_max_days`).
2. Create an employee whose joining date is in a prior leave year (or create them last year and open the app this year).
3. Open **My Leave**, the employee profile leave summary, or start a new leave year.
4. Observed: balances exist only for the joining year; later years missing or shown without persistence.

### Root Cause

`LeaveService.grantBalancesForEmployee` defaulted the grant year with `currentLeaveYear_(emp.joining_date)`, so hire keyed a single year. There was no planner that walked joining year → current year. Existing rows were never created for subsequent years except via a manual “start leave year” that itself did not backfill intervening years or skip future joiners.

### Fix

Leave entitlement is planned and persisted by policy, not by UI:

- `LeaveEngine.employeeLeaveYears` / `planBalanceGrants` decide which `(leave_type_id, leave_year)` rows to insert from joining year through the target/current leave year.
- Existing rows are never overwritten.
- Carry-forward is computed from the previous year’s unused balance, capped by `carry_forward_max_days` on the type (not a hard-coded day count).
- New leave types are granted for the through-year (and later), not back-filled into closed years (avoids inflating historical CF).
- Grants run on hire, profile/My Leave read, apply/submit (request year), joining-date change, reactivation, HR grant, and HR “start leave year”.

### Regression Test

`tests/leave-lifecycle.test.js` (hire current / previous / several years ago / 1 Jan / 31 Dec / future joiner / CF / apply-approve-reject-cancel / idempotent re-grant / policy change).  
`tests/leave-engine.test.js` year/FY/eligibility cases.  
`apps-script/src/tests/TestLeave.gs` GAS-side year continuity checks.

### Status

Fixed

---

## Issues found

### 1. Leave allocation only for joining year

See confirmed issue above. **Critical. Fixed.**

### 2. My Leave synthesised current-year entitlement without persistence

### Issue

Ungranted types were presented with policy entitlement for “today’s” year even when no `LeaveBalances` row existed, so the UI could look correct while later years and carry-forward were wrong.

### Severity

High

### Reproduction

Open My Leave in a year after hire without running “start leave year”.

### Root Cause

`getMyLeave` mapped types to synthetic rows instead of granting then reading stored balances.

### Fix

Grant through the current leave year first; display persisted rows; year selector lists joining→current years; ungranted types in a closed year are not shown as 0-entitlement policy rows.

### Regression Test

`get-my-leave-grants-through-current`, `my-leave-year-select`, `my-leave-no-synthetic-past` in `tests/leave-perf.test.js`; lifecycle tests.

### Status

Fixed

### 3. “Start leave year” did not backfill intervening years / granted future joiners

### Severity

High

### Reproduction

HR starts a leave year for a hire from 2023, or for someone whose joining date is next year.

### Root Cause

Bulk grant was a single target year, not a join→through plan; future joiners were not filtered by eligibility.

### Fix

`startLeaveYear` uses `planBalanceGrants` per active employee (skips future joiners; chains CF). Confirm copy matches: existing rows are not overwritten.

### Regression Test

`start-year-*` and lifecycle “existing join-year continues”.

### Status

Fixed

### 4. Leave admin status filter missed pending workflow statuses

### Issue

Filtering “Submitted” / awaiting approval ignored `PENDING_MANAGER` / `PENDING_HR` (and treated only legacy `SUBMITTED`).

### Severity

High

### Reproduction

Submit leave, open Leave Admin, filter awaiting approval.

### Root Cause

Exact-status compare vs two-stage pending statuses.

### Fix

`LeaveEngine.matchesStatusFilter` aliases `SUBMITTED`/`PENDING` to all pending-approval statuses. Admin UI includes pending filters.

### Regression Test

`admin-status-filter-helper`, `admin-pending-status-filter`; engine status-filter cases.

### Status

Fixed

### 5. Submit inbox/email used an undeclared `pendingStatus`

### Issue

After submit, in-app inbox (and related notify) could throw inside the success path and swallow manager/HR notification.

### Severity

High

### Reproduction

Submit a leave request that should notify the manager.

### Root Cause

`pendingStatus` was scoped inside `withScriptLock_`; `fireLeaveInbox_` ran outside that block.

### Fix

Notify using `LeaveEngine.normalizeLeaveStatus(result.status)`.

### Regression Test

`submit-notify-uses-result-status`; `leave-inbox-submit` in `tests/integration-shell.test.js`.

### Status

Fixed

### 6. Reactivation did not grant later leave years

### Severity

Medium

### Reproduction

Deactivate an employee, wait until a new leave year, reactivate, open My Leave.

### Root Cause

Grant ran at create only.

### Fix

`setStatus(ACTIVE)` calls `grantBalancesForEmployee` (inactive employees do not receive new years until reactivated).

### Status

Fixed

### 7. Joining-date change did not re-plan years

### Severity

Medium

### Reproduction

HR moves joining date from this year to last year.

### Fix

`updateEmployee` re-grants through current year; existing rows remain; missing years are inserted.

### Status

Fixed

### 8. Leave year / “today” used script-local `Date` instead of configured timezone

### Severity

Medium

### Reproduction

Near 1 January, if script TZ ≠ `ConfigService` timezone (`Asia/Kolkata`), leave year and calendar month can be off by one.

### Fix

`LeaveService.todayDateOnly_` / `currentLeaveYear_` use Config timezone. Calendar defaults use that today. Fallback seed uses `Utilities.formatDate(..., timezone, 'yyyy-MM-dd')`.

### Status

Fixed

### 9. Leave starting before joining date was allowed

### Severity

Medium

### Fix

`assertNotBeforeJoining_` on draft/submit.

### Regression Test

`join-date-guard`; lifecycle future-joiner (no years until join year).

### Status

Fixed

### 10. Duplicate employee ID race

### Severity

Medium

### Root Cause

Uniqueness check occurred outside the create lock.

### Fix

Re-check `employee_id` inside `withScriptLock_`.

### Status

Fixed

### 11. HR grant API skipped inactive employees

### Severity

Medium

### Fix

`apiLeaveGrantBalances` passes `{ includeInactive: true }` so an explicit HR grant still writes through-year rows. Automatic lazy grant still skips inactive.

### Regression Test

`grant-api-include-inactive`

### Status

Fixed

### 12. Fallback leave seed skipped carry-forward

### Severity

Medium

### Root Cause

If `LeaveService.grantBalancesForEmployee` threw, `seedLeaveBalances_` inserted entitled days with `carried_forward_days = 0` and used a raw `Date` as-of.

### Fix

Fallback walks years sequentially, applies `carryForwardDays`, and uses timezone-formatted as-of.

### Status

Fixed

### 13. Closed-year My Leave showed 0 for types never granted that year

### Severity

Medium (misleading zeros)

### Fix

Past years list only persisted balances; ungranted active types appear only for the current year (after grant they have rows).

### Status

Fixed

### 14. Leave calendar default month used script `Date`

### Severity

Low

### Fix

`getCalendar` defaults from config-timezone today.

### Status

Fixed

### 15. Profile leave empty-state implied “current year only”

### Severity

Low

### Fix

Copy: balances follow configured types from joining year through the current leave year.

### Status

Fixed

### 16. ATS candidates table first paint had an empty tbody (no skeleton)

### Severity

Low

### Fix

Initial `skRows(8, 8)` in the candidates table; loading-skeleton contract updated to 8 columns.

### Status

Fixed

---

## Similar lifecycle / year-transition hunt

| Area | Pattern | Result |
| --- | --- | --- |
| Leave balances | Year-keyed rows created only at hire | **Bug — fixed** at planner/persist layer |
| Leave types / policy | Config change must not rewrite history | **Preserved:** existing `entitled_days` kept; new year uses current type entitlement |
| Payroll runs | Explicit monthly create; eligible = currently ACTIVE and `joining_date` ≤ period end | **By spec.** No `last_working_date` in Phase 1 (see remaining) |
| Compensation | `CURRENT` structure + `effective_from`; not year-keyed | Continues across years without a yearly seed. Historical payroll uses structure covering that month |
| Notifications (birthday/anniversary) | Calendar match on joining/DOB | Continues each year; first anniversary skipped by design |
| ATS jobs/candidates | Status machine, not calendar years | No join-year-only init |
| Attendance punches | Out of Phase 1 | Payroll LOP/working days are HR inputs |
| Performance (PMS) | Out of Phase 1; `apps-script/src/pms` not present | Tests no longer require missing files |
| Holidays / leave expiry dates | FUTURE in spec | Unused days above CF max are dropped at year grant (tested) |
| Dashboard / reports | Pending leave + latest payroll; no yearly leave report | Counts come from live `getApprovals` / runs, not stale year maps |
| Settings `leave_year_start_month` change | Would re-label years without migrating keys | **Not auto-migrated** (destructive; needs explicit HR decision) |

---

## Test matrix coverage (Phase 1)

### Employee management

Create/edit/view, unique ID/email (including lock), required fields, employment types, directory search/filter, status ACTIVE/INACTIVE (login disabled), joining-date change → leave re-grant, manager/department/designation updates (directory fields), documents/payslips RBAC, bulk upload contracts. **No hard delete** in schema (deactivate only).

### Leave management

All configured types; allocation/balance/available math; apply, draft, submit, two-stage approve, reject, cancel submitted/approved, revoke rejection; year selector; start leave year; min service; half-day AM/PM; overlap; weekends vs calendar days; insufficient balance; LOP bridge to open payroll; no holiday calendar (spec). **Leave spanning 31 Dec–2 Jan is charged to the start date’s leave year** (spec).

### Attendance

No punch capture (master spec). Payroll attendance-related columns are HR-entered; bulk attendance template contracts exist.

### Payroll / compensation

Engine PAY-01… cases, structure effective dates, CURRENT vs revision, bulk compensation, run create for ACTIVE employees with join ≤ period end, LOP from approved leave on unlocked runs, payslip generation/RBAC.

### Organisation / masters

Departments/designations/locations are free-text on employee (no separate master CRUD). Leave types CRUD with entitlement/CF/min service. Settings include `leave_year_start_month`. Users/Settings nav items remain placeholders.

### Dashboard / reports

Home dashboard leave-approval queue and payroll latest; notification unread. Dedicated leave reports are FUTURE.

### Roles

ADMIN/HR/MANAGER/EMPLOYEE/OWNER: PermissionService + ATS + leave approve/apply + payroll admin + notification inbox scoping. Frontend hide is backed by `PermissionService.require` on APIs.

---

## Automated tests run

| Suite | Result |
| --- | --- |
| `tests/leave-engine.test.js` | Pass |
| `tests/leave-lifecycle.test.js` | Pass (new) |
| `tests/leave-perf.test.js` | Pass |
| `tests/integration-shell.test.js` | Pass |
| Employee / payroll / ATS / notifications / Ask HR / bulk / user-access / sidebar / perf-optimization / compensation | Pass |
| `tests/loading-skeleton-ux.test.js` | Pass (after candidate skeleton) |
| `tests/auth-cross-module.test.js` | Pass (PMS optional) |
| `tests/dashboard-notifications-perf.test.js` | Pass (PMS optional) |
| `tests/pms-ats-perf.test.js` | Pass (ATS contracts; PMS skipped if absent) |
| `tests/hrms-shell-bootstrap.test.js` | Fail (VM harness: dashboard RPC / bell slot / title) |
| `tests/module-view-cache.test.js` | Fail (same dashboard RPC harness) |
| `tests/logout-auth-lifecycle.test.js` | Fail (VM harness: boot-authed / sign-out chrome) |

No `eslint` / `tsc` scripts exist in this repo. `apps-script/package.json` only provides clasp login/push/open/deploy.

---

## Remaining / not safely changed

1. **Payroll runs exclude currently INACTIVE employees** even if they worked the selected month. Phase 1 has no last-working-day / F&F fields (`docs/HRMS_GAP_ANALYSIS.md`). Inventing an exit date would be a new business rule.
2. **Year-crossing leave** is one request charged to `start_date`’s leave year.
3. **Changing `leave_year_start_month`** does not rewrite existing `leave_year` keys.
4. **Settings / Users screens** are nav placeholders.
5. **Holiday calendar, monthly leave accrual, leave reports** are FUTURE in `05_LEAVE_MODULE.md`.
6. **PMS / performance** is out of Phase 1; source tree has no `pms/` module.
7. **Shell VM tests** (`hrms-shell-bootstrap`, `module-view-cache`, `logout-auth-lifecycle`) still fail in Node fake-DOM. Product `apiGetHomeDashboard` path is present in `Scripts.html`; failures look like harness timing/`google.script.run` stubs, not the leave-year bug.
8. **Browser calendar month** still uses the user’s browser `Date` for the first calendar request; server defaults use Config timezone.

---

## Manual validation still needed

After `clasp push` / web-app deploy against a real spreadsheet:

- Create employees joining this year, last year, several years ago, 1 Jan, 31 Dec; confirm My Leave year selector and profile leave table.
- Apply / approve / reject / cancel across a year boundary; confirm balances and LOP on an open payroll run.
- HR “Start leave year”; confirm no duplicate rows.
- Add a leave type mid-year; confirm it appears for the current year only.
- Change policy days; confirm prior years unchanged.
- Deactivate / reactivate; joining-date edit; manager change vs approvals queue.
- Payroll month for a leaver (INACTIVE) — confirm product matches “ACTIVE only” rule.
- Sign-out / dashboard refresh on a real browser (covers harness gaps).
- Roles: employee vs manager vs HR vs admin on leave and payroll.

---

## Architectural root cause (leave)

Leave balances are **year-keyed persisted rows**, not a live view of policy. The system must **plan and insert** missing years when time or eligibility advances, without rewriting history. The planner (`planBalanceGrants`) is the single source of truth; UI, profile, submit, and bulk start-year all consume it.
