# PMS integration notes

Performance Management is implemented as a **self-contained module** under `apps-script/src/pms/`. Shared foundation files were not edited. Wire the shell in a later pass using the snippets below.

This module does **not** implement ATS or Notifications and does not change Knowledge Hub / Ask HR.

---

## What already works without shared-file edits

| Area | Mechanism |
| --- | --- |
| Sheet names | `PmsConstants.gs` sets `HRMS.SHEETS.PERFORMANCE_*` (does not edit `Constants.gs`) |
| Schema | `PmsSchemaService.ensure()` creates sheets/headers and seeds the default rating scale on first PMS API call |
| RBAC | `PmsPermissionService` requires `ACCESS_APP`, then enforces PMS actions with `PmsEngine.can` |
| Nav items | Runtime wrap of `PermissionService.getNavForRole` appends PMS routes (no edit to `PermissionService.gs`) |
| Module UI allowlist | Runtime assignment `HRMS_MODULE_UI_FILES_.pms = ['pms/PmsClient']` (no edit to `ApiFoundation.gs`) |
| APIs | `google.script.run` discovers `apiPms*` and `apiGetPmsModuleUi` automatically |
| Menu helper | Run `menuEnsurePmsSchema` from the Apps Script editor (optional later `onOpen` hook) |

Until the **Scripts.html** snippet is applied, sidebar PMS items may appear (from the nav wrap) but the route still shows the generic “Not available yet” placeholder. That is expected.

---

## Required later-pass: `apps-script/src/ui/Scripts.html`

Add PMS to the lazy-load maps (only change needed for the UI to render).

**1. `ROUTE_MODULE`**

```javascript
pms: 'pms',
'pms-cycles': 'pms',
'pms-cycle': 'pms',
'pms-my-review': 'pms',
'pms-team': 'pms',
'pms-review': 'pms',
'pms-appraisal': 'pms'
```

**2. `ROUTE_TITLES`**

```javascript
pms: 'Performance',
'pms-cycles': 'Review cycles',
'pms-cycle': 'Review cycle',
'pms-my-review': 'My review',
'pms-team': 'Team reviews',
'pms-review': 'Review',
'pms-appraisal': 'Appraisals'
```

**3. `ROUTE_LEDES`**

```javascript
pms: 'Goals, self-assessment, and reviews for the current cycle.',
'pms-cycles': 'Create a cycle, then add goals before you open it.',
'pms-cycle': 'Assign goals, then move the cycle forward.',
'pms-my-review': 'Update progress and comments, then submit.',
'pms-team': 'People assigned to you in the current cycles.',
'pms-review': 'Self-assessment, manager ratings, and final appraisal.',
'pms-appraisal': 'Finalize ratings after managers submit.'
```

**4. Optional `NAV_GROUPS`** (otherwise PMS items land in the leftover group)

```javascript
{ id: 'pms', label: 'Performance', routes: ['pms', 'pms-my-review', 'pms-team', 'pms-cycles', 'pms-appraisal'] }
```

**5. Optional `isNavRouteActive`**

```javascript
if (itemRoute === 'pms' && (current === 'pms-cycle' || current === 'pms-review')) return true;
if (itemRoute === 'pms-cycles' && current === 'pms-cycle') return true;
if (itemRoute === 'pms-team' && current === 'pms-review') return true;
if (itemRoute === 'pms-appraisal' && current === 'pms-review') return true;
```

**6. Optional pending shell** in `paintPendingModuleShell` — a KPI-row skeleton is enough; PMS paints its own header after load.

`ensureModule('pms')` already calls `apiGetModuleUi`. After the allowlist adapter runs, that returns `pms/PmsClient`. Fallback API if you prefer an explicit call: `apiGetPmsModuleUi`.

Do **not** change `Index.html` or `Styles.html`. PMS reuses existing tokens (page header, KPI cards, stepper, tables, badges, modals).

---

## Optional later-pass: `PermissionService.gs`

Not required. The runtime wrap already appends:

| Route | Roles |
| --- | --- |
| `pms` | ADMIN, HR, MANAGER, EMPLOYEE |
| `pms-cycles` | ADMIN, HR |
| `pms-my-review` | ADMIN, HR, MANAGER, EMPLOYEE |
| `pms-team` | ADMIN, HR, MANAGER |
| `pms-appraisal` | ADMIN, HR |

If you prefer a static nav list instead of a wrap, copy `HRMS.PMS.NAV` from `PmsConstants.gs` into `NAV_ITEMS_` and remove the wrap in `PmsPermissionService.installNav`.

PMS does **not** add keys to `HRMS.ACTIONS` in `Constants.gs`. Actions live on `HRMS.PMS.ACTIONS`.

---

## Optional later-pass: `SchemaService.gs`

Not required for operation. First PMS API creates sheets. To include PMS in **Run database setup**:

```javascript
// inside SchemaService.setupDatabase, after core sheets:
if (typeof PmsSchemaService !== 'undefined' && PmsSchemaService.ensure) {
  PmsSchemaService.ensure();
}
```

Optional `onOpen` in `Main.gs`:

```javascript
.addItem('Ensure PMS sheets', 'menuEnsurePmsSchema')
```

---

## Optional later-pass: `Constants.gs`

Not required. Equivalents already set from `PmsConstants.gs`:

- `HRMS.SHEETS.PERFORMANCE_CYCLES` → `PerformanceCycles`
- `HRMS.SHEETS.PERFORMANCE_GOALS` → `PerformanceGoals`
- `HRMS.SHEETS.PERFORMANCE_REVIEWS` → `PerformanceReviews`
- `HRMS.SHEETS.PERFORMANCE_RATINGS` → `PerformanceRatings`

