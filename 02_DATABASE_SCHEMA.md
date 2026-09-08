# Database Schema (Google Sheets)

**Document:** `02_DATABASE_SCHEMA.md`  
**Store:** One spreadsheet (ID in `PropertiesService`). Do not create it in this phase.

**Column naming:** `snake_case`. Person key is always **`employee_id`**.

**Dropped vs Round 1:** No `Roles` sheet (role is an enum on `Users`). No `LeavePolicies` sheet (fields live on `LeaveTypes`). No `CompensationHistory` sheet (revision fields live on `SalaryStructures`).

---

## 1. Relationships

```
Users.employee_id → Employees.employee_id
Employees.manager_employee_id → Employees.employee_id

LeaveTypes 1──* LeaveBalances, LeaveRequests
Employees 1──* LeaveBalances, LeaveRequests, SalaryStructures,
              PayrollInputs, PayrollRecords, Documents, Notifications

SalaryStructures 1──* SalaryComponents
SalaryStructures.previous_structure_id → SalaryStructures.salary_structure_id

PayrollRuns 1──* PayrollInputs, PayrollRecords
PayrollRuns.correction_of_run_id → PayrollRuns.payroll_run_id

Settings: key-value
AuditLog: employee_id optional (affected person)
```

---

## 2. Employees

**Purpose:** Employee master (personal + employment + payroll identifiers). Documents are Drive references, not blobs.  
**PK:** `employee_id`  
**FK:** `manager_employee_id` → `Employees.employee_id`

| Column | Type | Required | Validation | Group |
| --- | --- | --- | --- | --- |
| employee_id | String | Y | Unique, immutable, prefix+digits | Employment |
| first_name | String | Y | Max 80 | Personal |
| last_name | String | Y | Max 80 | Personal |
| display_name | String | Y | | Personal |
| date_of_birth | Date | N | SHOULD | Personal |
| gender | String | N | SHOULD; free or list | Personal |
| phone | String | N | | Personal |
| address | String | N | Single text field | Personal |
| work_email | String | Y | Unique, valid email | Employment |
| department | String | Y | | Employment |
| designation | String | Y | | Employment |
| manager_employee_id | String | N | Exists, not self | Employment |
| joining_date | Date | Y | | Employment |
| employment_type | String | Y | PERMANENT \| CONTRACT \| INTERN \| CONSULTANT | Employment |
| location | String | Y | | Employment |
| status | String | Y | ACTIVE \| INACTIVE | Employment |
| pan | String | N | Sensitive; format advisory | Payroll |
| bank_account_name | String | N | | Payroll |
| bank_account_number | String | N | Sensitive | Payroll |
| bank_ifsc | String | N | With account number, both or neither | Payroll |
| bank_name | String | N | | Payroll |
| notes | String | N | HR only | Employment |
| created_at | Datetime | Y | | |
| created_by_email | String | Y | | |
| updated_at | Datetime | Y | | |
| updated_by_email | String | Y | | |

**Not collected in Phase 1:** Aadhaar, family details, blood group, personal email, split city/PIN, emergency contact (FUTURE/SHOULD — omit from MUST).

---

## 3. Users

**Purpose:** Google identity → `employee_id` + role.  
**PK:** `google_email` (lowercase)

| Column | Type | Required | Validation |
| --- | --- | --- | --- |
| google_email | String | Y | Unique, lowercase |
| employee_id | String | Y | FK Employees |
| role | String | Y | ADMIN \| HR \| MANAGER \| EMPLOYEE |
| status | String | Y | ACTIVE \| DISABLED |
| created_at | Datetime | Y | |
| updated_at | Datetime | Y | |

---

## 4. LeaveTypes

**Purpose:** Configurable leave kinds **and** simple entitlement (replaces LeavePolicies).  
**PK:** `leave_type_id`

| Column | Type | Required | Validation |
| --- | --- | --- | --- |
| leave_type_id | String | Y | e.g. LT001 |
| code | String | Y | Unique; e.g. CL, LOP |
| name | String | Y | |
| is_paid | Boolean | Y | |
| requires_balance | Boolean | Y | |
| allow_half_day | Boolean | Y | |
| counts_as_lop | Boolean | Y | |
| annual_entitlement_days | Number | Y | ≥ 0; grant at year start / employee create |
| carry_forward_max_days | Number | Y | ≥ 0; 0 = none |
| max_consecutive_days | Number | N | |
| min_service_days | Number | Y | ≥ 0 |
| is_active | Boolean | Y | |
| sort_order | Number | Y | |

No per-employment-type policies in Phase 1 (FUTURE).

---

## 5. LeaveBalances

