# HRMS performance baseline procedure

**Date:** 11 September 2026  
**Purpose:** Enable the **existing** `HrmsPerf` instrumentation on a test/copy environment. Do not add a new profiler. Do not enable this on production unless you need a short diagnostic capture.

No application behavior changes. When timing is off, `_perf` is omitted from API envelopes and Logger stays quiet.

---

## Enable (copy / test deployment only)

### Server (required for `_perf` and Apps Script logs)

1. Open the Apps Script project that points at a **spreadsheet copy**, not production payroll data.
2. Project Settings → Script properties → add:
   - `HRMS_PERF_TIMING` = `1`
3. Save. The flag is read once per execution (`HrmsPerf.enabled()` caches it for that execution only).

To disable: set the property to anything other than `1`, or delete it.

### Browser (client round-trip log)

In the web app console:

```js
HrmsApp.enablePerfTiming();   // localStorage.HRMS_PERF_TIMING=1
```

Disable:

```js
HrmsApp.disablePerfTiming();
```

Console lines look like `HRMS_PERF` with `kind: 'rpc'`, `fn`, `rpcMs`, `perceivedMs`, and `server` (`totalMs`, `openByIdMs`, `getDataRangeMs`, `writeMs`, `counts`).

Dump:

```js
HrmsApp.getPerfLog();
```

### Editor smoke (no deploy)

With the script property set, run:

- `testPerfInvestigation_Smoke()`
- `testStartupPerf_Smoke()`
- Optionally `testPerfInvestigation_MarkAsRead()` (can mark one unread inbox row)

---

## What `_perf` already records

Attached by `hrmsRun_` on `{ ok, data }` only (or the error envelope). Business `data` is unchanged.

| Field | Meaning |
| --- | --- |
| `requestId` | Correlation id |
| `api` | Inferred `api*` name from stack |
| `totalMs` | Whole handler |
| `sessionMs` | `AuthService.resolveSession` |
| `permissionMs` | `PermissionService.require` |
| `openByIdMs` | Spreadsheet open (0 on handle cache hit) |
| `sheetLookupMs` | `getSheetByName` |
| `getDataRangeMs` | Full-sheet / header reads |
| `writeMs` | `setValues` / `appendRow` |
| `serializeMs` | JSON.stringify probe |
| `counts` | `openById`, `getDataRange`, `setValues`, cache hits, `sheetReads`, `writes` |

No PII, OTPs, tokens, or sheet cell values are logged.

---

## Workflows to capture

Walk each flow once as a real user. After each, copy the matching `HRMS_PERF` rpc lines (or `getPerfLog()`).

| Workflow | APIs to record | Notes |
| --- | --- | --- |
| Login / bootstrap | `apiGetAppBootstrap` | Identity cache hit vs miss (wait 16s to miss) |
| Dashboard first paint | `apiGetHomeDashboard` | Primary cards only |
| Dashboard secondary | `apiGetHomeDashboardMore` | After primary paint |
| Employee directory | `apiGetEmployeeDirectory` | Search keystrokes if still undebounced |
| Employee profile | `apiGetEmployee` plus extras | Count extra RPCs for leave/docs/payslips/access |
| Leave apply | `apiLeaveGetTypes`, `apiLeaveListEmployees`, `apiLeaveGetMyLeave` | Count parallel RPCs |
| Leave preview | `apiLeavePreviewDays` | Rapid date changes |
| Leave submit | `apiLeaveSubmit` | Lock + writes |
| Payroll home | `apiListPayrollRuns`, `apiGetPayrollRun` | `getPayrollRun` may take script lock (eligible sync) |
| Payroll save | `apiSavePayrollInputs` | Expect `setValues` count to drop after Phase 1 |
| Payroll calculate | `apiCalculatePayroll` | Expect no `deleteRow` storm after Phase 1 |
| Payroll LOP | `apiRefreshPayrollLop` / `apiApplyPayrollLeaveLop` | Batch writes after Phase 1 |
| Payslips | `apiRegeneratePayslips` | Drive + Documents writes |
| PMS dashboard | `apiPmsGetDashboard` | |
| ATS home / job | `apiAtsGetBootstrap`, `apiAtsGetJob` | |
| Notification bell | `apiGetUnreadNotificationCount`, `apiGetNotificationBellState` | Poll vs open |
| Ask HR | `apiAskHr` | External AI time dominates; still record RPC count |

---

## How to compare before / after

For each captured API, record:

- `totalMs`
- `openByIdMs` (should stay ~1 open per RPC)
- `counts.setValues` / `counts.appendRow`
- `counts.getDataRange`
- Client `rpcMs` and number of RPCs for the page load

Do **not** treat a single run as a benchmark. Capture 3 times on the same copy after a reload (first execution is colder).

---

## Safety

- Timing is off by default. Production stays quiet.
- `_perf` is diagnostic metadata on the envelope, not part of business contracts.
- Prefer a **spreadsheet copy** for payroll calculate / payslip captures.
- Turn the script property off when the capture is done.
