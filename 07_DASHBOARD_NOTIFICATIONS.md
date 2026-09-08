# Dashboard and Notifications

**Document:** `07_DASHBOARD_NOTIFICATIONS.md`

---

## 1. Dashboard (attention first)

**Question:** What needs my attention today?

### HR / ADMIN (MUST)

| Item | Source |
| --- | --- |
| Active employees | `Employees.status = ACTIVE` |
| On leave today | `APPROVED` covering today |
| Pending leave | `SUBMITTED` count |
| Payroll status | Current month `PayrollRuns.status` |
| Payroll exceptions | Flags on current non-LOCKED run (or latest) |
| Alerts | Failed emails; missing structure; missing bank on open run; SUBMITTED with inactive manager |
| Recent activity | Last ~20 AuditLog rows |

**SHOULD:** birthdays / anniversaries (14 days).  
**Not in Phase 1:** charts, attendance KPIs, payroll amount as a vanity chart (a single **net total** for CALCULATED+ is OK for HR only).

### MANAGER

Pending team leave; team on leave today. No payroll amounts.

### EMPLOYEE

Own pending/approved leave; own last payslip period if any.

Quick actions (role-gated): Open approvals; Open payroll; Add employee; Apply leave.

---

## 2. Notifications (simple email)

**Service:** `MailApp` only. No engine, no `GmailApp`.

### MUST events

| event_type | Trigger | Recipient |
| --- | --- | --- |
| LEAVE_SUBMITTED | Status → SUBMITTED | Manager `work_email` |
| LEAVE_APPROVED | Approve | Employee `work_email` |
| LEAVE_REJECTED | Reject | Employee |
| PAYROLL_READY_REVIEW | → UNDER_REVIEW | Users with role HR and ADMIN |
| PAYROLL_APPROVED | → APPROVED | HR + ADMIN |
| PAYSLIP_AVAILABLE | After LOCK, per employee with a record | Employee |

**SHOULD:** reminder for old SUBMITTED (daily trigger).  
**FUTURE:** salary revision mail, in-app inbox.

Templates: Settings strings with `{employee_id}`, `{display_name}`, `{start_date}`, `{period}`. Payslip mail: no net in subject.

### Failure (operational)

1. Write row `PENDING`, send, then `SENT` or `FAILED` + `error_message`.  
2. Do not roll back leave or payroll.  
3. Dashboard shows failed count.  
4. SHOULD: HR retry. Missing email → `FAILED` / `NO_EMAIL`.  
5. Large lock: send payslip emails in a **follow-up trigger** if runtime is tight (`09`).
