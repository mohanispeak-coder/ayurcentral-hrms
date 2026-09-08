# Leave Management Specification

**Document:** `05_LEAVE_MODULE.md`  
Leave types are **configurable**. Do not hard-code company policy names or days.

---

## 1. Canonical workflow

```
Employee (or HR proxy)
  → Apply (optional DRAFT)
  → Validation
  → SUBMITTED
  → Manager review (or HR override)
  → APPROVED or REJECTED
  → Balance update
  → MailApp notification
  → If counts_as_lop: refresh lop_from_leave on open (not LOCKED) payroll run
```

Employees cannot approve their own leave.

---

## 2. States

| Status | Meaning |
| --- | --- |
| `DRAFT` | SHOULD: saved, not in pending queue, no pending_days |
| `SUBMITTED` | Awaiting manager/HR |
| `APPROVED` | Counts toward used_days / LOP |
| `REJECTED` | Pending reversed |
| `CANCELLED` | From DRAFT/SUBMITTED (own/HR); APPROVED cancel = HR/ADMIN only |

No other leave states.

```
DRAFT → SUBMITTED → APPROVED
                 → REJECTED
                 → CANCELLED
SUBMITTED → CANCELLED
APPROVED → CANCELLED (HR only; reverse used_days; refresh LOP on unlocked runs)
```

---

## 3. Types, entitlement, year, carry-forward

`LeaveTypes` holds entitlement (`annual_entitlement_days`, `carry_forward_max_days`, flags).

**Leave year:** Settings `leave_year_start_month` (default January). `LeaveBalances.leave_year` is the year label (e.g. `2026`).

**Grant:** On employee create and on HR “start leave year” action: `entitled_days` = type’s annual entitlement; `used`/`pending` = 0; `carried_forward_days` = min(previous unused, `carry_forward_max_days`) on year start (SHOULD). **No monthly accrual** (FUTURE).

`available_days` = entitled + carried_forward − used − pending.

---

## 4. Day count, weekends, holidays, half-day

- Server computes `total_days`.  
- `leave_count_method`: `WEEKDAYS_ONLY` (default) or `CALENDAR_DAYS`.  
- **No holiday calendar** in Phase 1 (FUTURE).  
- Half-day (SHOULD): `total_days = 0.5`, start = end, type `allow_half_day`.

---

## 5. Validation

| Check | Result |
| --- | --- |
| Employee ACTIVE | Else block submit |
| Type active | Else block |
| end ≥ start | Else error |
| Overlap another SUBMITTED or APPROVED | Block (ignore DRAFT/REJECTED/CANCELLED) |
| requires_balance and available < total_days | Insufficient balance |
| max_consecutive_days | Error if set |
| min_service_days vs joining_date | Error |
| No manager | Still SUBMITTED; HR queue (MUST) |

Overlap uses dates (and half-day session if both half-days same day AM/PM — two different sessions may coexist).

---

## 6. Balances on transitions

| Event | Balance |
| --- | --- |
| Submit (requires_balance) | pending += total_days |
| Approve | pending −= ; used += |
| Reject / cancel SUBMITTED | pending −= |
| Cancel APPROVED | used −= |

Use `LockService` around submit/approve/reject/cancel that touch balances.

---

## 7. Payroll impact

If `counts_as_lop` and `APPROVED`, days in a payroll month contribute to `PayrollInputs.lop_from_leave` for **non-LOCKED** runs. HR sets `lop_days`. Later leave changes **do not** alter LOCKED `PayrollRecords`.

---

## 8. Screens (this module)

| Screen | User | Purpose | Actions |
| --- | --- | --- | --- |
| Apply Leave | EMPLOYEE, MANAGER (self), HR proxy | Create request | Save DRAFT / Submit |
| My Leave | Self | History | Cancel SUBMITTED/DRAFT |
| Leave Approvals | MANAGER, HR, ADMIN | Pending | Approve/Reject + comment |
| Leave Admin | HR, ADMIN | All requests + types | Filter, override, types CRUD |
| Leave Calendar | Per `03` | Month of APPROVED | Navigate month |

**MUST** screens: Apply, My Leave, Approvals, simple HR list + types. Calendar is SHOULD. Reports: FUTURE beyond filters.

---

## 9. Notifications and audit

Submit → manager email. Approve/Reject → employee.

Audit: `LEAVE_SUBMIT`, `LEAVE_APPROVE`, `LEAVE_REJECT`, `LEAVE_CANCEL`, `LEAVE_TYPE_SAVE`.