---

## Database (module-owned)

Person key is always **`employee_id`**. IDs use `DbService.generateId` (`PCY`, `PGL`, `PRV`, `PRT`) — no new Settings sequences.

### PerformanceCycles

`cycle_id`, `name`, `start_date`, `end_date`, `status`, `submission_deadline`, `review_deadline`, `notes`, `created_at`, `created_by_email`, `updated_at`, `updated_by_email`

Status lifecycle (invalid jumps rejected):

`DRAFT` → `OPEN` → `EMPLOYEE_SUBMITTED` → `MANAGER_REVIEW` → `FINALIZED` → `CLOSED`

Allowed reopen edges: `OPEN` → `DRAFT` (no submissions yet), `EMPLOYEE_SUBMITTED` → `OPEN`, `MANAGER_REVIEW` → `EMPLOYEE_SUBMITTED`.

### PerformanceGoals

`goal_id`, `cycle_id`, `employee_id`, `title`, `description`, `measurement`, `target`, `weight`, `status`, `progress`, `achievement`, `employee_comments`, `manager_comments`, `employee_rating`, `manager_rating`, timestamps.

Active (non-`CANCELLED`) weights per employee per cycle must sum to **100** before self-submit or manager-submit.

### PerformanceReviews

One row per `cycle_id` + `employee_id`.

`review_id`, `cycle_id`, `employee_id`, `manager_employee_id`, `status`, comment fields, `overall_rating` (server computed), `final_rating` (HR), `reopen_allowed`, submission timestamps.

Review status: `NOT_STARTED` → `IN_PROGRESS` → `SELF_SUBMITTED` → `MANAGER_SUBMITTED` → `FINALIZED`.

### PerformanceRatings

Configurable scale (`scale_code` = `DEFAULT`). Seeded if empty:

1 Needs Significant Improvement … 5 Exceptional.

Callers must use the stored scale — labels are not hard-coded in workflow logic.

---

## APIs (`ApiPms.gs`)

All wrapped in `hrmsRun_` with session token last (same as payroll).

| Function | Access |
| --- | --- |
| `apiGetPmsModuleUi` | Any signed-in user (`ACCESS_APP`) |
| `apiPmsGetContext` / `apiPmsGetDashboard` / `apiPmsListCycles` | All PMS roles (scoped data) |
| `apiPmsCreateCycle` / `Update` / `Transition` | HR, ADMIN |
| `apiPmsCreateGoal` / `UpdateGoal` / `DeleteGoal` | HR, ADMIN; managers for direct reports |
| `apiPmsGetReview` | Owner, manager of owner, HR, ADMIN |
| `apiPmsSaveSelfAssessment` / `SubmitSelfAssessment` | Owner only |
| `apiPmsSaveManagerReview` / `SubmitManagerReview` | Manager of employee, HR, ADMIN (not self) |
| `apiPmsFinalizeReview` / `ListAppraisals` / `ReopenSelfAssessment` | HR, ADMIN |
| `apiPmsSaveRatingScale` | HR, ADMIN |
| `apiPmsEnsureSchema` | HR, ADMIN |

Client `overall_rating` / `final_rating` are not trusted for computation. Submit uses server state + engine rules. Duplicate submit returns a conflict.

---

## RBAC

| Role | Capabilities |
| --- | --- |
| ADMIN | Full PMS admin (cycles, goals, ratings, finalize, reopen) |
| HR | Same operational access as ADMIN for PMS |
| MANAGER | Direct reports only (`Employees.manager_employee_id`); cannot review self |
| EMPLOYEE | Own goals and self-assessment only |

Authorization is server-side. Hiding UI is not sufficient.

---

## Audit

`AuditService.log` on create/update/transition, goal CUD, self/manager save & submit, reopen, finalize, rating-scale save. Summaries are short (ids + status). No comments, ratings dump, PAN, bank, OTP, or secrets.

---

## Tests

| Suite | How to run |
| --- | --- |
| Engine + RBAC (local) | `node tests/pms-engine.test.js` |
| Apps Script | `testPms_All` in the editor (engine always; schema ensure if spreadsheet ID is set) |

Apps Script tests were **not** executed in this pass (no clasp / no deploy). Local Node PMS tests **were** run.

---

## Known limitations

- Shell routes need the Scripts.html maps before screens render (see above).
- PMS sheets are created lazily; they are not part of `SchemaService.getSchemaInfo()` until that optional hook is added (`TestFoundation` still expects 14 core sheets).
- No email notifications (Notifications module is out of scope).
- No Drive artefacts for appraisals.
- Manager scope is **direct reports only**, not a recursive org tree.
- Cycle-level status is HR-driven; it does not auto-advance when every employee submits.
- `OPEN` → `DRAFT` is blocked once any self-assessment is submitted.
- Warm Apps Script containers skip repeated schema header checks within one execution only.

---

## Shared files that still require a later pass

| File | Required? | Change |
| --- | --- | --- |
| `ui/Scripts.html` | **Yes, for UI** | Route/module maps (and optional nav group) |
| `foundation/ApiFoundation.gs` | No | Allowlist patched at runtime |
| `foundation/PermissionService.gs` | No | Nav wrapped at runtime |
| `foundation/SchemaService.gs` | No | Lazy ensure on PMS APIs |
| `foundation/Constants.gs` | No | Sheet names set in `PmsConstants.gs` |
| `foundation/Main.gs` | No | Optional menu item |
| `ui/Index.html`, `ui/Styles.html` | No | Do not change |
| Employee / Leave / Payroll / Ask HR | No | Do not change |
