#!/usr/bin/env python3
"""
Build AyurCentral HRMS user manual HTML from a clasp JSON export (files[]).
Usage: python scripts/build-user-manual-from-export.py <export.json> [output.html]
"""
import html
import json
import re
import sys
from pathlib import Path

CSS = """
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 11pt; line-height: 1.55; color: #1a1a1a; max-width: 210mm; margin: 0 auto; padding: 12mm 10mm; }
h1 { font-size: 22pt; color: #0d47a1; margin: 0 0 6px; }
h2 { font-size: 14pt; color: #1565c0; margin: 22px 0 8px; border-bottom: 2px solid #e3f2fd; padding-bottom: 4px; page-break-after: avoid; }
h3 { font-size: 12pt; color: #333; margin: 14px 0 6px; page-break-after: avoid; }
p, li { margin: 0 0 8px; }
ul, ol { margin: 0 0 12px; padding-left: 22px; }
.cover { text-align: center; padding: 40px 20px 50px; page-break-after: always; }
.cover .brand { font-size: 28pt; font-weight: 700; color: #0d47a1; }
.cover .sub { font-size: 14pt; color: #555; margin-top: 8px; }
.cover .meta { margin-top: 48px; font-size: 10pt; color: #666; }
.toc { page-break-after: always; }
table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 10px 0 16px; }
th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #e3f2fd; }
.tip { background: #f5f9ff; border-left: 4px solid #1976d2; padding: 10px 12px; margin: 12px 0; font-size: 10.5pt; }
.page-break { page-break-before: always; }
footer { margin-top: 32px; font-size: 9pt; color: #888; text-align: center; border-top: 1px solid #ddd; padding-top: 10px; }
code { font-size: 10pt; }
"""


def load_files(export_path: Path) -> dict[str, str]:
    data = json.loads(export_path.read_text(encoding="utf-8"))
    return {f["name"]: f.get("source", "") for f in data["files"]}


def find_source(files: dict[str, str], suffix: str) -> str:
    for name, src in files.items():
        if name.endswith(suffix) or name == suffix:
            return src
    return ""


