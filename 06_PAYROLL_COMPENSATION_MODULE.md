# Payroll and Compensation Module

**Document:** `06_PAYROLL_COMPENSATION_MODULE.md`  
**Authority:** Apps Script only. UI never owns net pay.  
**Currency:** INR.  
**Attendance:** HR inputs only — no biometric module.

---

## 1. Separation of concerns

```
A. SalaryStructure     contractual / current package (SalaryStructures + SalaryComponents)
        ↓
B. PayrollInputs       this month only (working/paid/LOP, bonus, incentive, other, TDS)
        ↓
C. Payroll calculation server (factor, gross, deductions, net, employer)
        ↓
D. PayrollRecord       snapshot of inputs + results used (immutable when run LOCKED)
        ↓
E. Workflow             DRAFT → CALCULATED → UNDER_REVIEW → APPROVED → LOCKED
```

---

## 2. A. Salary structure

Configurable lines. Typical codes (HR may add/rename):

| Kind | Examples |
| --- | --- |
| EARNING | BASIC, HRA, SA, OTHER_EARN |
| DEDUCTION | PF, ESI, PT, OTHER_DED |
| EMPLOYER | EMPLOYER_PF (not in net) |

`calc_method`: `FIXED` or `PERCENT_OF_BASIC` only. No `PERCENT_OF_GROSS` in Phase 1.

**TDS:** not a structure formula. Monthly `tds_amount` on inputs. HR/accounts own the number.

**Statutory (PF/ESI/PT):** amounts or percents **configured by HR**. The product does **not** implement Indian statute (wage ceilings, ESI bands, PT state slabs). **Accounts review is required** before APPROVED/LOCKED.

**Revision:** new `SalaryStructures` row; old row `status=SUPERSEDED`, `effective_to` = day before new `effective_from`; set `previous_structure_id`, `revision_reason`, `approved_by_email`. **Never edit component amounts** on SUPERSEDED rows.

Employee (self) may view own CURRENT structure and own payslips. Managers: no salary.

---

## 3. B. Monthly payroll inputs

HR enters (or SHOULD: paste) per `employee_id` on the run:

| Field | Meaning |
| --- | --- |
| working_days | Denominator for proration |
| paid_days | Days paid |
| lop_days | Unpaid / LOP (may start from `lop_from_leave`) |
| bonus, incentive | Variable, **not** prorated |
| other_earnings / other_deductions | One-time; OT hours engine is FUTURE |
| tds_amount | Conservative input |

**Attendance boundary:** these numbers are **not** derived from a biometric module. Future import maps into these same columns.

**LOP from leave:** sum of `total_days` of `APPROVED` leave with `counts_as_lop` overlapping the payroll month, split across months if needed. Written to `lop_from_leave` when the DRAFT run is created or refreshed. **Never** written to a LOCKED run. HR may set `lop_days` independently.

---

## 4. E. Canonical payroll states

```
DRAFT → CALCULATED → UNDER_REVIEW → APPROVED → LOCKED
```

| Status | Meaning |
| --- | --- |
| `DRAFT` | Inputs editable; no trusted totals |
| `CALCULATED` | Records exist; HR may recalculate (still DRAFT or stay CALCULATED after recalc). Recalc allowed from DRAFT and CALCULATED. |
| `UNDER_REVIEW` | Inputs frozen unless HR **returns to DRAFT** (allowed). Recalc after return. |
| `APPROVED` | Ready to lock. Return to DRAFT: **Admin only**, with audit. |
| `LOCKED` | Immutable. Payslips generated. |

There is **no unlock**. Correction = new run (`correction_of_run_id`). Original LOCKED rows stay as paid history.

Who: HR and Admin operate the machine. Employee sees own LOCKED payslips only.

---

## 5. C. Calculation (conceptual)

Currency INR. Store **2 decimal places**. Round each stored line with half-up to 2 decimals. Then:

- If Settings `payroll_round` = `PAISE_2`: `net_pay` as computed.  
- If `NEAREST_RUPEE`: round `net_pay` to 0 decimals (half-up) after the 2-decimal net.

```
F = paid_days / working_days     (if working_days = 0 → exception, skip employee)
Prorated earning E' = round(E * F, 2)
Prorated deduction D' = round(D * F, 2)

gross_earnings = Σ E' + bonus + incentive + other_earnings
total_deductions = Σ D' + tds_amount + other_deductions
net_pay = gross_earnings − total_deductions
employer_contributions = Σ EMPLOYER lines (same F), not in net
```

Structure used: the `SalaryStructures` row for that `employee_id` with `effective_from` ≤ last date of payroll month and (`effective_to` empty or ≥ last date of month). If none: `MISSING_STRUCTURE`. **No mid-month days-weighted split in Phase 1** (FUTURE).

Frontend may show numbers; **recalculate on the server** before APPROVED/LOCKED.

---

## 6. D. Payroll record and historical integrity

On each Calculate, rewrite `PayrollRecords` for that run **only if** status is DRAFT or CALCULATED.

Each record **copies** input fields and `salary_structure_id` plus totals and `component_breakdown`.

**Once the run is LOCKED:**

- Do not update `PayrollRecords` or `PayrollInputs` for that `payroll_run_id`.  
- Salary revisions, leave policy/type changes, employee master edits, and new LOP **must not** change those rows.  
- Payslips stay; new correction run creates **new** records and files.

Payroll “which structure?” for history = `PayrollRecords.salary_structure_id`, not a live lookup.

---

## 7. Edge cases

| Case | Rule |
| --- | --- |
| New joiner | Include if `joining_date` ≤ period end and `status=ACTIVE`. HR sets `paid_days` (suggestion: weekdays from join to month end). |
| LOP | `lop_days`; `paid_days` typically `working_days − lop_days` (HR confirms). |
| Salary revision in month | Use structure in force on **period end** only. |
| Bonus / incentive / extra deduction | Input fields; not prorated. |
| Missing structure | Flag `MISSING_STRUCTURE`; still list employee; **block APPROVED/LOCKED** if `block_lock_missing_structure` (default true). |
| Missing bank | `MISSING_BANK`; block LOCK if `block_lock_missing_bank` (default true). Missing PAN = warning `MISSING_PAN`, no hard block. |
| Negative net | `NEGATIVE_NET`; block LOCK unless `allow_lock_negative_net` (default false). |
| Locked | No casual edit. |
| Correction | Admin/HR creates new run linked to locked run; process DRAFT…LOCKED again; original untouched. |

Inactive employees: not added to **new** DRAFT runs. Historical LOCKED records remain.

---

## 8. Payslips

On LOCK: HTML (or PDF if later native) file via `DriveApp` under `Payslips/{year}/{month}/`. `Documents` category `PAYSLIP`.

Content: company, `employee_id`, name, department, designation, period, working/paid/LOP, earning/deduction lines, gross, TDS, net, masked bank, generated at.

Employee downloads **own** only. Email subject: payslip available — **do not put net pay in the subject**.

---

## 9. Reports (MUST vs FUTURE)

**MUST:** run register (employee, gross, deductions, net, flags); exception list.  
**SHOULD:** department totals.  
**FUTURE:** earnings cube, multi-month analytics.

---

## 10. Audit actions

`PAYROLL_CREATE`, `PAYROLL_CALCULATE`, `PAYROLL_REVIEW`, `PAYROLL_APPROVE`, `PAYROLL_LOCK`, `PAYROLL_CORRECT` (new run), `SALARY_SAVE`, `SALARY_REVISE`.
