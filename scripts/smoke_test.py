#!/usr/bin/env python3
"""
scripts/smoke_test.py
ConceptLens Deployment Smoke Test Suite

Runs an end-to-end smoke test against local or deployed ConceptLens backend:
- Health check (GET /api/health)
- Register test user (POST /api/auth/register)
- Login & verify session (POST /api/auth/login, GET /api/auth/me)
- Upload Text file, Text PDF, and Image (POST /api/documents)
- Poll until done (GET /api/documents/{id}/status)
- Fetch concepts (GET /api/documents/{id}/concepts)
- Fetch concept tree (GET /api/documents/{id}/tree)
- Fetch flowchart (GET /api/documents/{id}/flowchart)
- Export concepts (GET /api/documents/{id}/export?format=json & format=markdown)
- Logout (POST /api/auth/logout)

Usage:
    python scripts/smoke_test.py
    python scripts/smoke_test.py --base-url https://your-backend.onrender.com
    python scripts/smoke_test.py --base-url http://127.0.0.1:8000 --timeout 60
"""

import sys
import os
import time
import uuid
import argparse
import json
from pathlib import Path
import requests

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

def parse_args():
    parser = argparse.ArgumentParser(description="ConceptLens Deployment Smoke Test")
    parser.add_argument(
        "--base-url",
        default=os.getenv("CONCEPTLENS_BASE_URL", "http://127.0.0.1:8000"),
        help="Base URL of ConceptLens backend (default: http://127.0.0.1:8000)"
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="Max seconds to wait for document processing per file (default: 120s)"
    )
    parser.add_argument(
        "--keep-user",
        action="store_true",
        help="Do not delete the test user after tests finish"
    )
    return parser.parse_args()


