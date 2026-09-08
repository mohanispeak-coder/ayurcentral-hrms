# Build Plan

**Document:** `12_BUILD_PLAN.md`  
Implementation is a **later** phase. This plan is for Cursor agents.

---

## 1. Dependency order (do not skip)

```
Foundation (shell, services layout, identity stub)
    → Database (headers + seed Settings/Users)
        → Authentication / Authorization
            → Employee
                → Leave
                    → Payroll + Compensation
                        → Dashboard
                            → Notifications
                                → Integration
                                    → Testing
                                        → UI polish
                                            → Deployment
```

Notifications may start as a **stub** (write sheet, skip MailApp) once Leave exists, but MUST events must work before Testing.

---

## 2. Agent contracts

Each agent owns listed concerns. **Do not** edit another agent’s service files except via agreed sheet contracts in `02`.

### Foundation Agent

**Owns:** Apps Script project layout, `appsscript.json` scopes, web app bootstrap, ConfigService, AuthZ helpers, AuditService, sheet repository helpers, Lock/Cache wrappers.  
**May modify:** Shared bootstrap, Settings access, Users lookup.  
**Must not:** Employee/Leave/Payroll business rules; payroll formulas.  
**Depends on:** Nothing.  
**Contract:** Session email → Users; `employee_id` on session; forbidden/validation error shape.

### Employee Agent

**Owns:** Employees CRUD, directory, profile, documents metadata, employee Drive folder.  
**May modify:** Employees, Documents (EMPLOYEE_FILE), Users create-on-hire.  
**Must not:** LeaveRequests, Payroll* sheets, payroll UI.  
**Depends on:** Foundation + Database.  
**Contract:** `Employees.employee_id`, `work_email` unique, `status` ACTIVE/INACTIVE.

### Leave Agent

**Owns:** LeaveTypes, LeaveBalances, LeaveRequests, apply/approve math, LOP suggestion **reader** that payroll can call (`lop_from_leave` numbers only).  
**May modify:** Leave* sheets.  
**Must not:** Rewrite PayrollRecords; change salary components.  
**Depends on:** Employee (`employee_id`, manager, joining_date).  
**Contract:** statuses DRAFT/SUBMITTED/APPROVED/REJECTED/CANCELLED; `counts_as_lop`.

### Payroll Agent

**Owns:** SalaryStructures/Components, PayrollRuns/Inputs/Records, PayrollEngine, lock + payslip file create, correction runs.  
**May modify:** Payroll* and salary sheets; Documents PAYSLIP.  
**Must not:** Change leave approval rules; change AuthZ matrix.  
**Depends on:** Employee; Leave LOP helper.  
**Contract:** states DRAFT…LOCKED; INR; snapshot columns; never update LOCKED rows.

### UI Agent

**Owns:** Design tokens, sidebar/header, shared table/form/badge CSS, screen shells.  
**May modify:** Shared HTML/CSS; layout of pages **without** changing server contracts.  
**Must not:** PayrollEngine; AuthZ.  
**Depends on:** Nav list in `03`/`08`.  
**Contract:** Same badges/states; field name `employee_id` in APIs.

**Do not** run Foundation and Payroll in parallel on the same bootstrap files. After AuthZ is merged, Employee ∥ UI shells; Leave after Employee contract is stable; Payroll after Leave LOP helper exists (or Payroll mocks LOP=0 until helper lands — prefer sequential Leave then Payroll).

**Safe parallel:** UI tokens ∥ Employee **after** AuthZ; Notifications stub ∥ Dashboard **after** Employee+Leave reads exist.

---

## 3. Stages

| Stage | Objective | Depends | Later files (indicative) | Done |
| --- | --- | --- | --- | --- |
| 1 Foundation | Web app shell | — | Bootstrap, Index | Loads |
| 2 Database | Headers + seed | 1 | SchemaBootstrap | Matches `02` |
| 3 AuthZ | Users + matrix | 2 | Auth | SEC-05/06 |
| 4 Employee | Master | 3 | EmployeeService | EMP P0 |
| 5 Leave | Workflow | 4 | LeaveService | LV P0 |
| 6 Payroll + compensation | Engine + lock | 4–5 | PayrollEngine | PAY P0 except notify |
| 7 Dashboard | Attention | 4–6 | DashboardService | Attention widgets |
| 8 Notifications | MailApp | 5–6 | NotificationService | NOT P0 |
| 9 Integration | LOP, lock, Drive | 4–8 | glue | Month close path |
| 10 Testing | `11` P0 | 9 | fixtures | P0 pass |
| 11 UI polish | `08` | Screens exist | CSS | Coherent UI |
| 12 Deployment | Domain, sharing, triggers | 10 | runbook | Operators can use |

---

## 4. Parallelism warning

Do **not** assign two agents to Auth, schema headers, or PayrollEngine at once. Schema column names are frozen in `02`; adding a column requires updating `02` first, then all agents.
