# ATS integration notes

ATS ships as a self-contained module under `apps-script/src/ats/`. It does **not** modify foundation, Employee, Leave, Payroll, Ask HR / Knowledge Hub, or the HRMS shell. Wire it in with the snippets below when you are ready.

Candidates are **not** employees. IDs are `CAND0001`, jobs are `JOB0001`. Applying never creates an `Employees` or `Users` row. `hired_employee_id` on Candidates is reserved and left empty.

---

## Independent use (minimum hook)

Only `doGet` must know about ATS so public apply and the standalone recruiter app can load. In `apps-script/src/foundation/Main.gs`, at the top of `doGet(e)`:

```javascript
function doGet(e) {
  if (typeof AtsWeb !== 'undefined') {
    var atsOut = AtsWeb.tryServe(e);
    if (atsOut) return atsOut;
  }
  // existing shell…
  var t0 = Date.now();
  var template = HtmlService.createTemplateFromFile('ui/Index');
  // …
}
```

| URL | Page | Auth |
| --- | --- | --- |
| `{webAppUrl}?ats=apply` | Public job board | None |
| `{webAppUrl}?ats=apply&job={public_slug}` | Public apply form | None |
| `{webAppUrl}?job={public_slug}` | Same as apply for that slug | None |
| `{webAppUrl}?ats=app` | Standalone recruitment UI (OTP / Google session) | HRMS session; ADMIN / HR / MANAGER only |

Public ATS APIs (`apiAtsPublicListJobs`, `apiAtsPublicGetJob`, `apiAtsPublicApply`) are the **only** unauthenticated endpoints. They return published job copy only — never Users, payroll, leave, internal notes, OTPs, or Knowledge Hub keys.

After the `doGet` hook, HR/Admin can:

1. Open `?ats=app` and sign in.
2. Run **Set up ATS** (or `apiAtsEnsureSchema`) to create sheets.
3. Create a job, publish it, copy the public link.

---

## Optional: embed ATS in the main HRMS shell

Do this when you want Recruitment in the sidebar next to Payroll. Four small, additive edits.

### 1. Nav — `PermissionService.gs`

Add to `NAV_ITEMS_` (ADMIN / HR / MANAGER only; **not** EMPLOYEE):

```javascript
{ id: 'ats', label: 'Recruitment', route: 'ats', icon: 'group', roles: ['ADMIN', 'HR', 'MANAGER'] },
{ id: 'ats-jobs', label: 'Jobs', route: 'ats-jobs', icon: 'event', roles: ['ADMIN', 'HR', 'MANAGER'] },
{ id: 'ats-candidates', label: 'Candidates', route: 'ats-candidates', icon: 'people', roles: ['ADMIN', 'HR', 'MANAGER'] },
```

Or merge at bootstrap without duplicating items:

```javascript
nav = AtsPermissionService.mergeNav(PermissionService.getNavForRole(session.role), session.role);
```

### 2. Lazy UI allowlist — `ApiFoundation.gs`

```javascript
var HRMS_MODULE_UI_FILES_ = {
  employee: ['employee/EmployeePages', 'employee/EmployeeClient'],
  leave: ['leave/LeaveUi', 'leave/LeaveClient'],
  payroll: ['payroll/PayrollClient'],
  ats: ['ats/AtsClient']
};
```

If you prefer not to touch the allowlist, point ATS routes at `apiAtsGetModuleUi` instead of `apiGetModuleUi`.

### 3. Client routes — `Scripts.html`

`ROUTE_MODULE`:

```javascript
ats: 'ats',
'ats-jobs': 'ats',
'ats-job': 'ats',
'ats-job-new': 'ats',
'ats-job-edit': 'ats',
'ats-candidates': 'ats',
'ats-candidate': 'ats'
```

`ROUTE_TITLES` / `ROUTE_LEDES` as needed. `NAV_GROUPS` example:

```javascript
{ id: 'recruit', label: 'Recruitment', routes: ['ats', 'ats-jobs', 'ats-candidates'] }
```

`isNavRouteActive`: treat `ats-job*` as Jobs and `ats-candidate` as Candidates.

### 4. Database setup — `SchemaService.setupDatabase`

At the end of `setupDatabase`, after existing sheets:

```javascript
if (typeof AtsSchemaService !== 'undefined') {
  AtsSchemaService.ensureSheets(ss);
}
```

