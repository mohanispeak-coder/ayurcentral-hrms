#!/usr/bin/env python3
"""
Build a detailed AyurCentral HRMS user manual from a clasp JSON export.
Usage: python scripts/build-user-manual-from-export.py <export.json> [output.html]
"""
import html
import json
import re
import sys
from pathlib import Path

CSS = """
@page { size: A4; margin: 16mm 14mm 18mm 14mm; }
body { font-family: Cambria, "Times New Roman", Georgia, serif; font-size: 11pt; line-height: 1.55; color: #1a1a1a; }
h1 { font-family: Cambria, "Times New Roman", Georgia, serif; font-size: 18pt; color: #0d47a1; margin: 0 0 10px; page-break-after: avoid; }
h2 { font-family: Cambria, "Times New Roman", Georgia, serif; font-size: 14pt; color: #1565c0; margin: 22px 0 10px; border-bottom: 1px solid #b0c4de; padding-bottom: 4px; page-break-after: avoid; }
h3 { font-family: Cambria, "Times New Roman", Georgia, serif; font-size: 12pt; color: #222; margin: 16px 0 8px; page-break-after: avoid; }
h4 { font-family: Cambria, "Times New Roman", Georgia, serif; font-size: 11pt; font-weight: bold; color: #333; margin: 12px 0 6px; page-break-after: avoid; }
p { margin: 0 0 8px; }
ul, ol { margin: 0 0 10px; padding-left: 20px; }
li { margin-bottom: 4px; }
.cover { text-align: center; padding: 36px 16px 44px; page-break-after: always; }
.cover .brand { font-size: 26pt; font-weight: 700; color: #0d47a1; }
.cover .sub { font-size: 13pt; color: #555; margin-top: 6px; }
.cover .meta { margin-top: 40px; font-size: 9.5pt; color: #666; }
.toc { page-break-after: always; }
.toc ol { line-height: 1.65; }
table.data { width: 100%; border-collapse: collapse; font-size: 11pt; margin: 8px 0 14px; }
table.data th, table.data td { border: 1px solid #bbb; padding: 5px 7px; vertical-align: top; }
table.data th { background: #e3f2fd; font-weight: 600; }
.tip { background: #f5f9ff; border-left: 4px solid #1976d2; padding: 8px 10px; margin: 10px 0; font-size: 10pt; }
.warn { background: #fff8e6; border-left: 4px solid #f9a825; padding: 8px 10px; margin: 10px 0; font-size: 10pt; }
.page-break { page-break-before: always; }
.steps { counter-reset: step; list-style: none; padding-left: 0; }
.steps li { counter-increment: step; margin-bottom: 8px; padding-left: 28px; position: relative; }
.steps li::before { content: counter(step); position: absolute; left: 0; font-weight: 700; color: #1565c0; }
footer { margin-top: 24px; font-size: 8.5pt; color: #777; text-align: center; border-top: 1px solid #ddd; padding-top: 8px; }
"""


def esc(s: str) -> str:
    return html.escape(s or "", quote=True)


def roles_plain(roles: list[str]) -> str:
    labels = []
    for r in roles:
        r = r.upper()
        if r == "EMPLOYEE":
            labels.append("All staff")
        elif r == "MANAGER":
            labels.append("Managers")
        elif r == "HR":
            labels.append("HR team")
        elif r == "ADMIN":
            labels.append("Admin")
        elif r == "OWNER":
            labels.append("Owner")
        else:
            labels.append(r)
    return ", ".join(labels)


def load_files(export_path: Path) -> dict[str, str]:
    return {f["name"]: f.get("source", "") for f in json.loads(export_path.read_text(encoding="utf-8"))["files"]}


def find_source(files: dict[str, str], needle: str, prefer: list[str] | None = None) -> str:
    prefer = prefer or []
    for p in prefer:
        for name, src in files.items():
            if name == p or name.endswith("/" + p) or name.endswith(p):
                return src
    for name, src in files.items():
        if needle in name:
            return src
    return ""


