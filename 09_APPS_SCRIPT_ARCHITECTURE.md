# Apps Script Architecture (future implementation)

**Document:** `09_APPS_SCRIPT_ARCHITECTURE.md`  
Do not implement in this phase. **No Advanced APIs** in Phase 1 (none justified).

---

## 1. Separation

HTML/CSS/JS: display and collect. Apps Script: identity, RBAC, validation, leave math, payroll math, Drive, MailApp.

Never trust client `role`, `employee_id`, or `net_pay`.

---

## 2. Native services

| Service | Use |
| --- | --- |
| SpreadsheetApp | All data |
| DriveApp | Folders and files |
| MailApp | All email |
| PropertiesService | Spreadsheet ID, drive root |
| LockService | ID sequence; leave balance transitions; payroll calculate / approve / lock |
| CacheService | Settings, dashboard KPIs (short TTL) |
| Utilities | JSON, dates |
| Time-driven triggers | Optional leave reminder; payslip email continuation |

**Not used:** GmailApp, Advanced Drive/Sheets/Gmail/Calendar, Firebase, Supabase, MySQL, external auth/hosting/APIs.

Payslips: HTML blob via DriveApp is enough. Do not add Drive conversion API unless HTML proves insufficient (then document why).

---

## 3. Layers (ownership for later agents)

```
UI templates
  → thin API (session email, parse)
      → AuthZ (Users.role + employee_id scope)
        → EmployeeService | LeaveService | PayrollEngine + PayrollService | CompensationService
           NotificationService | DocumentService | AuditService | ConfigService
          → sheet repositories
```

PayrollEngine: pure functions (structure + inputs + settings → record). No spreadsheet I/O inside formula functions.

---

## 4. Practical limitations (realistic, not blocking)

| Topic | Design response |
| --- | --- |
| ~6 min execution | Calculate in one lock; if many employees, continue with a trigger cursor. Payslip+email after LOCK may be a second job. |
| Email quota | MUST events only; Workspace quota >> consumer; document for operators |
| Concurrent HR | LockService on critical sections; fail with “try again” |
| Sheets scale | Fine for small/medium (hundreds–low thousands of employees). Batch get/set; avoid per-cell writes. Index in memory per request. |
| Drive | App-mediated; no public links; sharing locked to owner |
| Cache | Not a source of truth |

---

## 5. Concurrency (document only)

| Operation | Risk | Safeguard |
| --- | --- | --- |
| employee_id allocate | Duplicate IDs | Script lock |
| Leave approve / balance | Double approve / wrong pending | Lock per request or script lock |
| Payroll calculate / lock | Partial writes | Script lock; write records then set status |
| Employee profile edit | Lost update | Accept last write in Phase 1 |
| Two payroll DRAFT for same month | Duplicate runs | Unique check under lock |

Not a full DB transaction. Order: **commit business rows, then notify**.

---

## 6. Sheets and Drive

One spreadsheet; row 1 headers matching `02`. Batch I/O. Payroll stored as values, not live sheet formulas.

Drive tree in `00`. Create month folder on first payslip.

---

## 7. Identity

`Session.getActiveUser().getEmail()` lowercase → Users. Empty email → deny. Prefer web app available to domain users with a reliable identity. Decide execute-as at deploy; identity must still map to Users.

---

## 8. Errors

Validation vs forbidden vs conflict (LOCKED) vs lock timeout. Logger: `employee_id` + action, never PAN/bank/full payslip.
