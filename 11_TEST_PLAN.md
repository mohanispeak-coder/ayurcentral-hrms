# Phase 1 Test Plan

**Document:** `11_TEST_PLAN.md`  
P0 = launch blocker. Seed: EMP001 HR, EMP002 manager, EMP003 reports to EMP002, EMP004 other team.

---

## Employee

| Test ID | Scenario | Preconditions | Steps | Expected | Priority |
| --- | --- | --- | --- | --- | --- |
| EMP-01 | Create | HR | Valid create | New `employee_id`; audit | P0 |
| EMP-02 | Edit | EMP003 | Change department | Saved; `employee_id` unchanged | P0 |
| EMP-03 | Search/filter | Several rows | Search ID/name; filter INACTIVE | Correct subset | P1 |
| EMP-05 | Duplicate email | Known email | Create | Blocked | P0 |
| EMP-07 | Deactivate | Active + User | Deactivate | INACTIVE; user DISABLED; no new leave | P0 |
| EMP-08 | Manager salary | Manager | Open EMP003 | No salary/bank/PAN | P0 |
| EMP-10 | Immutable ID | HR | Change `employee_id` | Rejected | P0 |

---

## Leave

| Test ID | Scenario | Preconditions | Steps | Expected | Priority |
| --- | --- | --- | --- | --- | --- |
| LV-01 | Apply | Balance OK | Submit | SUBMITTED; pending up; email attempted | P0 |
| LV-02 | Approve | SUBMITTED | Manager approves | APPROVED; used up; pending down | P0 |
| LV-03 | Reject | SUBMITTED | Reject | REJECTED; pending reversed | P0 |
| LV-04 | Cancel SUBMITTED | Own | Cancel | CANCELLED; pending reversed | P0 |
| LV-05 | Insufficient balance | Available 1 request 2 | Submit | Error | P0 |
| LV-06 | Overlap | APPROVED week | Overlap submit | Error | P0 |
| LV-07 | LOP | APPROVED LOP in April | Open April DRAFT | `lop_from_leave` > 0 | P0 |
| LV-08 | Manager scope | EMP002 | EMP004 leave | Denied | P0 |
| LV-09 | Self-approve | EMP003 | Approve own | Denied | P0 |
| LV-10 | Half-day | SHOULD / if built | Half day | 0.5 days | P1 |
| LV-12 | LOP after LOCK | April LOCKED then new LOP | Approve LOP | LOCKED records unchanged | P0 |

---

## Payroll

| Test ID | Scenario | Preconditions | Steps | Expected | Priority |
| --- | --- | --- | --- | --- | --- |
| PAY-01 | Regular | Full month F=1 | Calculate | Matches formulas | P0 |
| PAY-02 | New joiner | Mid-month paid_days | Calculate | Prorated earnings | P0 |
| PAY-03 | LOP | lop_days 2 | Calculate | Lower net than PAY-01 | P0 |
| PAY-04 | Revision then new month | Jan locked Basic X; April structure Y | April calculate | Uses Y; January records still X | P0 |
| PAY-05 | Bonus/incentive | Inputs | Calculate | Unprorated in gross | P0 |
| PAY-07 | Structure deduction | PF on structure | Calculate | In deductions | P0 |
| PAY-08 | Missing structure | No CURRENT | Calculate / approve | Exception; approve/lock blocked | P0 |
| PAY-09 | Missing bank | No IFSC | Lock | Blocked default | P0 |
| PAY-10–12 | Workflow | DRAFT | Calc → UNDER_REVIEW → APPROVED → LOCK | States only as specified | P0 |
| PAY-13 | Correction | LOCKED run | New correction run | Original rows unchanged; new run independent | P0 |
| PAY-14 | Payslip | After LOCK | Employee download | Own file; amounts = record | P0 |
| PAY-15 | Negative net | Huge other_deductions | Lock | Blocked default | P0 |
| PAY-16 | Client net tamper | Client sends net=0 | Recalc/lock | Server net used | P0 |
| PAY-17 | Master data after lock | Change department | View locked register | Snapshot pay unchanged (name on payslip may be from snapshot/breakdown; **net/components frozen**) | P0 |
| PAY-18 | Leave type change after lock | Change LOP flag | Recalc forbidden on LOCKED | Records unchanged | P0 |

---

## Security

| Test ID | Scenario | Steps | Expected | Priority |
| --- | --- | --- | --- | --- |
| SEC-01 | EMP003 loads EMP004 | Profile/salary/leave | Forbidden | P0 |
| SEC-02 | Manager salary EMP004 | | Forbidden | P0 |
| SEC-03 | Employee payroll API | Create run | Forbidden | P0 |
| SEC-04 | Manager revise salary | | Forbidden | P0 |
| SEC-05 | Unmapped email | Open app | Denied | P0 |
| SEC-06 | DISABLED user | | Denied | P0 |
| SEC-07 | Drive other payslip | Guess document_id | Denied | P0 |

---

## Concurrency and errors

| Test ID | Scenario | Steps | Expected | Priority |
| --- | --- | --- | --- | --- |
| CON-01 | Double approve | Two managers same request | One success; balance once | P0 |
| CON-02 | Dual calculate | Two HR calculate | One completes; other retry | P1 |
| ERR-01 | Invalid dates | end < start | Validation error | P0 |

---

## Notifications

| Test ID | Scenario | Expected | Priority |
| --- | --- | --- | --- |
| NOT-01 | Leave submit | Manager recipient logged SENT or FAILED | P0 |
| NOT-02 | UNDER_REVIEW / LOCK | Recipients per `07` | P0 |
| NOT-03 | Bad email | FAILED; leave still APPROVED | P0 |
| NOT-04 | Payslip subject | No net pay in subject | P1 |