def parse_nav_items(perm_src: str) -> list[dict]:
    m = re.search(r"var NAV_ITEMS_ = \[([\s\S]*?)\n  \];", perm_src)
    if not m:
        m = re.search(r"var NAV_ITEMS_ = \[([\s\S]*?)\];", perm_src)
    if not m:
        return []
    items = []
    for block in re.findall(r"\{[^{}]+\}", m.group(1)):
        id_ = re.search(r"id:\s*'([^']+)'", block)
        label = re.search(r"label:\s*'([^']+)'", block)
        route = re.search(r"route:\s*'([^']+)'", block)
        roles = re.search(r"roles:\s*\[([^\]]+)\]", block)
        if not (id_ and label and route):
            continue
        items.append({
            "id": id_.group(1),
            "label": label.group(1),
            "route": route.group(1),
            "roles": re.findall(r"'([^']+)'", roles.group(1)) if roles else [],
            "placeholder": "placeholder: true" in block,
        })
    return items


def parse_nav_groups(scripts_src: str) -> list[dict]:
    m = re.search(r"var NAV_GROUPS = \[([\s\S]*?)\];", scripts_src)
    if not m:
        return []
    groups = []
    for block in re.findall(r"\{[^{}]+\}", m.group(1)):
        gid = re.search(r"id:\s*'([^']+)'", block)
        label = re.search(r"label:\s*'([^']+)'", block)
        routes = re.search(r"routes:\s*\[([^\]]+)\]", block)
        if gid and label and routes:
            groups.append({
                "id": gid.group(1),
                "label": label.group(1),
                "routes": re.findall(r"'([^']+)'", routes.group(1)),
            })
    return groups


def parse_route_meta(scripts_src: str) -> tuple[dict, dict]:
    titles, ledes = {}, {}
    mt = re.search(r"var ROUTE_TITLES = \{([\s\S]*?)\};", scripts_src)
    if mt:
        titles = dict(re.findall(r"'([^']+)':\s*'((?:\\'|[^'])*)'", mt.group(1)))
    ml = re.search(r"var ROUTE_LEDES = \{([\s\S]*?)\};", scripts_src)
    if ml:
        ledes = dict(re.findall(r"'([^']+)':\s*'((?:\\'|[^'])*)'", ml.group(1)))
    return titles, ledes


def extract_mandatory_fields(emf_src: str) -> dict[str, list[tuple[str, str, str]]]:
    groups: dict[str, list[tuple[str, str, str]]] = {}
    pat = re.compile(
        r"id: '([^']+)', label: '([^']+)', group: '([^']+)'"
        r"(?:[^}]*?)defaultMandatory: (true|false)"
    )
    for m in pat.finditer(emf_src):
        g = m.group(3)
        groups.setdefault(g, []).append((m.group(2), m.group(1), m.group(4)))
    return groups


def extract_bulk_columns(bulk_src: str) -> list[str]:
    m = re.search(r"var HEADERS_ = \[([\s\S]*?)\];", bulk_src)
    return re.findall(r"'([^']+)'", m.group(1)) if m else []


def extract_bulk_instructions(bulk_src: str) -> list[str]:
    lines = []
    for m in re.finditer(r"base\.push\(\['([^']*)'\]\)", bulk_src):
        t = m.group(1).strip()
        if t:
            lines.append(t)
    for m in re.finditer(r"lines\.push\(\[([^\]]+)\]\)", bulk_src):
        pass
    # instructionLines_ string pushes
    fn = re.search(r"function instructionLines_\([\s\S]*?return base;", bulk_src)
    if fn:
        for m in re.finditer(r"\['([^']*(?:\\.[^']*)*)'\]", fn.group(0)):
            t = m.group(1).replace("\\'", "'").strip()
            if t and not t.startswith("Template version"):
                lines.append(t)
    # dedupe preserve order
    seen = set()
    out = []
    for L in lines:
        if L not in seen:
            seen.add(L)
            out.append(L)
    return out


def extract_employment_types(emp_svc: str) -> list[str]:
    m = re.search(r"EMPLOYMENT_TYPES_\s*=\s*\[([^\]]+)\]", emp_svc)
    return re.findall(r"'([^']+)'", m.group(1)) if m else ["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT"]


