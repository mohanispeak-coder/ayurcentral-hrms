# Security and Audit

**Document:** `10_SECURITY_AUDIT.md`

---

## 1. Authentication

Google sign-in only. `Users.google_email` must match. `DISABLED` or missing → deny. No passwords in Sheets.

---

## 2. Authorization (authoritative on server)

| Role | Data |
| --- | --- |
| EMPLOYEE | Own personal/employment (no others); own leave; own payslips; own CURRENT structure summary. **No** other salary. |
| MANAGER | Team work directory + team leave approve. **No** salary, bank, PAN, or documents of anyone. |
| HR | HR operational data including salary and payroll. |
| ADMIN | All of HR plus users and admin settings. |

Ignore client-supplied “as” `employee_id` for self-service; use session mapping.

---

## 3. Documents / Drive

- Store IDs in `Documents`; download through the app after RBAC.  
- Do **not** use “anyone with the link” on `HRMS Root`.  
- Managers have no employee-file access.

---

## 4. Spreadsheet limitation

Anyone with **Editor** on the spreadsheet can read salary. Mitigation: owner/robot account only; HR uses the web app; optional sheet protection (owners can still bypass). Treat as trusted-operator storage.

---

## 5. Validation

Whitelist enums (`DRAFT`…`LOCKED`, leave statuses, roles). Non-negative money/days. State machine on server. XSS: escape employee-entered text in HTML.

---

## 6. Audit (lightweight)

Log only: employee create/update/status; leave submit/approve/reject/cancel; salary save/revise; payroll calculate/approve/lock/correct; user/role changes. Summary without PAN/bank. No mass “viewed profile” logs.

---

## 7. Email

Not a confidential channel. Payslip email: “available in HRMS”, not net pay in subject.

---

## 8. Other limits

LockService is not a distributed transaction. Quotas can delay mail. Phase 1 is not zero-trust SaaS.