**Purpose:** Per employee, type, leave year.  
**PK:** `leave_balance_id`  
**Unique:** `employee_id` + `leave_type_id` + `leave_year`  
**FKs:** `employee_id`, `leave_type_id`

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| leave_balance_id | String | Y | |
| employee_id | String | Y | |
| leave_type_id | String | Y | |
| leave_year | String | Y | e.g. 2026 |
| entitled_days | Number | Y | From type at grant |
| used_days | Number | Y | Approved usage |
| pending_days | Number | Y | SUBMITTED only |
| carried_forward_days | Number | Y | |
| available_days | Number | Y | entitled + CF − used − pending (recompute on write) |
| updated_at | Datetime | Y | |

---

## 6. LeaveRequests

**Purpose:** Leave applications.  
**PK:** `leave_request_id`  
**FKs:** `employee_id`, `leave_type_id`, `approver_employee_id`

| Column | Type | Required | Validation |
| --- | --- | --- | --- |
| leave_request_id | String | Y | |
| employee_id | String | Y | |
| leave_type_id | String | Y | |
| start_date | Date | Y | |
| end_date | Date | Y | ≥ start |
| is_half_day | Boolean | Y | |
| half_day_session | String | N | AM \| PM |
| total_days | Number | Y | Server-calculated |
| status | String | Y | DRAFT \| SUBMITTED \| APPROVED \| REJECTED \| CANCELLED |
| reason | String | Y | Required on SUBMITTED |
| approver_employee_id | String | N | |
| decision_at | Datetime | N | |
| decision_comment | String | N | |
| submitted_at | Datetime | N | Set on submit |
| cancelled_at | Datetime | N | |
| created_at | Datetime | Y | |

---

## 7. SalaryStructures

**Purpose:** Contractual structure **and** compensation history. Never edit amounts on a row after it is superseded or used in a LOCKED payroll.  
**PK:** `salary_structure_id`  
**FKs:** `employee_id`, `previous_structure_id`

| Column | Type | Required | Validation |
| --- | --- | --- | --- |
| salary_structure_id | String | Y | |
| employee_id | String | Y | |
| effective_from | Date | Y | |
| effective_to | Date | N | Null = current open-ended |
| status | String | Y | CURRENT \| SUPERSEDED |
| ctc_monthly | Number | N | Optional INR |
| currency | String | Y | INR |
| previous_structure_id | String | N | Prior CURRENT row |
| revision_reason | String | N | Required on revision |
| approved_by_email | String | Y | Who saved/approved the structure |
| created_at | Datetime | Y | |
| created_by_email | String | Y | |

Payroll for a month uses the structure **in force on the period end date** (see `06`).

---

## 8. SalaryComponents

**Purpose:** Lines on one structure.  
**PK:** `salary_component_id`  
**FK:** `salary_structure_id`

| Column | Type | Required | Validation |
| --- | --- | --- | --- |
| salary_component_id | String | Y | |
| salary_structure_id | String | Y | |
| component_code | String | Y | BASIC, HRA, SA, OTHER_EARN, PF, ESI, PT, OTHER_DED, EMPLOYER_PF, … |
| component_name | String | Y | |
| component_kind | String | Y | EARNING \| DEDUCTION \| EMPLOYER |
| calc_method | String | Y | FIXED \| PERCENT_OF_BASIC |
| amount | Number | N | FIXED, INR |
| percent | Number | N | PERCENT_OF_BASIC |
| sort_order | Number | Y | |

TDS is **not** a structure formula; it is `PayrollInputs.tds_amount`.

---

## 9. PayrollRuns

**Purpose:** One company cycle (or a correction run).  
**PK:** `payroll_run_id`

| Column | Type | Required | Validation |
| --- | --- | --- | --- |
| payroll_run_id | String | Y | e.g. PR-2026-04 |
| period_year | Number | Y | |
| period_month | Number | Y | 1–12 |
| status | String | Y | DRAFT \| CALCULATED \| UNDER_REVIEW \| APPROVED \| LOCKED |
| working_days_default | Number | Y | Snapshot from Settings at create |
| currency | String | Y | INR |
| calculated_at | Datetime | N | |
| approved_at | Datetime | N | |
| approved_by_email | String | N | |
| locked_at | Datetime | N | |
| locked_by_email | String | N | |
| correction_of_run_id | String | N | FK PayrollRuns |
| notes | String | N | |
| created_at | Datetime | Y | |
| created_by_email | String | Y | |

At most one **non-LOCKED** run per year+month (a correction run may exist while the original is LOCKED).

---

## 10. PayrollInputs

**Purpose:** Month-specific HR inputs (not net pay).  
**PK:** `payroll_input_id`  
**Unique:** `payroll_run_id` + `employee_id`