def build_html(export_path: Path) -> str:
    files = load_files(export_path)
    export_name = export_path.name
    perm = find_source(files, "PermissionService", prefer=["foundation/PermissionService"])
    scripts = find_source(files, "Scripts", prefer=["ui/Scripts"])
    index_html = find_source(files, "ui/Index")
    settings = find_source(files, "SettingsClient")
    emf_svc = find_source(files, "EmployeeMandatoryFieldService")
    emf_ui = find_source(files, "EmployeeMandatoryFieldsClient")
    efd = find_source(files, "EmployeeFieldDefsClient")
    bulk = find_source(files, "EmployeeBulkService")
    emp_client = find_source(files, "EmployeeClient")
    att_client = find_source(files, "AttendanceClient")
    att_bulk = find_source(files, "AttendanceBulkService")
    pay = find_source(files, "PayrollClient")
    form_t = find_source(files, "FormTClient")
    sal_stmt = find_source(files, "SalaryStatementClient")
    sal_struct = find_source(files, "SalaryStructureClient")
    ats = find_source(files, "AtsClient")
    leave_ui = find_source(files, "LeaveUi") or find_source(files, "LeaveClient")
    notif = find_source(files, "NotificationClient")
    const = find_source(files, "Constants")

    nav_items = parse_nav_items(perm)
    nav_by_route = {i["route"]: i for i in nav_items}
    groups = parse_nav_groups(scripts)
    titles, ledes = parse_route_meta(scripts)
    mandatory_groups = extract_mandatory_fields(emf_svc)
    bulk_cols = extract_bulk_columns(bulk)
    bulk_instr = extract_bulk_instructions(bulk)
    emp_types = extract_employment_types(find_source(files, "EmployeeService"))

    verticals = []
    vm = re.search(r"VERTICALS\s*=\s*\[([^\]]+)\]", const)
    if vm:
        verticals = re.findall(r"'([^']+)'", vm.group(1))

    has_ask_hr = "ask-hr" in index_html.lower() or "Ask HR" in index_html
    users_placeholder = any(i.get("placeholder") for i in nav_items if i["route"] == "users")

    settings_sections = [s.replace("&amp;", "&") for s in re.findall(r"<h2>([^<]+)</h2>", settings)]

    parts: list[str] = []
    parts.append(f"<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'/><title>AyurCentral HRMS User Manual</title><style>{CSS}</style></head><body>")

    # Cover
    parts.append("<div class='cover'><div class='brand'>AyurCentral HRMS</div>")
    parts.append("<div class='sub'>Detailed User Manual</div>")
    parts.append("<p style='margin-top:28px;font-size:15pt;font-weight:600'>For Admin, HR, Manager, and Employee</p>")
    parts.append("</div>")

    # TOC
    parts.append("<div class='toc'><h2>Table of contents</h2><ol>")
    toc = [
        "1. Introduction", "2. Sign in and daily use", "3. Roles and access",
        "4. Menu and screens", "5. Admin: Settings and system",
        "6. HR: Employee records", "6.1 Add one employee", "6.2 Employee profile",
        "6.3 Bulk upload", "6.4 Mandatory fields", "6.5 Custom fields",
        "7. HR: Leave", "8. HR: Attendance (Register and Form T)",
        "9. HR: Payroll and salary", "10. HR: Recruitment (ATS)",
        "11. Manager tasks", "12. Employee self-service",
        "13. Notifications", "14. Troubleshooting",
        "Appendix A: Bulk upload columns", "Appendix B: Mandatory field catalog",
        "Appendix C: Attendance day codes", "Appendix D: Full route list",
    ]
    for t in toc:
        parts.append(f"<li>{esc(t)}</li>")
    parts.append("</ol></div>")

    # Dashboard
    dash_lede = "Summary cards and shortcuts for your role."
    parts.append("<h2>1. Introduction</h2>")
    parts.append("<h3>Dashboard (Main → Dashboard)</h3>")
    parts.append("<p>The dashboard is the home page after sign-in. It shows counts and shortcuts based on your role (for example leave approvals for managers, payroll status for HR, your employee ID for staff). Use the sidebar to go to detailed screens.</p>")
    parts.append("<p>AyurCentral HRMS is a browser-based Human Resource Management System. Your company uses it to keep employee records, process leave, record attendance, run payroll, and manage hiring.</p>")
    parts.append("<p>This manual is written in simple English. It was built by reading your actual Apps Script project export, so it matches the screens and labels in your deployed app.</p>")
    if verticals:
        parts.append(f"<p><strong>Verticals in your build:</strong> {esc(', '.join(verticals))}. Employee codes often start with these prefixes (for example SAPL-0001).</p>")
    parts.append("<h3>What you need</h3><ul>")
    parts.append("<li>A computer or phone with a modern browser (Chrome recommended).</li>")
    parts.append("<li>Your company Google account (work email).</li>")
    parts.append("<li>The HRMS web app URL from IT or HR (usually ends with <code>/exec</code>).</li>")
    parts.append("</ul>")

    # 2 Sign in
    parts.append("<h2>2. Sign in and daily use</h2>")
    parts.append("<h3>2.1 First visit</h3><ol class='steps'>")
    parts.append("<li>Open the HRMS link in your browser.</li>")
    parts.append("<li>Choose your Google work account when Google asks you to sign in.</li>")
    parts.append("<li>Wait for the dashboard to load. The left side shows the menu.</li>")
    parts.append("<li>If you see an error about access, your login is not set up yet. Contact Admin or HR.</li>")
    parts.append("</ol>")
    parts.append("<h3>2.2 Parts of the screen</h3><ul>")
    parts.append("<li><strong>Sidebar (left):</strong> Sections such as Main, My Work, People, Time Off, Attendance, Payroll, Recruitment, System. Click a section name to expand or collapse it.</li>")
    parts.append("<li><strong>Top bar:</strong> Page title, notification bell, your name and role, Sign out.</li>")
    parts.append("<li><strong>Main page:</strong> Forms, tables, and buttons for the task you selected.</li>")
    parts.append("<li><strong>Refresh:</strong> Many pages have a refresh control to reload data from the server.</li>")
    if has_ask_hr:
        parts.append("<li><strong>Ask HR:</strong> Floating help button to ask HR questions (when enabled).</li>")
    parts.append("</ul>")
    parts.append("<h3>2.3 Sign out</h3><p>Always click <strong>Sign out</strong> when you finish on a shared computer.</p>")
    parts.append("<h3>2.4 After an app update</h3><p>Press <strong>Ctrl+Shift+R</strong> (Windows) or <strong>Cmd+Shift+R</strong> (Mac) once to hard refresh if menus or buttons look old.</p>")

    # 3 Roles
    parts.append("<div class='page-break'></div><h2>3. Roles and access</h2>")
    parts.append("<p>Each user has a <strong>role</strong>. The role controls which menu items appear.</p>")
    parts.append("<table class='data'><tr><th>Role</th><th>Typical access</th></tr>")
    role_rows = [
        ("EMPLOYEE", "Dashboard; My Work (profile, leave, payslips if enabled). Cannot open company employee list or payroll admin."),
        ("MANAGER", "Everything Employee has, plus My Team and Leave Approvals. May see Recruitment if Admin allows."),
        ("HR", "People, leave admin, attendance, payroll, recruitment, notifications, settings (no full owner powers)."),
        ("ADMIN", "Same as HR plus full settings; Users screen may show 'coming soon' in this build."),
        ("OWNER", "Full access to all modules. Module checkboxes in Settings do not limit OWNER."),
    ]
    for r, d in role_rows:
        parts.append(f"<tr><td><strong>{esc(r)}</strong></td><td>{esc(d)}</td></tr>")
    parts.append("</table>")
    parts.append("<div class='tip'>Admin can change which modules each role sees under <strong>System → Settings → HRMS module access by role</strong>. If a menu is missing, ask Admin before reporting a bug.</div>")

    # 4 Menu
    parts.append("<h2>4. Menu and screens</h2>")
    parts.append(
        "<p>The left menu is split into sections. Open a section to see pages inside it. "
        "The table below lists each page, who normally uses it, and what it is for.</p>"
    )
    for g in groups:
        parts.append(f"<h3>{esc(g['label'])}</h3><table class='data'><tr><th>Screen</th><th>Who can open it</th><th>What you do here</th></tr>")
        rows = 0
        for route in g["routes"]:
            item = nav_by_route.get(route)
            if not item:
                title = titles.get(route, route.replace("-", " ").title())
                lede = ledes.get(route, "Open from another screen in this section.")
                parts.append(
                    f"<tr><td>{esc(title)}</td><td>See HR or Admin</td><td>{esc(lede)}</td></tr>"
                )
                rows += 1
                continue
            lede = ledes.get(route, titles.get(route, ""))
            if not lede:
                lede = "Use this page for " + item["label"].lower() + " tasks."
            ph = " (coming soon)" if item.get("placeholder") else ""
            parts.append(
                f"<tr><td>{esc(item['label'])}{ph}</td>"
                f"<td>{esc(roles_plain(item['roles']))}</td>"
                f"<td>{esc(lede)}</td></tr>"
            )
            rows += 1
        if rows == 0:
            parts.append("<tr><td colspan='3'>No pages listed for this section in your app export.</td></tr>")
        parts.append("</table>")

    # 5 Admin Settings
    parts.append("<div class='page-break'></div><h2>5. Admin: Settings and system</h2>")
    parts.append("<p>Go to <strong>System → Settings</strong>. Only HR and Admin roles see this in your export.</p>")
    for sec in settings_sections:
        parts.append(f"<h3>{esc(sec)}</h3>")
        if "module access" in sec.lower():
            parts.append("<p>This table lists modules (Dashboard, Employees, Payroll, Attendance, etc.) against roles Employee, Manager, HR, Admin. Check a box to allow that role to see and use the module in the sidebar.</p>")
            parts.append("<ol class='steps'><li>Change checkboxes as needed.</li><li>Scroll down and click <strong>Save settings</strong>.</li><li>Tell affected users to refresh the browser.</li></ol>")
        elif "login defaults" in sec.lower():
            parts.append("<p>Sets default self-service rights when a new login is created: download documents, upload documents, payslips, leave. You can still change per employee later.</p>")
        elif "email" in sec.lower() or "welcome" in sec.lower():
            parts.append("<p>Turn email notifications on or off (leave, payroll, welcome mail, etc.). When off, the system may still log the event under Notifications as SKIPPED.</p>")
        elif "content" in sec.lower() or "template" in sec.lower():
            parts.append("<p>Edit wording for welcome emails, bulk upload help text, and ATS offer letters. Use placeholders shown on the settings page.</p>")
        else:
            parts.append("<p>Configure options shown on this card. Save when finished.</p>")

    parts.append("<h3>Notifications (System → Notifications)</h3>")
    parts.append("<p>HR and Admin can read in-app notifications and review email log entries. Use this to confirm whether emails were sent or skipped.</p>")
    if users_placeholder:
        parts.append("<div class='warn'><strong>Users</strong> menu is marked coming soon in your export. User roles are managed through your existing user setup (spreadsheet / admin process).</div>")

    # 6 HR Employees
    parts.append("<div class='page-break'></div><h2>6. HR: Employee records</h2>")
    parts.append("<p>Open <strong>People → Employees</strong>. You can search by employee ID or name and filter by status, department, location, and vertical.</p>")
    parts.append("<h3>Buttons on the Employees page</h3><ul>")
    parts.append("<li><strong>Mandatory fields</strong> - open the checklist of required fields (if present in your build).</li>")
    parts.append("<li><strong>Custom fields</strong> - define extra columns for profiles and bulk upload.</li>")
    parts.append("<li><strong>Bulk upload</strong> - import many employees from Excel or CSV.</li>")
    parts.append("<li><strong>Add employee</strong> - create one employee.</li>")
    parts.append("<li><strong>Refresh</strong> - reload the directory list.</li>")
    parts.append("</ul>")

    emp_form_fields = re.findall(r"fieldGroup\('([^']+)',\s*'([^']+)'", emp_client)
    unique_fields: list[tuple[str, str]] = []
    if emp_form_fields:
        seen_f = set()
        for fid, lab in emp_form_fields:
            if fid not in seen_f:
                seen_f.add(fid)
                unique_fields.append((fid, lab))

    parts.append("<h3>6.1 Add one employee</h3><ol class='steps'>")
    parts.append("<li>Click <strong>Add employee</strong>.</li>")
    parts.append("<li>Fill every field that has a red star (*). Stars follow your Mandatory fields settings.</li>")
    parts.append("<li>Employee code must match your format (for example SAPL-0001, AOPL-0001, AOMS-0001).</li>")
    parts.append(f"<li>Employment type is usually one of: {esc(', '.join(emp_types))}.</li>")
    parts.append("<li>Choose the correct <strong>vertical</strong> for the employee.</li>")
    parts.append("<li>Bank: if you enter account number, IFSC is usually required (unless Mandatory fields say otherwise).</li>")
    parts.append("<li>Click save. Fix any red error messages and try again.</li>")
    parts.append("</ol>")

    parts.append("<h3>6.2 Employee profile</h3>")
    parts.append("<p>Click a row in the directory to open the profile. Your build includes these areas:</p><ul>")
    for panel in ["Personal", "Employment", "Payroll", "Documents", "Payslips", "Access"]:
        if panel in emp_client:
            parts.append(f"<li><strong>{panel}</strong> - edit or view details in this section (HR permissions apply).</li>")
    parts.append("</ul>")
    parts.append("<p>HR can upload documents, change status (active/inactive), send welcome email, and manage app login access from the profile where those buttons appear.</p>")
    if unique_fields:
        parts.append("<h4>Fields on the employee form (your build)</h4>")
        parts.append("<table class='data'><tr><th>Field</th><th>Label on screen</th></tr>")
        for fid, lab in unique_fields:
            parts.append(f"<tr><td><code>{esc(fid)}</code></td><td>{esc(lab)}</td></tr>")
        parts.append("</table>")
        parts.append("<p>Payroll fields include UAN, ESI, PF, PAN, bank details, salary structure, and monthly CTC. Statutory numbers may be optional unless Mandatory fields require them.</p>")

    parts.append("<h3>6.3 Bulk upload</h3>")
    parts.append("<ol class='steps'>")
    parts.append("<li>From Employees, open <strong>Bulk upload</strong>.</li>")
    parts.append("<li>Download the template (new hire or legacy/existing employee variant).</li>")
    parts.append("<li>Fill one row per employee. Do not rename header columns.</li>")
    parts.append("<li>Upload the file. Wait for validation.</li>")
    parts.append("<li>Review errors per row. Fix the file and re-upload if needed.</li>")
    parts.append("<li>Confirm import only when all rows you need are valid.</li>")
    parts.append("</ol>")
    if bulk_instr:
        parts.append("<h4>Rules printed in your template</h4><ul>")
        for line in bulk_instr:
            parts.append(f"<li>{esc(line)}</li>")
        parts.append("</ul>")
    parts.append("<div class='warn'>Maximum rows per upload is limited in software (commonly 100). Split large files if needed.</div>")

    if emf_ui:
        parts.append("<h3>6.4 Mandatory fields</h3>")
        parts.append("<p>Path: <strong>People → Mandatory fields</strong> or the button on Employees.</p>")
        parts.append("<ol class='steps'>")
        parts.append("<li>Review fields grouped by Identity, Contact, Work, Payroll, Bank, etc.</li>")
        parts.append("<li>Tick <strong>Mandatory</strong> for fields that must be filled on create and bulk upload.</li>")
        parts.append("<li>Employee code cannot be turned off.</li>")
        parts.append("<li>Click <strong>Save</strong>. The page reloads so forms and templates match.</li>")
        parts.append("</ol>")
        parts.append("<p>After save, single employee forms show red stars on required fields. Bulk templates mark required columns with * in the header row.</p>")

    if efd:
        parts.append("<h3>6.5 Custom fields</h3>")
        parts.append("<ol class='steps'>")
        parts.append("<li>Open <strong>Custom fields</strong> from Employees.</li>")
        parts.append("<li>Enter field key (lowercase, underscores, e.g. blood_group) and label.</li>")
        parts.append("<li>Mark Active if the field should appear on forms and bulk template.</li>")
        parts.append("<li>Save. New columns appear on bulk upload after save.</li>")
        parts.append("</ol>")

    # 7 Leave
    parts.append("<div class='page-break'></div><h2>7. HR: Leave</h2>")
    parts.append("<h3>7.1 Leave administration (Time Off → Leave)</h3>")
    parts.append("<p>" + esc(ledes.get("leave-admin", "Company leave requests and leave types.")) + "</p>")
    parts.append("<p>HR uses this area to:</p><ul>")
    parts.append("<li>Configure leave types (annual, sick, etc. as your company set up).</li>")
    parts.append("<li>View and manage employee leave requests and balances.</li>")
    parts.append("<li>Support corrections according to company policy.</li>")
    parts.append("</ul>")
    parts.append("<h3>7.2 Leave approvals (Time Off → Leave Approvals)</h3>")
    parts.append("<p>" + esc(ledes.get("leave-approvals", "Pending requests.")) + "</p>")
    parts.append("<ol class='steps'>")
    parts.append("<li>Open Leave Approvals.</li>")
    parts.append("<li>Select a pending request.</li>")
    parts.append("<li>Approve or reject. Add a comment if your process requires it.</li>")
    parts.append("<li>Employee and manager may receive email if toggles are on in Settings.</li>")
    parts.append("</ol>")
    parts.append("<h3>7.3 Employee leave apply (for reference)</h3>")
    parts.append("<p>Employees use <strong>My Leave → Apply</strong>. " + esc(ledes.get("leave-apply", "")) + "</p>")

    # 8 Attendance
    parts.append("<h2>8. HR: Attendance</h2>")
    parts.append("<h3>8.1 Register (Attendance → Register)</h3>")
    parts.append("<p>" + esc(ledes.get("attendance-bulk-upload", "")) + "</p>")
    parts.append("<ol class='steps'>")
    parts.append("<li>Select payroll month and vertical if the screen asks.</li>")
    parts.append("<li>Download the attendance template.</li>")
    parts.append("<li>Enter one attendance code per day for each employee.</li>")
    parts.append("<li>Upload the file and review validation messages.</li>")
    parts.append("<li>Confirm when data is correct.</li>")
    parts.append("</ol>")
    parts.append("<h3>8.2 Form T (Attendance → Form T)</h3>")
    parts.append("<p>" + esc(ledes.get("attendance-form-t", "")) + "</p>")
    parts.append("<p>Choose payroll period and vertical, then generate or download the Form T Excel export as per your statutory process.</p>")

    # 9 Payroll
    parts.append("<div class='page-break'></div><h2>9. HR: Payroll and salary</h2>")
    parts.append("<h3>9.1 Salary structure</h3>")
    parts.append("<p>" + esc(ledes.get("salary-structure", "")) + "</p>")
    parts.append("<p>Create templates with earning/deduction components. Assign a structure and monthly CTC on the employee profile for payroll to work.</p>")
    parts.append("<h3>9.2 Salary Statement</h3>")
    parts.append("<p>" + esc(ledes.get("salary-statement", "")) + "</p>")
    parts.append("<h3>9.3 Payroll run (Payroll → Payroll)</h3>")
    parts.append("<p>" + esc(ledes.get("payroll-run", ledes.get("payroll", ""))) + "</p>")
    parts.append("<p>Typical monthly flow:</p><ol class='steps'>")
    parts.append("<li>Open the payroll month you need.</li>")
    parts.append("<li>Sync or load employees for that run.</li>")
    parts.append("<li>Enter or import attendance / LOP adjustments if your process uses them.</li>")
    parts.append("<li>Save inputs.</li>")
    parts.append("<li>Calculate payroll and review amounts.</li>")
    parts.append("<li>Fix errors (missing bank, structure, etc.) before finalize.</li>")
    parts.append("<li>Finalize or lock the run when numbers are approved.</li>")
    parts.append("<li>Generate payslips. Employees see them under My Payslips when enabled.</li>")
    parts.append("</ol>")
    parts.append("<div class='tip'>Locked payroll amounts do not change. Use correction run features in the app if your build includes them.</div>")

    # 10 ATS
    parts.append("<h2>10. HR: Recruitment (ATS)</h2>")
    parts.append("<p>Menus: <strong>Recruitment</strong>, <strong>Jobs</strong>, <strong>Candidates</strong>.</p><ul>")
    parts.append("<li><strong>Jobs</strong> - " + esc(ledes.get("ats-jobs", "Create and publish jobs.")) + "</li>")
    parts.append("<li><strong>Candidates</strong> - " + esc(ledes.get("ats-candidates", "Applicant list.")) + "</li>")
    parts.append("<li>Job detail pages support pipeline stages, interviews, and public apply links.</li>")
    parts.append("<li>Hired candidates are not automatic employees; create them in Employees when they join.</li>")
    parts.append("</ul>")

    # 11 Manager
    parts.append("<div class='page-break'></div><h2>11. Manager tasks</h2><ul>")
    parts.append("<li><strong>My Team</strong> - " + esc(ledes.get("my-team", "")) + "</li>")
    parts.append("<li><strong>Leave Approvals</strong> - act on team leave requests promptly.</li>")
    parts.append("<li><strong>My Leave / My Profile / My Payslips</strong> - same as any employee.</li>")
    parts.append("<li>Recruitment screens if Admin enabled Manager access.</li>")
    parts.append("</ul>")

    # 12 Employee
    parts.append("<h2>12. Employee self-service</h2>")
    parts.append("<h3>12.1 My Profile</h3><p>" + esc(ledes.get("my-profile", "")) + "</p>")
    parts.append("<h3>12.2 My Leave</h3><p>" + esc(ledes.get("my-leave", "")) + "</p>")
    parts.append("<ol class='steps'>")
    parts.append("<li>Check balance for the leave year shown.</li>")
    parts.append("<li>Click apply, pick dates and leave type.</li>")
    parts.append("<li>Submit and wait for approval.</li>")
    parts.append("<li>Track status under your request list.</li>")
    parts.append("</ol>")
    parts.append("<h3>12.3 My Payslips</h3><p>" + esc(ledes.get("my-payslips", "")) + "</p>")

    # 13 Notifications
    parts.append("<h2>13. Notifications</h2>")
    parts.append("<p>Use the bell icon for unread items. HR/Admin can open the Notifications page for full history and email log.</p>")

    # 14 Troubleshooting
    parts.append("<h2>14. Troubleshooting</h2><table class='data'><tr><th>Problem</th><th>What to do</th></tr>")
    troubles = [
        ("Cannot sign in", "Confirm Google account; ask Admin to add user with correct role."),
        ("Menu item missing", "Admin: check Settings → module access for your role."),
        ("Save does not update screen", "Hard refresh (Ctrl+Shift+R). Wait for save spinner to finish."),
        ("Bulk upload errors", "Check employee code format, duplicate emails, required * columns, date format YYYY-MM-DD."),
        ("Payroll will not finalize", "Complete bank details, salary structure, CTC; read error message on screen."),
        ("No payslip", "Payroll must be finalized; Admin must allow payslips for your role in Settings."),
    ]
    for prob, fix in troubles:
        parts.append(f"<tr><td>{esc(prob)}</td><td>{esc(fix)}</td></tr>")
    parts.append("</table>")

    # Appendix A
    parts.append("<div class='page-break'></div><h2>Appendix A: Bulk upload columns</h2>")
    parts.append("<p>Columns in the employee bulk template in your export:</p>")
    parts.append("<table class='data'><tr><th>#</th><th>Column name</th><th>Notes</th></tr>")
    notes_map = {
        "employee_id": "Required. Company format e.g. SAPL-0001.",
        "create_login": "YES or NO for Google login on import.",
        "google_login_email": "Required when create_login is YES.",
        "joining_date": "YYYY-MM-DD.",
        "vertical_name": "Must match company vertical list.",
        "employment_type": ", ".join(emp_types),
    }
    for i, col in enumerate(bulk_cols, 1):
        parts.append(f"<tr><td>{i}</td><td><code>{esc(col)}</code></td><td>{esc(notes_map.get(col, 'See mandatory fields; may be optional.'))}</td></tr>")
    parts.append("</table>")

    # Appendix B
    parts.append("<h2>Appendix B: Mandatory field catalog</h2>")
    if mandatory_groups:
        for gname, fields in mandatory_groups.items():
            parts.append(f"<h3>{esc(gname)}</h3><table class='data'><tr><th>Label</th><th>Field id</th><th>Default mandatory</th></tr>")
            for label, fid, def_m in fields:
                parts.append(f"<tr><td>{esc(label)}</td><td><code>{esc(fid)}</code></td><td>{'Yes' if def_m == 'true' else 'No'}</td></tr>")
            parts.append("</table>")
    else:
        parts.append("<p>Mandatory field service not found in export.</p>")

    # Appendix C Attendance codes
    parts.append("<h2>Appendix C: Attendance day codes</h2>")
    parts.append("<p>Use one code per day in the Register upload:</p><table class='data'>")
    parts.append("<tr><th>Code</th><th>Meaning</th></tr>")
    codes = [
        ("P", "Present"),
        ("W/H or WH", "Work from home"),
        ("A", "Absent"),
        ("L", "Leave"),
        ("WO", "Weekly off"),
        ("ML", "Maternity leave (legacy import may use S)"),
        ("H", "Holiday"),
    ]
    for c, m in codes:
        parts.append(f"<tr><td><strong>{esc(c)}</strong></td><td>{esc(m)}</td></tr>")
    parts.append("</table>")

    # Appendix D routes
    parts.append("<h2>Appendix D: Full route list</h2><table class='data'><tr><th>Route id</th><th>Title</th><th>Description</th></tr>")
    all_routes = sorted(set(list(titles.keys()) + list(ledes.keys())))
    for route in all_routes:
        parts.append(
            f"<tr><td><code>{esc(route)}</code></td>"
            f"<td>{esc(titles.get(route, ''))}</td>"
            f"<td>{esc(ledes.get(route, ''))}</td></tr>"
        )
    parts.append("</table>")

    parts.append("<footer>AyurCentral HRMS - internal use.</footer></body></html>")
    return "".join(parts)


def main():
    if len(sys.argv) < 2:
        print("Usage: build-user-manual-from-export.py <export.json> [out.html]", file=sys.stderr)
        sys.exit(1)
    export_path = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("docs/user-manual/AyurCentral_HRMS_User_Manual.html")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build_html(export_path), encoding="utf-8")
    print("Wrote", out, "chars", out.stat().st_size)


if __name__ == "__main__":
    main()
