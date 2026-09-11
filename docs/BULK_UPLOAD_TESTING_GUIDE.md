# HRMS — Testing guide: Employee code & bulk upload

Branch: `cursor/experiment-500f`

## Before you start

1. Deploy the latest code from `apps-script/` (`clasp push`).
2. Create a **new web app deployment** (or new version) if `appsscript.json` changed.
3. In Apps Script editor → **Services** → enable **Google Drive API** (advanced service). Required for `.xlsx` upload.
4. Log in as **HR** or **ADMIN** (employees cannot access bulk upload or create employee).

Template file (offline copy): `docs/HRMS_Bulk_Employee_Upload_Template.csv`  
(Open in Excel or Google Sheets; save as `.xlsx` if you prefer.)

---

## Part A — Manual employee create (single)

### Steps

1. Open the HRMS web app URL (`/exec`).
2. Sign in (Google identity or email OTP) as **HR** or **ADMIN**.
3. Go to **Employees** (directory).
4. Click **Add employee**.
5. Fill in:
   - **Employee code** (required): e.g. `SAPL-0001`, `AOPL-0001`, or `AOMS-0001`
   - Personal and employment fields (name, work email, department, designation, location, joining date, employment type)
   - Optional: PAN, bank details
   - **Create login** checkbox — if checked, enter **Google login email** (can match work email)
6. Click **Save**.

### Expected results

- Employee is created with the **exact code you entered** (not auto-generated `EMP001`).
- You are redirected to the employee profile.
- Leave balances are seeded (if leave types exist).
- Drive folder created under Employee Documents (if Drive is configured).
- If login was enabled, a **Users** row exists with role **EMPLOYEE** only.

### Validation tests

| Test | Action | Expected |
|------|--------|----------|
| Invalid format | Enter `EMP001` or `SAPL0001` | Error: use SAPL-0001 format |
| Duplicate code | Reuse `SAPL-0001` | Error: code already exists |
| Missing code | Leave employee code empty | Error: required |
| Immutable ID | Edit employee — code field | Disabled / not editable |

---

## Part B — Bulk upload

### Steps

1. Go to **Employees** → click **Bulk upload**.
2. Click **Download template** — saves `HRMS_Bulk_Employee_Upload_Template.xlsx` from the app (or use `docs/HRMS_Bulk_Employee_Upload_Template.csv`).
3. Fill the **Employees** sheet (or CSV rows):
   - One row per employee
   - **employee_id** must be provided by HR for every row
   - Required columns marked with `*` in the app-generated template
   - **create_login**: `YES` or `NO`
   - If `YES`, **google_login_email** is required
   - **manager_employee_id** must already exist in HRMS (e.g. create managers first, or reference an existing code)
4. Save as `.xlsx` or `.csv`.
5. In the app: **Choose Excel/CSV file** → select your file.
6. Click **Validate upload**.
7. Review:
   - **Ready to import** table (valid rows)
   - **Errors** table (row, field, message)
8. If valid rows exist, click **Confirm import (N)**.
9. Check summary toast and return to directory.

### Expected results

- Valid rows create employees with manual codes, same onboarding as single create.
- Invalid rows are listed with row number and field errors; nothing imported for those rows.
- If some rows fail on commit, an error CSV may download.
- Directory shows new employees; search by code works.

### Bulk validation tests

| Test | How | Expected |
|------|-----|----------|
| Happy path | 2–3 valid rows, unique codes/emails | All import successfully |
| Duplicate code in file | Same `employee_id` on two rows | Second row error |
| Code already in HRMS | Re-upload existing `SAPL-0001` | Row error: already exists |
| Duplicate email | Same `work_email` twice in file | Row error |
| Bad employee code format | `EMP001` in a row | Row error on employee_id |
| Manager missing | `manager_employee_id` not in HRMS | Row error |
| create_login YES, no login email | Empty google_login_email | Row error |
| Bank without IFSC | Account number only | Row error on IFSC |
| Over limit | More than 100 data rows | File rejected |

### Suggested test order

1. Create **SAPL-0001** manually (manager for later rows).
2. Bulk upload **AOPL-0001** and **AOMS-0001** with `manager_employee_id` = `SAPL-0001`.
3. Re-validate a file with a deliberate error — confirm **Confirm import** only imports valid rows from staged session.

---

## Part C — RBAC (roles)

| Role | Bulk upload | Add employee | Directory |
|------|-------------|--------------|-----------|
| ADMIN | Yes | Yes | Yes |
| HR | Yes | Yes | Yes |
| MANAGER | No | No | My Team only |
| EMPLOYEE | No | No | No (My Profile only) |

Bulk upload and template download must **not** appear for Manager or Employee.

**Login role:** Bulk/single create only creates **EMPLOYEE** login. Promote to HR/Manager/Admin via Users admin (or Users sheet) — not via bulk template.

---

## Part D — Payslips (unchanged)

- Payslips are **not** generated from Employee module.
- Run payroll → **Lock** run → payslips appear on employee **Payslips** tab and **My Payslips**.
- No new payslip buttons were added to Employee profile.

---

## Part E — Deploy checklist

- [ ] `clasp push` from `apps-script/`
- [ ] Drive API advanced service enabled
- [ ] Web app redeployed (`Execute as: Me`, `Anyone anonymous`)
- [ ] Test as HR/ADMIN account linked in **Users** sheet
- [ ] `node tests/employee-bulk-upload.test.js` passes locally

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bulk upload button missing | Log in as HR or ADMIN |
| xlsx upload fails | Enable Drive API; try CSV |
| Template download fails | Check script owner permissions |
| Validate session expired | Re-upload and validate again (30 min window) |
| Manager not found | Create manager employee first |