class SmokeTestRunner:
    def __init__(self, base_url: str, max_timeout: int = 120):
        self.base_url = base_url.rstrip("/")
        self.max_timeout = max_timeout
        self.session = requests.Session()
        # Set origin header so CSRF checks pass if testing cross-origin
        self.origin = self.base_url
        self.session.headers.update({
            "Origin": self.origin,
            "User-Agent": "ConceptLens-SmokeTest/1.0"
        })
        self.test_username = f"smoke_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        self.test_password = "SmokeTestPassword123!"
        self.uploaded_doc_ids = []
        self.passed_steps = 0
        self.failed_steps = 0

    def log(self, tag: str, message: str):
        print(f"[{tag}] {message}")

    def pass_step(self, step_name: str, detail: str = ""):
        self.passed_steps += 1
        print(f"  [PASS] {step_name} {f'({detail})' if detail else ''}")

    def fail_step(self, step_name: str, error: str):
        self.failed_steps += 1
        print(f"  [FAIL] {step_name} -> {error}")

    def test_health(self) -> bool:
        self.log("STEP 1", "Checking GET /api/health...")
        try:
            res = self.session.get(f"{self.base_url}/api/health", timeout=15)
            if res.status_code == 200:
                data = res.json()
                self.pass_step("Health check", f"status={data.get('status')}, ocr={data.get('ocr_engine')}")
                return True
            else:
                self.fail_step("Health check", f"HTTP {res.status_code}: {res.text}")
                return False
        except Exception as e:
            self.fail_step("Health check", f"Connection error: {e}")
            return False

    def test_register(self) -> bool:
        self.log("STEP 2", f"Registering test user '{self.test_username}'...")
        payload = {
            "username": self.test_username,
            "password": self.test_password,
            "display_name": "Smoke Test Runner"
        }
        try:
            res = self.session.post(f"{self.base_url}/api/auth/register", json=payload, timeout=15)
            if res.status_code in (200, 201):
                data = res.json()
                self.pass_step("User registration", f"User ID: {data.get('id')}")
                return True
            else:
                self.fail_step("User registration", f"HTTP {res.status_code}: {res.text}")
                return False
        except Exception as e:
            self.fail_step("User registration", str(e))
            return False

    def test_login(self) -> bool:
        self.log("STEP 3", f"Logging in as '{self.test_username}'...")
        payload = {
            "username": self.test_username,
            "password": self.test_password
        }
        try:
            res = self.session.post(f"{self.base_url}/api/auth/login", json=payload, timeout=15)
            if res.status_code == 200:
                # Also verify GET /api/auth/me
                me_res = self.session.get(f"{self.base_url}/api/auth/me", timeout=10)
                if me_res.status_code == 200 and me_res.json().get("username") == self.test_username:
                    self.pass_step("User login & session verification", f"Cookie set, verified via /auth/me")
                    return True
                else:
                    self.fail_step("User login", f"/auth/me check failed: HTTP {me_res.status_code}")
                    return False
            else:
                self.fail_step("User login", f"HTTP {res.status_code}: {res.text}")
                return False
        except Exception as e:
            self.fail_step("User login", str(e))
            return False

    def upload_and_wait(self, file_path: Path, label: str) -> str:
        self.log("UPLOAD", f"Uploading {label} from {file_path.name}...")
        if not file_path.exists():
            self.fail_step(f"Upload {label}", f"File not found: {file_path}")
            return ""

        try:
            with open(file_path, "rb") as fp:
                files = {"file": (file_path.name, fp, "application/octet-stream")}
                data = {"extraction_mode": "cloud"}
                res = self.session.post(f"{self.base_url}/api/documents", files=files, data=data, timeout=30)

            if res.status_code not in (200, 201):
                self.fail_step(f"Upload {label}", f"HTTP {res.status_code}: {res.text}")
                return ""

            resp_data = res.json()
            doc_id = resp_data.get("id")
            if not doc_id:
                self.fail_step(f"Upload {label}", f"No document ID returned: {resp_data}")
                return ""

            self.uploaded_doc_ids.append(doc_id)
            self.pass_step(f"Upload {label} initiated", f"Doc ID: {doc_id}")

            # Polling
            t0 = time.time()
            while time.time() - t0 < self.max_timeout:
                status_res = self.session.get(f"{self.base_url}/api/documents/{doc_id}/status", timeout=10)
                if status_res.status_code == 200:
                    st = status_res.json()
                    status = st.get("status")
                    progress = st.get("progress", 0)
                    msg = st.get("stage_message", "")
                    if status == "completed":
                        duration = time.time() - t0
                        self.pass_step(
                            f"Process {label}",
                            f"Completed in {duration:.1f}s ({st.get('concept_count', 0)} concepts, provider={st.get('provider_used')})"
                        )
                        return doc_id
                    elif status == "failed":
                        self.fail_step(f"Process {label}", f"Failed: {st.get('error')}")
                        return ""
                    else:
                        time.sleep(2)
                else:
                    self.fail_step(f"Poll {label}", f"Status HTTP {status_res.status_code}")
                    return ""

            self.fail_step(f"Process {label}", f"Timed out after {self.max_timeout}s")
            return ""

        except Exception as e:
            self.fail_step(f"Upload {label}", str(e))
            return ""

    def test_fetch_concepts(self, doc_id: str) -> bool:
        self.log("FETCH", f"Fetching concepts for doc {doc_id}...")
        try:
            res = self.session.get(f"{self.base_url}/api/documents/{doc_id}/concepts", timeout=15)
            if res.status_code == 200:
                data = res.json()
                concepts = data.get("concepts", [])
                topics = data.get("topics", [])
                self.pass_step("Fetch concepts", f"{len(concepts)} concepts, {len(topics)} topics")
                return True
            else:
                self.fail_step("Fetch concepts", f"HTTP {res.status_code}: {res.text}")
                return False
        except Exception as e:
            self.fail_step("Fetch concepts", str(e))
            return False

    def test_fetch_tree(self, doc_id: str) -> bool:
        self.log("FETCH", f"Fetching concept tree for doc {doc_id}...")
        try:
            res = self.session.get(f"{self.base_url}/api/documents/{doc_id}/tree", timeout=15)
            if res.status_code == 200:
                data = res.json()
                root = data.get("name") or data.get("id")
                children_count = len(data.get("children", []))
                self.pass_step("Fetch concept tree", f"Root: '{root}', {children_count} top-level branches")
                return True
            else:
                self.fail_step("Fetch concept tree", f"HTTP {res.status_code}: {res.text}")
                return False
        except Exception as e:
            self.fail_step("Fetch concept tree", str(e))
            return False

    def test_fetch_flowchart(self, doc_id: str) -> bool:
        self.log("FETCH", f"Fetching flowchart for doc {doc_id}...")
        try:
            res = self.session.get(f"{self.base_url}/api/documents/{doc_id}/flowchart", timeout=15)
            if res.status_code == 200:
                data = res.json()
                nodes = data.get("nodes", [])
                edges = data.get("edges", [])
                self.pass_step("Fetch flowchart", f"{len(nodes)} nodes, {len(edges)} edges")
                return True
            else:
                self.fail_step("Fetch flowchart", f"HTTP {res.status_code}: {res.text}")
                return False
        except Exception as e:
            self.fail_step("Fetch flowchart", str(e))
            return False

    def test_export(self, doc_id: str) -> bool:
        self.log("EXPORT", f"Testing export for doc {doc_id} (json and markdown)...")
        try:
            # JSON export
            r_json = self.session.get(f"{self.base_url}/api/documents/{doc_id}/export?format=json", timeout=15)
            if r_json.status_code != 200:
                self.fail_step("Export JSON", f"HTTP {r_json.status_code}")
                return False

            # Markdown export
            r_md = self.session.get(f"{self.base_url}/api/documents/{doc_id}/export?format=markdown", timeout=15)
            if r_md.status_code != 200:
                self.fail_step("Export Markdown", f"HTTP {r_md.status_code}")
                return False

            self.pass_step("Export concepts", f"JSON ({len(r_json.content)} bytes) and Markdown ({len(r_md.content)} bytes)")
            return True
        except Exception as e:
            self.fail_step("Export concepts", str(e))
            return False

    def test_logout(self) -> bool:
        self.log("LOGOUT", "Logging out...")
        try:
            res = self.session.post(f"{self.base_url}/api/auth/logout", timeout=10)
            if res.status_code == 200:
                self.pass_step("User logout", "Session cleared successfully")
                return True
            else:
                self.fail_step("User logout", f"HTTP {res.status_code}: {res.text}")
                return False
        except Exception as e:
            self.fail_step("User logout", str(e))
            return False

    def run_all(self, samples_dir: Path) -> bool:
        print("=" * 70)
        print(f"ConceptLens Smoke Test Suite running against: {self.base_url}")
        print("=" * 70)

        # 1. Health
        if not self.test_health():
            return False

        # 2. Register
        if not self.test_register():
            return False

        # 3. Login
        if not self.test_login():
            return False

        # 4. Upload Text file
        txt_path = samples_dir / "physics_quantum_mechanics.txt"
        txt_doc_id = self.upload_and_wait(txt_path, "Text file (.txt)")

        # 5. Upload Text PDF
        pdf_path = samples_dir / "sample_text.pdf"
        pdf_doc_id = self.upload_and_wait(pdf_path, "Text PDF (.pdf)")

        # 6. Upload Image
        img_path = samples_dir / "scanned_notes_neural_networks.png"
        img_doc_id = self.upload_and_wait(img_path, "Image file (.png)")

        # Pick one completed document to test downstream endpoints
        active_doc_id = pdf_doc_id or txt_doc_id or img_doc_id
        if active_doc_id:
            # 7. Concepts
            self.test_fetch_concepts(active_doc_id)
            # 8. Tree
            self.test_fetch_tree(active_doc_id)
            # 9. Flowchart
            self.test_fetch_flowchart(active_doc_id)
            # 10. Export
            self.test_export(active_doc_id)
        else:
            self.fail_step("Downstream endpoints", "No document completed processing")

        # 11. Logout
        self.test_logout()

        print("=" * 70)
        print(f"SMOKE TEST SUMMARY: {self.passed_steps} PASSED, {self.failed_steps} FAILED")
        print("=" * 70)
        return self.failed_steps == 0


def main():
    args = parse_args()
    samples_dir = Path(__file__).resolve().parent.parent / "samples"
    runner = SmokeTestRunner(base_url=args.base_url, max_timeout=args.timeout)
    success = runner.run_all(samples_dir)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
