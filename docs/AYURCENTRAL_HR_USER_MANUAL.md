# AyurCentral Enterprise HRMS — HR User Manual

**Who this is for:** HR and Admin staff who use the web app every day.  
**What this covers:** Screens, buttons, and step-by-step tasks only (no technical setup).  
**Last updated:** September 2026 (matches `shiva-branch` web app).

---

## 1. Getting started

### 1.1 Opening the app

1. Open the **AyurCentral HRMS** link your IT team shared (it runs in the browser, usually via Google).
2. Sign in with your **company Google account** (the same email that was added as an HR/Admin user).
3. If you see “not authorized,” your email is not linked to an active user record — contact your system owner.

### 1.2 Layout you will see every day

| Area | What it does |
| --- | --- |
| **Left sidebar** | Main menu. Sections can be expanded or collapsed. |
| **Top bar** | Page title, **notifications** (bell), your name and role, **Sign out**. |
| **Main page** | Forms, tables, and action buttons for the task you chose. |
| **Ask HR** (chat bubble, bottom right) | Quick help about using HRMS (not a substitute for payroll decisions). |

After you sign in, use a **hard refresh** (Ctrl+Shift+R or Cmd+Shift+R) if the screen looks old or buttons are missing.

### 1.3 Roles (what HR usually needs to know)

| Role | Typical use |
| --- | --- |
| **ADMIN / OWNER** | Everything HR can do, plus **Settings**, user access, and sensitive configuration. |
| **HR** | Employees, leave, attendance, payroll, recruitment, notifications. |
| **MANAGER** | Team list, leave approvals — **no payroll or salary screens**. |
| **EMPLOYEE** | Own profile, own leave, own payslips only. |

The menu only shows items your role is allowed to see. If something is missing, an Admin can adjust **Settings → HRMS module access by role** (then you refresh the page).

---

## 2. Dashboard

**Menu:** Main → **Dashboard**

The dashboard answers: *“What needs attention today?”*

For HR/Admin you will typically see:

- Count of **active employees**
- Who is **on leave today**
- **Pending leave** waiting for approval
- **Payroll status** for the current month (if a run exists)
- **Alerts** (for example missing bank details, missing salary structure, failed emails)
- **Recent activity** (audit-style list of important actions)

**Quick actions** (when shown): jump to leave approvals, payroll, add employee, or apply leave — depending on your role.

---

## 3. My Work (your own record)

These items appear for most users; HR uses them for their own employment data too.

### 3.1 My Profile

View and update **your** contact details where the app allows self-edit (phone, address). Payroll identifiers and employment fields are usually HR-only on other people’s profiles.

### 3.2 My Leave

- See **leave balances** for the current leave year.
- See your **requests** (draft, submitted, approved, rejected).
- Use **Apply leave** (or the link from here) to submit a new request.

### 3.3 My Payslips

- Lists **locked** payslips for **you only**.
- **Download** or view after payroll has been finalized for that month.
- If empty, payroll for your employee ID may not be finalized yet.

---

## 4. People

### 4.1 Employees (directory)

**Menu:** People → **Employees**

| Task | Steps |
| --- | --- |
| **Find someone** | Use search and filters; click a row to open the profile. |
| **Add employee** | **Add employee** → fill required fields → **Save**. Employee ID is assigned automatically on save. |
| **View / edit profile** | Open the employee → use tabs (Personal, Employment, Payroll IDs, Leave, Documents, etc.). |
| **Deactivate** | On profile → change status to inactive when someone leaves. They will not appear on new payroll drafts; old locked payroll is unchanged. |

**Tip:** Before monthly payroll, make sure each active employee has **salary structure**, **bank details**, and **PAN** where your process requires them. The payroll screen will flag missing items.

### 4.2 Mandatory fields

**Menu:** People → **Mandatory fields**

- Choose which fields are **required** when creating employees or using bulk upload.
- Save after changes.
- Use this to match your company’s onboarding checklist.

### 4.3 My Team (managers only)

Managers see **direct reports** only — no salary. HR uses **Employees** for the full directory.

---

## 5. Time off (leave)

### 5.1 Leave (company view) — HR

**Menu:** Time Off → **Leave**

- See **all employees’** leave requests (by status).
- **Configure leave types** and policies your company uses (names and rules are set here, not hard-coded).
- HR can act on behalf of employees when your process allows (actions are logged).

### 5.2 Leave approvals

**Menu:** Time Off → **Leave Approvals**

- Lists requests in **Submitted** state.
- Open a request → **Approve** or **Reject** (with reason if needed).
- Managers see **team only**; HR/Admin can see broader queues.

### 5.3 How leave connects to payroll (what HR should do)

