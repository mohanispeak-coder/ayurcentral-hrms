#!/usr/bin/env python3
"""Build HRMS_FULL_DOCUMENTATION.html and .pdf from markdown."""
import pathlib
import subprocess
import sys

import markdown

ROOT = pathlib.Path(__file__).resolve().parent
MD = ROOT / "HRMS_FULL_DOCUMENTATION.md"
HTML = ROOT / "HRMS_FULL_DOCUMENTATION.html"
PDF = ROOT / "HRMS_FULL_DOCUMENTATION.pdf"

CSS = """
@page { margin: 18mm 14mm; }
body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 11pt; line-height: 1.45; color: #1e293b; max-width: 210mm; margin: 0 auto; padding: 12px; }
h1 { font-size: 22pt; border-bottom: 2px solid #0f766e; padding-bottom: 8px; color: #0f766e; }
h2 { font-size: 14pt; margin-top: 1.4em; color: #134e4a; page-break-after: avoid; }
h3 { font-size: 12pt; margin-top: 1em; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.5pt; }
th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f1f5f9; font-weight: 600; }
tr:nth-child(even) td { background: #f8fafc; }
code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 9pt; }
hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.5em 0; }
ul { margin: 0.4em 0; }
p { margin: 0.5em 0; }
"""

def main():
    md_text = MD.read_text(encoding="utf-8")
    body = markdown.markdown(md_text, extensions=["tables", "fenced_code"])
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AyurCentral HRMS — Full Documentation</title>
<style>{CSS}</style>
</head>
<body>
{body}
</body>
</html>"""
    HTML.write_text(html, encoding="utf-8")
    chrome = "/usr/local/bin/google-chrome"
    user_data = ROOT / ".chrome-pdf-profile"
    user_data.mkdir(exist_ok=True)
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        f"--user-data-dir={user_data}",
        f"--print-to-pdf={PDF}",
        HTML.as_uri(),
    ]
    subprocess.run(cmd, check=True, timeout=120)
    print("Wrote", HTML)
    print("Wrote", PDF, f"({PDF.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
