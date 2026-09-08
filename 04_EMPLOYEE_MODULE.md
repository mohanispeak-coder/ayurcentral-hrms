# Employee Management Specification

**Document:** `04_EMPLOYEE_MODULE.md`  
**Key:** `employee_id`

---

## 1. Purpose

Single employee master. All other modules join on `employee_id`.

---

## 2. Data groups

### Personal

`first_name`, `last_name`, `display_name`, `date_of_birth` (optional), `gender` (optional), `phone`, `address`.

### Employment

`employee_id`, `work_email`, `department`, `designation`, `manager_employee_id`, `joining_date`, `employment_type`, `location`, `status`, `notes`.

### Payroll identifiers (not the structure amounts)

`pan`, `bank_*`. Structure lines live in `SalaryStructures` / `SalaryComponents` (Compensation screens).

### Documents

`Documents` rows → `drive_file_id` only.

---

## 3. Screens (this module)

| Screen | User | Purpose | Actions | Data |
| --- | --- | --- | --- | --- |
| Employee Directory | HR, ADMIN | Find people | Search, filter, Add, open row | ID, name, dept, designation, location, type, status, manager — no salary |
| My Team | MANAGER | Team list | Open work profile | Same columns, scoped |
| Employee Create | HR, ADMIN | New master | Save | Personal + employment; payroll IDs optional |
| Employee Profile | Per `03` | View/edit | Save, deactivate, upload | Tabs: Personal, Employment, Payroll IDs, Leave summary, Documents, Payslips (own/HR) |
| Deactivate confirm | HR, ADMIN | Status | Confirm | |

Full Phase 1 screen catalogue: `08_UI_DESIGN_SYSTEM.md`.

---

## 4. `employee_id` rules

- `{employee_id_prefix}` + pad (`EMP` + `001`).  
- Allocate under `LockService`.  
- Immutable and unique. UI label “Employee ID”; field `employee_id`.

---

## 5. Create / edit / status

**Create:** validate → next `employee_id` → insert Employees → seed `LeaveBalances` for active types (entitled = `annual_entitlement_days`) → optional Users row `EMPLOYEE` → optional Drive folder `Employee Documents/{employee_id}` → audit `EMPLOYEE_CREATE`.

**Edit:** cannot change `employee_id`. `work_email` unique; if Users exist, keep emails in sync. Self: phone/address only (SHOULD).

**Status:** `ACTIVE` \| `INACTIVE`. Inactive: Users `DISABLED`; cannot submit new leave; omitted from **new** payroll DRAFT. Existing SUBMITTED leave stays until decided. LOCKED payroll unchanged.

---

## 6. Validation

| Rule | Result |
| --- | --- |
| Required names, work_email, department, designation, joining_date, type, location | Field error |
| Duplicate work_email | Block |
| manager_employee_id = self | Block |
| Inactive manager | Warn, allow |
| Bank number without IFSC | Block |
| PAN if present | Advisory format |

---

## 7. Permissions and audit

Per `03`. Never return salary/bank/PAN to MANAGER or to another EMPLOYEE.

Audit: `EMPLOYEE_CREATE`, `EMPLOYEE_UPDATE`, `EMPLOYEE_STATUS`, `DOCUMENT_UPLOAD`. Summary without full account/PAN.

---

## 8. Concurrency

Create ID allocation and email uniqueness: `LockService`. Two HR editors last-write-wins on other fields; `updated_at` displayed. Do not require row versioning in Phase 1.