def parse_nav_items(perm_src: str) -> list[dict]:
    m = re.search(r"var NAV_ITEMS_ = \[([\s\S]*?)\];", perm_src)
    if not m:
        return []
    items = []
    for block in re.findall(r"\{[^{}]+\}", m.group(1)):
        id_ = re.search(r"id:\s*'([^']+)'", block)
        label = re.search(r"label:\s*'([^']+)'", block)
        route = re.search(r"route:\s*'([^']+)'", block)
        roles = re.search(r"roles:\s*\[([^\]]+)\]", block)
        placeholder = "placeholder: true" in block
        if not (id_ and label and route):
            continue
        role_list = re.findall(r"'([^']+)'", roles.group(1)) if roles else []
        items.append({
            "id": id_.group(1),
            "label": label.group(1),
            "route": route.group(1),
            "roles": role_list,
            "placeholder": placeholder,
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
        if not (gid and label and routes):
            continue
        groups.append({
            "id": gid.group(1),
            "label": label.group(1),
            "routes": re.findall(r"'([^']+)'", routes.group(1)),
        })
    return groups


def parse_route_meta(scripts_src: str) -> tuple[dict, dict]:
    titles = {}
    ledes = {}
    mt = re.search(r"var ROUTE_TITLES = \{([\s\S]*?)\};", scripts_src)
    if mt:
        titles = dict(re.findall(r"'([^']+)':\s*'((?:\\'|[^'])*)'", mt.group(1)))
    ml = re.search(r"var ROUTE_LEDES = \{([\s\S]*?)\};", scripts_src)
    if ml:
        ledes = dict(re.findall(r"'([^']+)':\s*'((?:\\'|[^'])*)'", ml.group(1)))
    return titles, ledes


def esc(s: str) -> str:
    return html.escape(s or "", quote=True)


def build_html(export_path: Path, export_name: str) -> str:
    files = load_files(export_path)
    perm = find_source(files, "PermissionService")
    scripts = find_source(files, "ui/Scripts")
    index_html = find_source(files, "ui/Index")
    settings = find_source(files, "SettingsClient")
    emf = find_source(files, "EmployeeMandatoryFieldsClient")
    efd = find_source(files, "EmployeeFieldDefsClient")
    bulk = find_source(files, "EmployeeBulkService")

    nav_items = parse_nav_items(perm)
    nav_by_route = {i["route"]: i for i in nav_items}
    groups = parse_nav_groups(scripts)
    titles, ledes = parse_route_meta(scripts)

    verticals = []
    const_src = find_source(files, "Constants")
    vm = re.search(r"HRMS\.VERTICALS\s*=\s*\[([^\]]+)\]", const_src)
    if vm:
        verticals = re.findall(r"'([^']+)'", vm.group(1))

    id_format = "SAPL-0001, AOPL-0001, AOMS-0001" if "SAPL" in bulk else "as per your company format"

    settings_sections = re.findall(r"<h2>([^<]+)</h2>", settings)
    settings_sections = [s.replace("&amp;", "&") for s in settings_sections]

    has_ask_hr = "ask-hr" in index_html.lower() or "Ask HR" in index_html
    has_mandatory = bool(emf)
    has_field_defs = bool(efd)
    users_placeholder = any(i.get("placeholder") for i in nav_items if i["route"] == "users")

    parts = [
        "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'/>",
        "<title>AyurCentral HRMS - User Manual</title><style>", CSS, "</style></head><body>",
        "<div class='cover'><div class='brand'>AyurCentral HRMS</div>",
        "<div class='sub'>Enterprise Human Resource Management System</div>",
        "<p style='margin-top:36px;font-size:16pt;font-weight:600'>User Manual</p>",
        "<p>For Admin, HR, Manager, and Employee users</p>",
        "<div class='meta'>Built from your Apps Script export<br/>",
        esc(export_name), "<br/>Simple English</div></div>",
        "<div class='toc'><h2>Contents</h2><ol>",
        "<li>About this app</li><li>Sign in</li><li>Roles</li><li>Menu map</li>",
        "<li>Admin guide</li><li>HR guide</li><li>Manager guide</li><li>Employee guide</li>",
        "<li>Screen-by-screen reference</li><li>Help and tips</li></ol></div>",
        "<h2>1. About this app</h2>",
        "<p>AyurCentral HRMS is a web app you open in a browser. You sign in with your Google account. ",
        "The app helps your company manage people, leave, attendance, payroll, and recruitment.</p>",
        "<p>This manual matches the code in your export file (not a generic branch). ",
        "It lists ", str(len(nav_items)), " menu items and ", str(len(files)), " project files.</p>",
    ]

    if verticals:
        parts.append("<p><strong>Company verticals in this build:</strong> " + esc(", ".join(verticals)) + ".</p>")

    parts += [
        "<h2>2. Sign in</h2><ol>",
        "<li>Open the HRMS web app link from your IT or HR team (URL ends with <code>/exec</code>).</li>",
        "<li>Sign in with your work Google email.</li>",
        "<li>If you see access denied, ask Admin to add your user and role.</li>",
        "</ol>",
        "<p><strong>Layout:</strong> menu on the left, your name and notifications on top, main page in the center.",
    ]
    if has_ask_hr:
        parts.append(" Use the <strong>Ask HR</strong> button for help questions when it is on screen.")
    parts.append("</p>")

    parts.append("<h2>3. Roles</h2><table><tr><th>Role</th><th>What they usually do</th></tr>")
    role_help = {
        "EMPLOYEE": "My Profile, My Leave, My Payslips (if enabled).",
        "MANAGER": "Same as employee plus My Team and Leave Approvals.",
        "HR": "Employees, leave admin, attendance, payroll, recruitment, settings.",
        "ADMIN": "Full access including settings; Users menu may be limited.",
        "OWNER": "Full access (same as admin for daily use).",
    }
    for r in ["EMPLOYEE", "MANAGER", "HR", "ADMIN", "OWNER"]:
        parts.append(f"<tr><td><strong>{esc(r)}</strong></td><td>{esc(role_help.get(r, ''))}</td></tr>")
    parts.append("</table>")

    parts.append("<h2>4. Menu map</h2>")
    for g in groups:
        parts.append(f"<h3>{esc(g['label'])}</h3><ul>")
        for route in g["routes"]:
            item = nav_by_route.get(route)
            if not item:
                continue
            lede = ledes.get(route, "")
            roles = ", ".join(item["roles"])
            ph = " (coming soon)" if item.get("placeholder") else ""
            parts.append(
                f"<li><strong>{esc(item['label'])}</strong>{ph} - roles: {esc(roles)}. "
                f"{esc(lede)}</li>"
            )
        parts.append("</ul>")

    parts.append("<div class='page-break'></div><h2>5. Admin guide</h2>")
    parts.append("<h3>Settings</h3><p>Open <strong>System - Settings</strong>. Sections in your build:</p><ul>")
    for s in settings_sections:
        parts.append(f"<li>{esc(s)}</li>")
    parts.append("</ul>")
    parts.append(
        "<p>Use <strong>HRMS module access by role</strong> to show or hide menu areas per role. "
        "Use <strong>New login defaults</strong> for documents, payslips, and leave self-service. "
        "Click Save at the bottom. Ask users to refresh the browser after changes.</p>"
    )
    if users_placeholder:
        parts.append("<div class='tip'><strong>Users</strong> menu is marked coming soon in this build. Roles are still set through your user setup process.</div>")

    parts.append("<h2>6. HR guide</h2>")
    parts.append("<h3>Employees</h3><ul>")
    parts.append("<li>Search and filter the directory; open a row for the full profile.</li>")
    parts.append("<li><strong>Add employee</strong> - one person at a time. Fields with a red star are required.</li>")
    parts.append("<li><strong>Bulk upload</strong> - import many rows from Excel or CSV template.</li>")
    if has_field_defs:
        parts.append("<li><strong>Custom fields</strong> - add extra columns for profiles and bulk upload.</li>")
    if has_mandatory:
        parts.append("<li><strong>Mandatory fields</strong> - choose which fields are required on create and bulk upload.</li>")
    parts.append(f"<li>Employee codes in bulk upload use format like: {esc(id_format)}.</li>")
    parts.append("</ul>")

    parts.append("<h3>Leave</h3><p><strong>Leave</strong> (admin) for company requests and leave types. <strong>Leave Approvals</strong> for pending decisions.</p>")
    parts.append("<h3>Attendance</h3><p><strong>Register</strong> - monthly attendance bulk upload. <strong>Form T</strong> - Form T Excel export by vertical.</p>")
    parts.append("<h3>Payroll</h3><p><strong>Salary structure</strong> templates, <strong>Salary Statement</strong> reports, <strong>Payroll</strong> monthly run (calculate, finalize, payslips).</p>")
    parts.append("<h3>Recruitment</h3><p><strong>Recruitment</strong>, <strong>Jobs</strong>, and <strong>Candidates</strong> for hiring workflow.</p>")

    parts.append("<h2>7. Manager guide</h2><ul>")
    parts.append("<li><strong>My Team</strong> - view direct reports.</li>")
    parts.append("<li><strong>Leave Approvals</strong> - approve or reject team leave.</li>")
    parts.append("<li>Recruitment screens if your Admin enabled them for managers.</li></ul>")

    parts.append("<h2>8. Employee guide</h2><ul>")
    parts.append("<li><strong>My Profile</strong> - your record and allowed documents.</li>")
    parts.append("<li><strong>My Leave</strong> - balances and apply for leave.</li>")
    parts.append("<li><strong>My Payslips</strong> - download payslips when your role allows.</li></ul>")

    parts.append("<div class='page-break'></div><h2>9. Screen-by-screen reference</h2>")
    parts.append("<p>Short description for each route defined in your app:</p><table>")
    parts.append("<tr><th>Menu / screen</th><th>What it does</th></tr>")
    for item in nav_items:
        route = item["route"]
        lede = ledes.get(route, titles.get(route, ""))
        parts.append(f"<tr><td>{esc(item['label'])}</td><td>{esc(lede)}</td></tr>")
    for route, title in sorted(titles.items()):
        if route in nav_by_route:
            continue
        lede = ledes.get(route, "")
        parts.append(f"<tr><td>{esc(title)} (sub-page)</td><td>{esc(lede)}</td></tr>")
    parts.append("</table>")

    parts.append("<h2>10. Help and tips</h2><ul>")
    parts.append("<li>After an app update, press Ctrl+Shift+R once for a hard refresh.</li>")
    parts.append("<li>Wait for the Save button to finish; do not double-click.</li>")
    parts.append("<li>Bulk upload errors often mean wrong employee code, duplicate email, or missing required columns.</li>")
    parts.append("<li>For company policy (how much leave, pay dates), follow your HR policy - this manual is only for the software.</li>")
    parts.append("</ul>")

    parts.append(
        f"<footer>Generated from Apps Script export: {esc(export_name)}. "
        "AyurCentral HRMS - internal use.</footer></body></html>"
    )
    return "".join(parts)


def main():
    if len(sys.argv) < 2:
        print("Usage: build-user-manual-from-export.py <export.json> [out.html]", file=sys.stderr)
        sys.exit(1)
    export_path = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("docs/user-manual/AyurCentral_HRMS_User_Manual.html")
    html_doc = build_html(export_path, export_path.name)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html_doc, encoding="utf-8")
    print("Wrote", out)


if __name__ == "__main__":
    main()
