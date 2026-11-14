#!/usr/bin/env python3
"""Live smoke check for the deployed Lab Rax planner.

Usage: python3 tools/smoke.py [base_url]
Default base URL: http://192.168.1.193:5173

Opens a shared build (12U, 5+5+2 split, long joiner) and checks the split
buttons, the joiner model select, and that the page raised no console or
page errors. Prints PASS/FAIL per check and exits 1 on any failure.
"""

import base64
import json
import os
import sys

from playwright.sync_api import sync_playwright

DEFAULT_BASE = "http://192.168.1.193:5173"
CHROME = os.path.expanduser("~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome")
LAUNCH_ARGS = ["--use-gl=angle", "--use-angle=swiftshader"]
SPLIT_LABELS = ["5+5+2", "5+4+3", "4+4+4"]


def build_share_param() -> str:
    payload = json.dumps({"u": 12, "g": [5, 5, 2], "j": "long"}).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BASE
    url = f"{base}/?b={build_share_param()}"

    results: list[tuple[str, bool, str]] = []
    console_errors: list[str] = []
    page_errors: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, ok, detail))
        status = "PASS" if ok else "FAIL"
        suffix = f" ({detail})" if detail else ""
        print(f"{status}: {name}{suffix}")

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=LAUNCH_ARGS)
        try:
            page = browser.new_page()
            page.on(
                "console",
                lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
            )
            page.on("pageerror", lambda exc: page_errors.append(str(exc)))

            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(8000)

            for label in SPLIT_LABELS:
                count = page.get_by_role("button", name=label, exact=True).count()
                check(f"split button '{label}' present once", count == 1, f"count={count}")

            pressed = page.get_by_role("button", name="5+5+2", exact=True).first.get_attribute(
                "aria-pressed"
            )
            check("split 5+5+2 is pressed", pressed == "true", f"aria-pressed={pressed}")

            select_values = page.locator("select").evaluate_all(
                "els => els.map(e => e.value)"
            )
            check("a <select> has value 'long'", "long" in select_values, f"values={select_values}")

            check("no console errors", not console_errors, "; ".join(console_errors[:3]))
            check("no page errors", not page_errors, "; ".join(page_errors[:3]))
        finally:
            browser.close()

    failed = [name for name, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
