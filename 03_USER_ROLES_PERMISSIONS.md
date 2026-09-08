# User Roles and Permissions

**Document:** `03_USER_ROLES_PERMISSIONS.md`  
**Roles:** `ADMIN` \| `HR` \| `MANAGER` \| `EMPLOYEE` (one primary role).  
**Identity:** `Users.google_email` + `employee_id` + `role`.

Team = rows with `manager_employee_id` = the manager’s `employee_id` (direct reports only).

---

## 1. Intent

| Role | Intent |
| --- | --- |
| ADMIN | Configuration, users, all modules, correction runs, settings |
| HR | Employees, leave (company), payroll, documents, notifications |
| MANAGER | Team leave approvals; team directory **without** salary |
| EMPLOYEE | Own profile (permitted), own leave, own payslips |

Unmapped or `DISABLED` users: no access.

**Salary:** MANAGER never sees salary (including team). EMPLOYEE never sees anyone else’s pay. EMPLOYEE may see **own payslips** and a read-only own CURRENT structure on My Profile — not Compensation admin or payroll runs.

---

## 2. Navigation (UI must match; server still authoritative)

| Nav | ADMIN | HR | MANAGER | EMPLOYEE |
| --- | --- | --- | --- | --- |
| Dashboard | Y | Y | Y (team/self) | Y (self) |
| Employees / directory | Y | Y | My Team only | N — **My Profile** instead |
| My Profile | via employee | Y | Y | Y |
| Leave (company) | Y | Y | N | N |
| Leave approvals | Y | Y | Y (team) | N |
| My Leave | Y | Y | Y | Y |
| Payroll | Y | Y | N | N |
| Compensation | Y | Y | N | N |
| My Payslips | Y | Y | Y (own) | Y |
| Notifications log | Y | Y | N | N |
| Settings | Y | read some | N | N |
| Users / roles | Y | N | N | N |

Do not ship hidden nav items “just in case”.

---

## 3. Matrix

Legend: Y / N / Own / Team.

### Employee data

| Action | ADMIN | HR | MANAGER | EMPLOYEE |
| --- | --- | --- | --- | --- |
| Directory (no salary) | Y | Y | Team+Own | N |
| Personal profile | Y | Y | Team work fields only | Own |
| Salary, bank, PAN | Y | Y | N | Own structure + payslips |
| Create / employment edit / status | Y | Y | N | N |
| Change `employee_id` | N | N | N | N |
| Employee documents | Y | Y | N | Own view |
| Self contact edit | Y | Y | Own SHOULD | Own SHOULD |

### Leave

| Action | ADMIN | HR | MANAGER | EMPLOYEE |
| --- | --- | --- | --- | --- |
| Configure types | Y | Y | N | N |
| Apply | Y (audit if for others) | Y proxy + audit | Own | Own |
| Approve/reject SUBMITTED | Y | Y override + audit | Team | N |
| Cancel DRAFT/SUBMITTED | Y | Y | Own | Own |
| Cancel APPROVED | Y | Y | N | N (HR) |
| Calendar | Y all | Y | Team+Own | Own |

### Payroll

| Action | ADMIN | HR | MANAGER | EMPLOYEE |
| --- | --- | --- | --- | --- |
| Structures all / revise | Y | Y | N | Own view CURRENT |
| Run inputs / calculate / review / approve / lock | Y | Y | N | N |
| Correction run | Y | Y | N | N |
| Unlock LOCKED | N (not in Phase 1) | N | N | N |
| Company reports | Y | Y | N | N |
| Own payslip | Y | Y | Own | Own |

---

## 4. Cannot

- **ADMIN:** skip audit; change `employee_id`; mutate LOCKED rows.  
- **HR:** Admin-only settings; see unmapped Google accounts’ Drive.  
- **MANAGER:** any salary/bank/PAN/documents of others; payroll; non-team leave.  
- **EMPLOYEE:** other `employee_id` data; approvals.

---

## 5. Enforcement

UI hides routes. **Every** `google.script.run` equivalent re-checks `role` and `employee_id` scope. Spreadsheet Editor access is **not** the security model (`10`).