| Column | Type | Required | Validation |
| --- | --- | --- | --- |
| payroll_input_id | String | Y | |
| payroll_run_id | String | Y | |
| employee_id | String | Y | |
| working_days | Number | Y | > 0 |
| paid_days | Number | Y | ≥ 0 |
| lop_days | Number | Y | ≥ 0 |
| bonus | Number | Y | ≥ 0 INR |
| incentive | Number | Y | ≥ 0 |
| other_earnings | Number | Y | ≥ 0 (includes OT if any) |
| other_deductions | Number | Y | ≥ 0 |
| tds_amount | Number | Y | ≥ 0; HR/accounts input |
| lop_from_leave | Number | N | Suggestion; HR may override lop_days |
| remarks | String | N | |

---

## 11. PayrollRecords

**Purpose:** Calculated **snapshot**. After LOCKED, never update. Stores the values **used**, not live lookups.  
**PK:** `payroll_record_id`

| Column | Type | Required | Description |
| --- | --- | --- | --- |
| payroll_record_id | String | Y | |
| payroll_run_id | String | Y | |
| employee_id | String | Y | |
| salary_structure_id | String | N | Structure used; empty if missing |
| working_days | Number | Y | Copied from inputs at calculate |
| paid_days | Number | Y | Snapshot |
| lop_days | Number | Y | Snapshot |
| bonus | Number | Y | Snapshot |
| incentive | Number | Y | Snapshot |
| other_earnings | Number | Y | Snapshot |
| other_deductions | Number | Y | Snapshot |
| tds_amount | Number | Y | Snapshot |
| gross_earnings | Number | Y | |
| total_deductions | Number | Y | |
| net_pay | Number | Y | |
| employer_contributions | Number | Y | Informational |
| component_breakdown | String | Y | JSON text of line amounts (data, not code) |
| exception_flags | String | N | e.g. MISSING_STRUCTURE;MISSING_BANK |
| payslip_document_id | String | N | FK Documents |
| calculated_at | Datetime | Y | |

---

## 12. Notifications

**Purpose:** Simple email log.  
**PK:** `notification_id`

| Column | Type | Required |
| --- | --- | --- |
| notification_id | String | Y |
| event_type | String | Y |
| recipient_email | String | Y |
| employee_id | String | N |
| subject | String | Y |
| status | String | Y PENDING \| SENT \| FAILED |
| error_message | String | N |
| related_entity_type | String | N |
| related_entity_id | String | N |
| created_at | Datetime | Y |
| sent_at | Datetime | N |

Channel is always email. No template engine table.

---

## 13. AuditLog

**Purpose:** Lightweight important actions only. No before/after JSON in Phase 1.  
**PK:** `audit_id`

| Column | Type | Required |
| --- | --- | --- |
| audit_id | String | Y |
| at | Datetime | Y |
| actor_email | String | Y |
| actor_employee_id | String | N |
| action | String | Y |
| entity_type | String | Y |
| entity_id | String | Y |
| employee_id | String | N Affected person |
| summary | String | Y No PAN/bank |

---

## 14. Settings

**PK:** `setting_key`

| Column | Type | Required |
| --- | --- | --- |
| setting_key | String | Y |
| setting_value | String | Y |
| value_type | String | Y STRING \| NUMBER \| BOOLEAN |
| description | String | Y |
| admin_only | Boolean | Y |
| updated_at | Datetime | Y |
| updated_by_email | String | Y |

**Minimum keys:** `company_name`, `employee_id_prefix`, `employee_id_pad`, `seq_employee`, `leave_year_start_month`, `leave_count_method`, `default_working_days`, `payroll_round` (`PAISE_2` \| `NEAREST_RUPEE`), `block_lock_missing_structure`, `block_lock_missing_bank`, `allow_lock_negative_net` (false), `notification_leave`, `notification_payroll`, `drive_root_folder_id`, `timezone`.

---

## 15. Documents

**Purpose:** Drive metadata only.  
**PK:** `document_id`  
**FK:** `employee_id`

| Column | Type | Required |
| --- | --- | --- |
| document_id | String | Y |
| employee_id | String | Y |
| category | String | Y EMPLOYEE_FILE \| PAYSLIP |
| title | String | Y |
| drive_file_id | String | Y |
| drive_folder_id | String | Y |
| payroll_run_id | String | N |
| uploaded_at | Datetime | Y |
| uploaded_by_email | String | Y |

---

## 16. ID sequences

Counters in Settings (`seq_employee`, `seq_leave_request`, …). No extra Sequences sheet.

---

## 17. Why these sheets

| Sheet | Keep? |
| --- | --- |
| Employees, Users | MUST |
| LeaveTypes, LeaveBalances, LeaveRequests | MUST |
| SalaryStructures, SalaryComponents | MUST (history + lines) |
| PayrollRuns, PayrollInputs, PayrollRecords | MUST (A/B/C-D/E) |
| Notifications, AuditLog, Settings, Documents | MUST |

**Not separate sheets:** Roles, LeavePolicies, CompensationHistory, Holidays, Attendance.
