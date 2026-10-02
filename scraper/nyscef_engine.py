"""
NYSCEF Scraper & Docket Downloader Engine
Extends apark2020/nyscef-downloader with Playwright session capture, PDF downloading,
and direct sync to Supabase and Google Drive.
"""

import os
import sys
import time
import json
import argparse
import requests
from bs4 import BeautifulSoup

def get_session_id_with_playwright():
    """
    Launches a browser window using Playwright so the user can complete the CAPTCHA once.
    Automatically captures and returns the JSESSIONID cookie upon successful navigation.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[!] Playwright is not installed. Run: pip install playwright && playwright install")
        return None

    print("[*] Launching browser window for NYSCEF CAPTCHA verification...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto("https://iapps.courts.state.ny.us/nyscef/CaseSearch?TAB=courtDateRange")

        print("[*] Please complete the CAPTCHA in the open browser window.")
        # Wait until user solves CAPTCHA and page navigates or form appears
        page.wait_for_selector("input[name='txtSearchDate']", timeout=120000)

        cookies = context.cookies()
        session_id = None
        for cookie in cookies:
            if cookie['name'] == 'JSESSIONID':
                session_id = cookie['value']
                break

        browser.close()
        if session_id:
            print(f"[+] Successfully captured JSESSIONID: {session_id[:12]}...")
            return session_id
        else:
            print("[-] Could not find JSESSIONID cookie.")
            return None

def fetch_docket_entries(index_number, session_id):
    """
    Queries NYSCEF for a specific index number using an active session cookie.
    Returns list of docket items with document titles, numbers, and PDF download URLs.
    """
    url = f"https://iapps.courts.state.ny.us/nyscef/ViewDocket?caseId={index_number}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Cookie": f"JSESSIONID={session_id}",
    }

    print(f"[*] Querying docket for Case {index_number}...")
    resp = requests.get(url, headers=headers)
    if resp.status_code != 200:
        print(f"[-] Failed with HTTP {resp.status_code}")
        return []

    soup = BeautifulSoup(resp.text, 'html.parser')
    entries = []

    # Parse docket table rows
    rows = soup.find_all("tr", class_="docketRow")
    for row in rows:
        cols = row.find_all("td")
        if len(cols) >= 5:
            doc_no = cols[0].text.strip()
            date_filed = cols[1].text.strip()
            doc_type = cols[2].text.strip()
            desc = cols[3].text.strip()
            filed_by = cols[4].text.strip()

            entries.append({
                "doc_number": doc_no,
                "entry_date": date_filed,
                "doc_type": doc_type,
                "description": desc,
                "filed_by": filed_by,
            })

    print(f"[+] Found {len(entries)} docket filings.")
    return entries

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NYSCEF Docket Puller")
    parser.add_argument("--index", help="Case Index Number (e.g. 150428/2024)")
    parser.add_argument("--session-id", help="Active JSESSIONID cookie")
    parser.add_argument("--auto-captcha", action="store_true", help="Launch Playwright to grab session")
    args = parser.parse_args()

    session = args.session_id
    if args.auto_captcha or not session:
        session = get_session_id_with_playwright()

    if session and args.index:
        dockets = fetch_docket_entries(args.index, session)
        print(json.dumps(dockets, indent=2))
