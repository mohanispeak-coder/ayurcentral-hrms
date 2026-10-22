# Live Leave Validation Checklist

**Environment:** Deployed Apps Script web app (new deployment version after latest `clasp push`)  
**Tester:** _______________ **Date:** _______________  
**Spreadsheet / company:** _______________

## Prerequisites (complete before testing)

| Item | Done |
|------|------|
| Latest code pushed (`clasp push`) and web app redeployed | ☐ |
| Settings: `notification_leave` = true | ☐ |
| Settings rows exist (add via DB setup if missing): `leave_decision_notify_employee`, `leave_decision_notify_manager`, `leave_decision_notify_additional_enabled`, `leave_decision_notify_additional_email` | ☐ |
| At least one **active** leave type with known `annual_entitlement_days` (note codes: ________) | ☐ |
| Test employee A: existing, ACTIVE, known joining date, manager assigned | ☐ |
| Test mailboxes you can read (employee / manager / HR / additional) | ☐ |

**How to record:** Fill **ACTUAL RESULT** and set **PASS/FAIL** only after live verification. Leave blank until tested.

---

## 1. Leave balance validation

### 1.1 Baseline — existing employee, current leave year

| TEST ID | ACTION | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---------|--------|-----------------|---------------|-----------|
| LB-01 | As test employee (or HR proxy), open **My Leave**. Select **current leave year** in dropdown. | Year matches org leave year (per `leave_year_start_month`). | | |
| LB-02 | For each **active** configured type (e.g. Casual, Medical, Emergency), check **Entitled**. | Matches `LeaveTypes.annual_entitlement_days` on **LeaveBalances** row (not UI-only). Cross-check **LeaveBalances** sheet: `entitled_days` for that employee + type + year. | | |
| LB-03 | With no prior-year balance / no CF policy, check **Carried**. | 0 (or CF per `carry_forward_max_days` if prior year had unused balance). | | |
| LB-04 | With no submitted/approved leave, check **Used** and **Pending**. | Both 0. | | |
| LB-05 | Type with **Requires balance = Yes**. Check **Available**. | Numeric value = entitled + carried − used − pending (matches sheet `available_days` or same formula). | | |
| LB-06 | Type with **Requires balance = No** (if configured). Check **Available**. | UI shows **n/a** (by design); **Entitled** still shows persisted value from **LeaveBalances**. | | |
| LB-07 | Refresh page / navigate away and back to **My Leave**. | Same numbers (persisted, not lost). | | |

### 1.2 Used / pending after workflow

| TEST ID | ACTION | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---------|--------|-----------------|---------------|-----------|
| LB-08 | Submit a leave request (requires balance) for current year; before approval, open **My Leave**. | **Pending** increases by request days; **Available** decreases accordingly. | | |
| LB-09 | Approve that request; reopen **My Leave**. | **Pending** returns toward 0; **Used** increases; **Available** reflects approval. | | |

### 1.3 Prior leave year (if applicable)

| TEST ID | ACTION | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---------|--------|-----------------|---------------|-----------|
| LB-10 | Select a **prior** leave year in dropdown (employee joined before that year). | Rows appear only where **LeaveBalances** exist; entitled not all zeros unless policy was 0. | | |

---

## 2. New employee validation

| TEST ID | ACTION | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---------|--------|-----------------|---------------|-----------|
| NE-01 | HR creates test employee B (unique ID, ACTIVE, joining date = **current calendar year**, clear test name). | Employee saved. | | |
| NE-02 | Open **My Leave** as B (or HR views profile leave summary). | Current leave year balances appear for active types; **Entitled** = policy days on sheet after grant/sync. | | |
| NE-03 | In **LeaveBalances** sheet, filter `employee_id` = B. | One row per active type per eligible leave year (join year through current year at minimum). | | |
| NE-04 | If join year &lt; current leave year, select prior year in **My Leave**. | Balances present for join year (backfill), not empty unless future joiner. | | |
| NE-05 | **Next/upcoming leave year:** only test if employee is eligible (not future joiner). Change year selector to latest year in list OR wait until org enters new leave year. | If year is in `available_years`, balances exist; no duplicate rows after switching years repeatedly. | | |
| NE-06 | Confirm entitlement source: edit **LeaveTypes** entitlement temporarily (optional, use disposable type). | **Existing** balance rows for closed usage are not rewritten; new/current-year sync rules still apply per product rules. | | |

---

## 3. Leave approval email

