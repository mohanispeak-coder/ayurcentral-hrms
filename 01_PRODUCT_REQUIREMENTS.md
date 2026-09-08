# Product Requirements (Phase 1)

**Document:** `01_PRODUCT_REQUIREMENTS.md`  
Priorities: MUST / SHOULD / FUTURE per `00_MASTER_SPEC.md`.

---

## 1. Dashboard

**Objective:** Answer “What needs my attention today?” — not charts.

**Users:** Admin/HR full; Manager team leave; Employee personal.

**MUST:** Active headcount; on leave today (`APPROVED` covering today); pending `SUBMITTED` count; current payroll `status`; exception count; failed emails; missing structure / missing bank (open run); recent audit (HR/Admin). Quick links: pending leave, current payroll.

**SHOULD:** Birthdays/anniversaries.

**FUTURE:** Charts, attendance widgets.

**Behaviour:** Server aggregates; Manager/Employee never see company net pay.

**Acceptance:** Pending count matches `SUBMITTED`; employee dashboard has no other person’s pay.

---

## 2. Employee Management

**Objective:** Master keyed by `employee_id`.

**MUST:** Directory; search; filters (status, department, location); create/edit; activate/deactivate; profile tabs (personal, employment, payroll identifiers, documents, leave summary); unique `work_email`; immutable `employee_id`; salary tab HR/Admin/self only.

**SHOULD:** Self-edit phone/address; create User at same time as employee.

**FUTURE:** Org chart, employment-history timeline, extra KYC fields.

**Validation:** Required schema fields; manager ≠ self; unique email.

**Acceptance:** Duplicate email blocked; Manager cannot see PAN/bank/salary.

---

## 3. Leave Management

**Objective:** Configurable leave through approval and LOP hint for payroll.

**MUST:** Leave types (entitlement on type); balances; apply → validate → `SUBMITTED` → approve/reject; overlap; insufficient balance; LOP → `lop_from_leave` on open run; emails; employee cannot self-approve.

**SHOULD:** `DRAFT`; half-day; HR proxy apply; HR override; year-start carry-forward action.

**FUTURE:** Accrual engine, holidays, sandwich, encashment, skip-level, rich reports.

**Acceptance:** Approve updates used/pending; overlap blocked; LOCKED payroll unchanged by later leave.

---

## 4. Payroll & Compensation

**Objective:** Better than Excel; not a tax product.

**MUST:** Structure + components; inputs; calculate; states; lock snapshot; correction run; payslip; exceptions; INR rounding as in `06`.

**SHOULD:** Paste/CSV into DRAFT inputs.

**FUTURE:** Biometric import, days-weighted revision, statutory engine.

**Acceptance:** Frontend cannot set net; LOCKED records ignore later structure edits.

---

## 5. Notifications

**MUST events:** `LEAVE_SUBMITTED`, `LEAVE_APPROVED`, `LEAVE_REJECTED`, `PAYROLL_READY_REVIEW` (enter `UNDER_REVIEW`), `PAYROLL_APPROVED`, `PAYSLIP_AVAILABLE`. `MailApp`. Failures logged; business action still committed.

**SHOULD:** Retry failed; pending-leave reminder trigger.

**FUTURE:** In-app inbox, salary-revision mail, digest.

---

## 6. Roles

**MUST:** Map `google_email` → `employee_id` + `role`. Admin manages users. Every server call authorizes.

---

## 7. Audit log

**MUST actions only:** employee create/update/status; leave submit/approve/reject/cancel; salary save/revise; payroll calculate/approve/lock/correct; user/role change. No field-level JSON.

---

## 8. Drive

**MUST:** Tree in `00`; metadata in `Documents`; `DriveApp`; no public links; RBAC on download.

---

## 9. Settings

**MUST:** Keys in `02`. Prefix change affects **new** `employee_id` only.