- Approved leave may suggest **LOP (loss of pay)** on open payroll months.
- On payroll screens you can **refresh leave LOP** or **apply leave LOP to days** (see Payroll section).
- **Locked** payroll months are never changed by new leave — use a **correction run** if needed.

### 5.4 Leave calendar

Shows approved leave in a calendar view (scope depends on role).

---

## 6. Attendance

Attendance in HRMS means **working days, paid days, and LOP** for payroll — not a biometric device link.

### 6.1 Register (attendance upload)

**Menu:** Attendance → **Register**

This is **step 2** of the monthly payroll path (see section 7).

| Task | Steps |
| --- | --- |
| **Pick month** | Use the **period** card (year, month, **vertical**). |
| **Start payroll for the month** | If no run exists: **Start selected vertical** or **Start all verticals**. |
| **Upload register** | Download the **attendance template** for the run → fill in Excel/CSV → **Validate** → **Confirm import**. |
| **Edit one employee** | Use the table on the same page to enter or fix working days, paid days, LOP. |
| **Save** | **Save days & extras** before leaving the page if you edited manually. |

**Vertical:** Choose **SAPL**, **AOPL**, **AOMS**, or **Combined (legacy payroll)**.  
- **Combined (legacy)** = older single payroll run for the whole company (`PR-YYYY-MM`).  
- **Per vertical** = separate run per company vertical (`PR-YYYY-MM-SAPL`, etc.).

If attendance was entered on an **older combined** run but you opened an empty **vertical** run, use the yellow banner: **Import from combined payroll** or **Open combined payroll**.

### 6.2 Form T

**Menu:** Attendance → **Form T**

- Statutory **Form T** Excel export for a chosen **payroll month** and **vertical**.
- Use after attendance/payroll data exists for that period.

---

## 7. Payroll (monthly salary run)

Payroll is a **three-step path** shown at the top of salary-related pages:

1. **Salary structure** — employee packages (CTC / components).  
2. **Attendance** — working days and LOP for the month.  
3. **Payroll** — calculate net pay, review, finalize, payslips.

Use the **pipeline buttons** (1 → 2 → 3) to move between steps without losing the selected month.

### 7.1 Salary structure

**Menu:** Payroll → **Salary structure**

| Task | Steps |
| --- | --- |
| **Bulk update** | Use **bulk upload** (Excel/CSV template) for many employees. |
| **One employee** | Search employee → open editor → enter components → **Save**. |
| **Revision** | When salary changes, create a **revision** (history is kept; old amounts are not overwritten). |

Employees must have a **current** structure effective for the payroll month before calculate will succeed.

### 7.2 Salary Statement

**Menu:** Payroll → **Salary Statement**

- Monthly **cost-to-company / salary breakdown** report from structures (for HR review, not the same as payslip PDF).
- Filter by period and export/download as provided on screen.

### 7.3 Payroll — main run screen

**Menu:** Payroll → **Payroll**

#### A. Choose period and run

1. Set **year** and **month**.
2. Set **vertical**:
   - **Combined (legacy payroll)** — use for months that were always run as one company-wide payroll.
   - **SAPL / AOPL / AOMS** — use when you run payroll separately per vertical.
3. If several runs exist for the same month, use **Runs this month** dropdown or **All payroll runs** at the bottom → **Open** the correct run ID.

**Run status labels you will see:**

| Status | Meaning for HR |
| --- | --- |
| **Draft** | You can edit attendance inputs; not finalized. |
| **Calculated** | Net pay computed; you can recalculate if inputs change. |
| **In review / Approved** | Optional review steps if your process uses them. |
| **Locked / Finalized** | Month is closed; payslips generated; use **correction run** to fix. |

#### B. KPI row

Shows employee count, gross, deductions, net (after calculate), and LOP summary.

#### C. Step 2 — Calculate payroll

1. Fix any **attendance incomplete** warning (all employees need valid working/paid/LOP days).
2. Click **Calculate payroll** (or **Recalculate**).
3. Review the employee table: amounts, warnings, exceptions.

**Important:** You cannot **Finalize** while status is still **Draft** and calculate has not been run. Use **↑ Go to Calculate payroll** from the finalize section if you are at the bottom of the page.

#### D. Payroll check (exceptions)

The app lists employees who need attention, for example:

- Missing salary structure  
- Missing bank or PAN  
- Working days zero  
- Negative net pay  

Use **Fix** links to jump to salary structure or employee profile where offered.

#### E. Review and approve (if shown)

Follow on-screen steps if your organization uses formal review before lock.

#### F. Finalize payroll

- When checks pass and status is past draft, click **Finalize payroll**.
- Finalizing **locks** amounts for that run (they cannot be casually edited).

#### G. Payslips

After finalize:

- Payslip files are generated per employee with a record.
- Use regenerate options in **More actions** if a payslip failed.
- Employees see their own copies under **My Payslips**.

#### H. Correction run (after lock)

If a **locked** month was wrong:

1. Open that locked run.  
2. **More actions** → **Create correction run**.  
3. A new **draft** opens for the **same month and vertical**; original locked run stays as history.  
4. Repeat attendance → calculate → finalize on the correction run.

#### I. More actions (advanced)

| Button | When to use |
| --- | --- |
| **Import attendance from combined payroll** | Vertical run is empty but old combined run has days. |
| **Refresh leave LOP** | Pull latest approved leave LOP suggestions. |
| **Apply leave LOP to days** | Copy leave LOP into LOP days and recompute paid days (then recalculate). |
| **Return to draft** | Undo review state so you can edit inputs (rules depend on status). |
| **Create correction run** | Only from a **locked** run. |

#### J. All payroll runs

At the bottom, expand **All payroll runs** to open **any** month/run (including the current month). The row marked **Current** is the run you are viewing.

---

## 8. Recruitment (ATS)

**Menu:** Recruitment → **Recruitment** / **Jobs** / **Candidates**

### 8.1 Jobs

- Create a job → **Publish** when ready (creates the public careers link).
- Edit title, description, location, etc. on **Edit job**.

### 8.2 Candidates and pipeline

- Candidates apply via the public link or are added manually.
- Move stages: Applied → Screening → … → Offer → **Hired**.

### 8.3 When a candidate is Hired

On the hired application you will typically:

1. Enter **compensation** (salary breakup for letters).  
2. Set **joining date** (needed for appointment letter).  
3. **Send offer letter** (email with PDF).  
4. **Send appointment letter** (after joining date is set).  
5. **Create employee** — opens a form with a **new employee ID**; completes onboarding into the employee directory.

Do steps in the order your HR policy requires; the screen hints remind you about joining date before appointment letter.

---

## 9. Notifications

**Menu:** System → **Notifications**

- **Inbox** — messages and links to related screens.  
- **Email log** (HR) — whether system emails were sent, failed, or skipped.  
- **Preferences** — where available, control how you receive alerts.

---

## 10. Settings (Admin / Owner)

**Menu:** System → **Settings**

| Section | Purpose |
| --- | --- |
| **Welcome messaging** | How welcome emails behave. |
| **Email & welcome toggles** | Turn categories of system email on or off. |
| **Content & document templates** | Edit email subject/body text for letters and notifications. PDF layouts are listed for reference; layout changes need IT. |
| **HRMS module access by role** | Which sidebar modules each role sees. |
| **New login defaults** | Default self-service flags when a login is created. |

Click **Save settings** after changes. Users should **refresh** the browser to see menu changes.

**Users** (Admin): role assignment screen — may show “coming soon” depending on deployment; user mapping is often done in the master spreadsheet by IT.

---

## 11. Monthly payroll checklist (recommended)

Use this every month:

1. [ ] New joiners: employee record + salary structure + bank/PAN.  
2. [ ] Leavers: mark **inactive** (after last working day process).  
3. [ ] Leave: clear pending approvals that affect the month.  
4. [ ] **Salary structure** — revisions effective for this month are in place.  
5. [ ] **Attendance / Register** — upload or enter days for the correct **vertical** (or combined legacy).  
6. [ ] **Payroll** — **Calculate** → fix exceptions → **Finalize**.  
7. [ ] **Payslips** — confirm generated; spot-check a few employees.  
8. [ ] **Salary Statement** / **Form T** — export if your compliance calendar needs them.

---

## 12. Common problems (quick fixes)

| Problem | What to try |
| --- | --- |
| Finalize button disabled | Scroll up → **Calculate payroll** first; fix attendance incomplete banner. |
| No employees on payroll | Wrong run or vertical — open **Combined (legacy)** or **Import from combined payroll**. |
| “Attendance incomplete” | Every row needs working days &gt; 0 and valid paid/LOP; finish register upload. |
| Missing structure / bank on check list | Open employee → salary structure or payroll tab. |
| Old month was wrong after finalize | **Create correction run** from locked run (do not edit locked month). |
| Menu item missing | Admin: **Settings → module access**; then hard refresh. |
| Screen looks outdated | Hard refresh; confirm IT deployed latest web app version. |

---

## 13. Getting help

- **Ask HR** chat: usage questions inside the app.  
- **IT / system owner:** login issues, deployment, spreadsheet access, new users.  
- **Accounts:** statutory interpretation, TDS amounts, PF/ESI policy — amounts you enter must match your company’s rules.

---

*AyurCentral Enterprise HRMS — HR User Manual. For internal training and operations.*