| TEST ID | ACTION | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---------|--------|-----------------|---------------|-----------|
| EM-AP-01 | Employee submits leave; HR/Admin **fully approves** (final approval). | Employee receives email (if `leave_decision_notify_employee` = true and `notification_leave` = true). | | |
| EM-AP-02 | Open approval email body. | Contains **Employee Name:** with real name (not `Employee ID: EMP…` as the human identifier). | | |
| EM-AP-03 | Same email. | Contains **Leave Type**, **Leave Dates**, **Number of Days**, **Status: Approved** (or equivalent lines). | | |
| EM-AP-04 | Check **Notifications** sheet (legacy MailApp log) if used. | Row logged; no misleading “Employee ID:” only body. | | |

---

## 4. Leave rejection email

| TEST ID | ACTION | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---------|--------|-----------------|---------------|-----------|
| EM-RJ-01 | Submit another leave; HR/Admin **rejects** with comment. | Employee receives rejection email (settings + org toggle on). | | |
| EM-RJ-02 | Open email. | **Employee Name**, type, dates, days, **Status: Rejected**; comment/reason if provided. | | |

---

## 5. Manager notification

| TEST ID | ACTION | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---------|--------|-----------------|---------------|-----------|
| MG-01 | Use employee with **manager_employee_id** set and manager **work_email** valid. Approve or reject leave. | Manager receives email (`leave_decision_notify_manager` = true). | | |
| MG-02 | Manager email body. | Identifies employee by **name**; includes leave details and status. | | |
| MG-03 | Manager opens **Notifications** in HRMS (if manager has access). | In-app notice for decision (optional; email is primary for this test). | | |

---

## 6. Additional recipient

| TEST ID | ACTION | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---------|--------|-----------------|---------------|-----------|
| AR-01 | In **Settings** sheet: `leave_decision_notify_additional_enabled` = true; `leave_decision_notify_additional_email` = dedicated test inbox (not manager, not employee). | Settings saved; cache refresh (reload app). | | |
| AR-02 | Approve or reject test leave. | Additional inbox receives **one** email with employee **name** and leave details. | | |
| AR-03 | Additional recipient is **not** required to be an HRMS user. | Email still delivered via MailApp. | | |

---

## 7. Recipient deduplication

| TEST ID | ACTION | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---------|--------|-----------------|---------------|-----------|
| DD-01 | Set `leave_decision_notify_additional_email` = **same address as manager work_email**. Approve/reject once. | Only **one** email to that address (not two identical messages in quick succession). | | |
| DD-02 | If employee email equals manager (edge case), approve/reject. | At most one email per unique address. | | |

---

## 8. Security validation

| TEST ID | ACTION | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---------|--------|-----------------|---------------|-----------|
| SEC-01 | In browser DevTools, attempt to call approve/reject RPC with another user’s `leave_request_id` as **Employee** role. | **Authorization error**; no decision email for victim employee. | | |
| SEC-02 | Inspect client payloads for approve/reject (no custom `recipient_email` / `employee_name` fields). | Only `leave_request_id` + comment; recipients not client-controlled. | | |
| SEC-03 | Change displayed name in UI only (if any editable field); approve leave. | Email uses **Employees** sheet `display_name` / first+last, not browser-supplied name. | | |

---

## 9. Regression (automated — run locally / CI)

These were run on _______________ (date); they do **not** replace live checks above.

| TEST ID | ACTION | EXPECTED RESULT | ACTUAL RESULT | PASS/FAIL |
|---------|--------|-----------------|---------------|-----------|
| REG-01 | `node tests/leave-engine.test.js` | All pass | All pass (local run) | PASS* |
| REG-02 | `node tests/leave-lifecycle.test.js` | All pass | All pass (local run) | PASS* |
| REG-03 | `node tests/leave-perf.test.js` | All pass | All pass (local run) | PASS* |
| REG-04 | `node tests/leave-notifications.test.js` | All pass | All pass (local run) | PASS* |
| REG-05 | `node tests/notification-engine.test.js` | All pass | All pass (local run) | PASS* |
| REG-06 | `node tests/integration-shell.test.js` | All pass | All pass (local run) | PASS* |
| REG-07 | `node tests/auth-cross-module.test.js` | All pass | All pass (local run) | PASS* |
| REG-08 | Code review: approve/reject still use `withScriptLock_`; notifications after lock | Unchanged pattern | Not live — spot-check in Apps Script editor | NOT TESTED |

\*Local automated only, not live deployment.

---

## Summary (fill after live run)

| Category | IDs |
|----------|-----|
| **PASS** | |
| **FAIL** | |
| **NOT TESTED** | |
| **REQUIRES CONFIGURATION** | (e.g. missing Settings keys, mail not enabled, no manager email) |
| **CODE ISSUE** | (only if live behavior contradicts expected; file defect note) |

**Sign-off:** Live leave validation complete? ☐ Yes ☐ No — blockers: _______________