Until then, HR/Admin can call `apiAtsEnsureSchema` from the ATS UI. `DbService` is unchanged. ATS uses `DbService.nextSequence` with settings keys `seq_ats_job`, `seq_ats_candidate`, `seq_ats_application`, `seq_ats_interview`, `seq_ats_activity` (seeded by `AtsSchemaService`).

Do **not** add ATS sheets to `HRMS.SHEETS` unless you want them in foundation schema info. ATS constants live in `AtsConstants.gs`.

---

## Schema (new sheets only)

| Sheet | Primary key | Purpose |
| --- | --- | --- |
| `JobRequisitions` | `job_id` | Requisitions. `public_slug` is the public URL token. `external_ref_json` reserved for future LinkedIn/Naukri IDs. |
| `Candidates` | `candidate_id` | Applicant master. **No** `employee_id` identity. `hired_employee_id` reserved, unused. |
| `Applications` | `application_id` | Job × candidate + pipeline `stage`. |
| `Interviews` | `interview_id` | Stage, schedule, interviewer, notes, rating, recommendation. |
| `CandidateActivity` | `activity_id` | Comments and history. No resume bytes. |

Job status: `DRAFT` → `PUBLISHED` → `PAUSED` → `CLOSED` (HR may reopen CLOSED).

Pipeline default: `APPLIED` → `SCREENING` → `SHORTLISTED` → `INTERVIEW` → `SELECTED` → `OFFER` → `HIRED`, plus `REJECTED` / `WITHDRAWN`. Override with Settings `ats_pipeline_stages` (JSON array).

Drive: `HRMS Root/ATS Candidates/{candidate_id}/` via `DriveService.getRootFolder()` — `DriveService.gs` is not modified.

---

## APIs

**Public (no session):** `apiAtsPublicListJobs`, `apiAtsPublicGetJob`, `apiAtsPublicApply`

**Internal (auth + ATS RBAC):** `apiAtsGetBootstrap`, `apiAtsEnsureSchema`, `apiAtsGetDashboard`, `apiAtsGetModuleUi`, `apiAtsListJobs`, `apiAtsGetJob`, `apiAtsCreateJob`, `apiAtsUpdateJob`, `apiAtsTransitionJob`, `apiAtsGetSharePack`, `apiAtsListHiringManagers`, `apiAtsListCandidates`, `apiAtsGetCandidate`, `apiAtsAddCandidateComment`, `apiAtsMoveApplicationStage`, `apiAtsScheduleInterview`, `apiAtsUpdateInterview`, `apiAtsDownloadResume`

Hiring manager picker reuses `EmployeeService.listPicker` on the server when present. Employee module files are not edited.

---

## RBAC

| Role | ATS |
| --- | --- |
| ADMIN | Full |
| HR | Full recruitment |
| MANAGER | Assigned requisitions (`hiring_manager_employee_id`) and interviews they are on; screen / shortlist / interview / reject |
| EMPLOYEE | None |

Resume download is the same scope. Internal notes on jobs are HR/Admin only.

---

## Tests

```bash
node tests/ats-engine.test.js
```

Apps Script editor: `testAts_All` (engine always; live writes when spreadsheet + HR/ADMIN session).

---

## What this module does not do

- Notifications / MailApp (owned by another stream)
- PMS
- Knowledge Hub / Ask HR
- LinkedIn or Naukri APIs (share UI is Copy link / Open application / Share job; provider columns reserved)
- Convert HIRED → Employee (manual later; `hired_employee_id` reserved)
- Change payroll lock, leave, OTP, or sessions

## Shared files that still require a human edit

| File | Why | Required for |
| --- | --- | --- |
| `foundation/Main.gs` | `AtsWeb.tryServe(e)` | Public apply URL and `?ats=app` |
| `foundation/PermissionService.gs` | Nav items | Sidebar in main shell |
| `foundation/ApiFoundation.gs` | `HRMS_MODULE_UI_FILES_.ats` | Lazy-load ATS in main shell |
| `ui/Scripts.html` | Routes / nav group | Main shell routing |
| `foundation/SchemaService.gs` | Call `AtsSchemaService.ensureSheets` | ATS sheets on full DB setup |

No other shared-file edits are required. Until those land, use `?ats=app` + `apiAtsEnsureSchema` after the `doGet` hook.
