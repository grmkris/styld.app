"""Publish only this document's freshly built static assets to its Pages project."""

import json
import os
import subprocess
import tempfile
from pathlib import Path

from build import build

ROOT = Path(__file__).resolve().parent
config = json.loads((ROOT / "deployment.json").read_text())
release = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
environment = {**os.environ, "CLOUDFLARE_ACCOUNT_ID": config["accountId"], "WRANGLER_SEND_METRICS": "false"}

with tempfile.TemporaryDirectory(prefix="styld-review-pages-") as directory:
    destination = Path(directory)
    build(destination)
    # A fresh directory contains no source recordings, tooling, app assets or browser-test artifacts.
    subprocess.run([
        "bunx", "--bun", f"wrangler@{config['wranglerVersion']}",
        "pages", "deploy", str(destination),
        "--project-name", config["project"], "--branch", config["branch"],
        "--commit-hash", release, "--commit-message", "Update Eva product review",
    ], cwd=destination, env=environment, check=True)
print(f"Shared document: {config['url']}")
