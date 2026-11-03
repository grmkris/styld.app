"""Build the independent review document. No app resources or APIs are used."""

import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATUSES = {
    "not_started": "Not started",
    "planned": "Planned",
    "in_progress": "In progress",
    "blocked": "Blocked",
    "ready_for_review": "Ready for review",
    "verified": "Verified",
    "deferred": "Deferred",
}


def read(name):
    return json.loads((ROOT / name).read_text())


def esc(value):
    return html.escape(str(value), quote=True)


def plain(value):
    return re.sub(r"[*`]", "", value).replace("\\|", "|")


def validate(review, analysis, progress):
    assert progress["overview"]["label"] and progress["overview"]["note"], "Progress needs an overview"
    finding_ids = [item["id"] for item in review["findings"]]
    ticket_ids = [item["id"] for item in review["tickets"]]
    for ids, prefix in [(finding_ids, "F"), (ticket_ids, "T")]:
        assert ids == [f"{prefix}-{n:02}" for n in range(1, len(ids) + 1)], "Missing or duplicate IDs"
    assert set(analysis["tickets"]) == set(ticket_ids)
    assigned = [id for group in analysis["workstreams"] for id in group["tickets"]]
    assert sorted(assigned) == sorted(ticket_ids), "Each ticket needs one primary workstream"
    assert {id for ticket in review["tickets"] for id in ticket["findings"]} == set(finding_ids)
    for kind, ids in [("tickets", ticket_ids), ("findings", finding_ids)]:
        assert set(progress[kind]) == set(ids), f"Progress IDs do not match {kind}"
        for id, state in progress[kind].items():
            assert state["status"] in STATUSES, f"Invalid status: {id}"
            if state["status"] != "not_started":
                assert state["note"], f"A changed status needs a progress note: {id}"
            if state["status"] == "verified":
                assert state["evidence"] and state["note"], f"Verification needs evidence and a note: {id}"
            for evidence in state["evidence"]:
                assert evidence["level"] in ["unit", "native", "preview", "live_provider", "user_review"]
                assert evidence["summary"] and evidence["date"]
                assert not evidence.get("url") or evidence["url"].startswith("https://")
    for ticket in review["tickets"]:
        criteria = progress["tickets"][ticket["id"]]["criteriaDone"]
        assert len(criteria) == len(set(criteria))
        assert all(isinstance(n, int) and 0 <= n < len(ticket["criteria"]) for n in criteria)
        if progress["tickets"][ticket["id"]]["status"] == "verified":
            assert len(criteria) == len(ticket["criteria"]), f"Unchecked criteria: {ticket['id']}"
        for name in ticket["screenshots"]:
            assert (ROOT / "evidence" / name).is_file(), f"Missing screenshot: {name}"
    combined = json.dumps([review, analysis, progress])
    assert not re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", combined), "Remove personal email addresses"
    assert "file:///" not in combined, "Remove local recording links"


def markdown_batch(values):
    script = "const values = JSON.parse(await Bun.stdin.text()); process.stdout.write(JSON.stringify(values.map(x => Bun.markdown.html(x))));"
    result = subprocess.run(["bun", "-e", script], input=json.dumps(values), text=True, capture_output=True, check=True)
    output = json.loads(result.stdout)
    assert all("<script" not in part.lower() and "javascript:" not in part.lower() for part in output)
    return [part.replace('<img ', '<img loading="lazy" ') for part in output]


def status_badge(state):
    return f'<span class="status" data-status="{state["status"]}">{STATUSES[state["status"]]}</span>'


def links(ids):
    return " ".join(f'<a class="reference" href="#{esc(id)}">{esc(id)}</a>' for id in ids)


def evidence_view(state):
    if not state["evidence"]:
        return '<p class="muted">No acceptance evidence recorded yet.</p>'
    rows = []
    for item in state["evidence"]:
        title = esc(item["summary"])
        if item.get("url"):
            title = f'<a href="{esc(item["url"])}" rel="noreferrer">{title}</a>'
        rows.append(f'<li><strong>{esc(item["level"].replace("_", " "))}</strong> — {title} <time>{esc(item["date"])}</time></li>')
    return '<ul class="evidence-list">' + "".join(rows) + "</ul>"


def options(values):
    return "".join(f'<option value="{esc(value)}">{esc(label)}</option>' for value, label in values)


def filters(name, analysis):
    return f'''<form class="filters" data-controls data-for="{name}" hidden role="search" aria-label="Search {name}">
      <label class="search-field">Search {name}<input name="q" type="search" placeholder="Search by ID, words or feedback" autocomplete="off"></label>
      <label>Workstream<select name="group"><option value="">All workstreams</option>{options((g['id'],g['name']) for g in analysis['workstreams'])}</select></label>
      <label>Status<select name="status"><option value="">Any status</option>{options(STATUSES.items())}</select></label>
      <button type="reset" class="quiet">Reset</button>
    </form><p class="result-count" data-count="{name}" role="status" aria-live="polite"></p>'''


def build(destination):
    review, analysis, progress = read("review.json"), read("analysis.json"), read("progress.json")
    validate(review, analysis, progress)
    groups = {t: group for group in analysis["workstreams"] for t in group["tickets"]}
    related = {f["id"]: [t["id"] for t in review["tickets"] if f["id"] in t["findings"]] for f in review["findings"]}
    rendered = markdown_batch([t["body"] for t in review["tickets"]] + [f[key] for f in review["findings"] for key in ["timestamps", "evidence", "current", "expected"]])
    drafts, field_html = rendered[:len(review["tickets"])], iter(rendered[len(review["tickets"]):])
    tickets = []
    for ticket, draft in zip(review["tickets"], drafts):
        id = ticket["id"]
        note, state, group = analysis["tickets"][id], progress["tickets"][id], groups[id]
        title = esc(note["title"])
        code = "".join(f'<li><code>{esc(path)}</code></li>' for path in note["code"])
        # The original checklist remains provenance; the live checklist below is authoritative.
        criteria = "".join(f'<li><span class="criterion-state">{"Complete" if n in state["criteriaDone"] else "Open"}</span> {markdown_batch([value])[0]}</li>' for n, value in enumerate(ticket["criteria"]))
        checklist = f'<h3>Acceptance checklist</h3><ol class="criteria">{criteria}</ol>' if criteria else '<p class="muted">Acceptance requirements are in the original draft; a tracked checklist can be added during planning.</p>'
        tickets.append(f'''<details class="record" id="{id}" data-record="tickets" data-group="{group['id']}" data-status="{state['status']}">
          <summary><span class="record-id">{id}</span><span class="record-name">{title}</span>{status_badge(state)}<span class="disclosure" aria-hidden="true">+</span></summary>
          <div class="record-body"><div class="record-meta"><span>{esc(group['name'])}</span><span>Effort: {esc(note['effort'])}</span><span>Source priority: {ticket['originalPriority']}</span><a href="#{id}" class="permalink">Link to {id}</a></div>
          <p class="related">Related findings {links(ticket['findings'])}</p>
          <div class="analysis-note"><h3>What the code review adds</h3><p>{esc(note['note'])}</p><details class="code-pointers"><summary>Code pointers</summary><ul>{code}</ul></details></div>
          <div class="progress-note"><h3>Progress</h3><p>{esc(state['note'] or 'Work has not started. This draft is awaiting planning.')}</p><p class="muted">Owner: {esc(state['owner'] or 'Unassigned')}. Updated {esc(state['updatedAt'])}.</p>{evidence_view(state)}</div>
          {checklist}<details class="original"><summary>Read the complete original ticket draft</summary><h3>{esc(plain(ticket['originalTitle']))}</h3><div class="prose">{draft}</div></details></div></details>''')
    findings = []
    for finding in review["findings"]:
        timestamps, quote, current, expected = [next(field_html) for _ in range(4)]
        id, state = finding["id"], progress["findings"][finding["id"]]
        group_ids = " ".join(sorted({groups[t]["id"] for t in related[id]}))
        findings.append(f'''<details class="record" id="{id}" data-record="findings" data-group="{group_ids}" data-status="{state['status']}">
          <summary><span class="record-id">{id}</span><span class="record-name">{esc(plain(finding['title']))}</span>{status_badge(state)}<span class="disclosure" aria-hidden="true">+</span></summary>
          <div class="record-body"><div class="record-meta"><span>{esc(finding['type'])}</span><span>Confidence: {esc(finding['confidence'])}</span><span>Recorded as: {esc(finding['disposition'])}</span><a href="#{id}" class="permalink">Link to {id}</a></div>
          <p class="related">Tickets {links(related[id])}</p><h3>Observed behaviour</h3><div class="prose">{current}</div><h3>Requested behaviour</h3><div class="prose">{expected}</div>
          <details class="original"><summary>Quotes and recording timestamps</summary><div class="prose">{timestamps}<blockquote>{quote}</blockquote></div></details>
          <h3>Progress</h3><p>{esc(state['note'] or 'Awaiting planning and verification.')}</p>{evidence_view(state)}</div></details>''')
    workstreams = []
    for group in analysis["workstreams"]:
        count = sum(progress["tickets"][t]["status"] == "verified" for t in group["tickets"])
        workstreams.append(f'''<a class="workstream" href="?view=tickets&amp;group={group['id']}"><div><h3>{esc(group['name'])}</h3><p>{esc(group['description'])}</p><span class="muted">{len(group['tickets'])} tickets, {count} verified</span></div><span class="stream-open" aria-hidden="true">+</span></a>''')
    captions = {}
    for t in review["tickets"]:
        for alt, filename in re.findall(r"!\[([^\]]*)\]\(\./evidence/([^\)]+)\)", t["body"]):
            captions.setdefault(filename, alt)
    photos = []
    for path in sorted((ROOT / "evidence").glob("*.png")):
        name = path.name
        referenced = [t["id"] for t in review["tickets"] if name in t["screenshots"]]
        caption = captions.get(name, path.stem.replace("_", " "))
        photos.append(f'''<figure><a href="./evidence/{name}" target="_blank" rel="noreferrer" aria-label="Open full screenshot: {esc(caption)}"><img src="./evidence/{name}" alt="{esc(caption)}" loading="lazy" width="540" height="1164"></a><figcaption>{esc(caption)}<div class="related">{links(referenced)}</div></figcaption></figure>''')
    updates = "".join(f'<li><time datetime="{esc(item["date"])}">{esc(item["date"])}</time><div><p>{esc(item["text"])}</p>{links(item["items"])}</div></li>' for item in reversed(progress["updates"]))
    counts = {s: sum(t["status"] == s for t in progress["tickets"].values()) for s in STATUSES}
    script = subprocess.run(["bun", "-e", 'process.stdout.write(new Bun.Transpiler({loader:"ts"}).transformSync(await Bun.stdin.text()))'], input=(ROOT/"client.ts").read_text(), text=True, capture_output=True, check=True).stdout
    substitutions = {
        "TITLE":esc(review["title"]), "UPDATED":esc(progress["updatedAt"]), "COMMIT":esc(analysis["codeCommit"]),
        "FINDING_COUNT":str(len(findings)), "TICKET_COUNT":str(len(tickets)), "IMAGE_COUNT":str(len(photos)),
        "VERIFIED":str(counts["verified"]), "ACTIVE":str(counts["in_progress"]), "READY":str(counts["ready_for_review"]),
        "WORKSTREAMS":"".join(workstreams), "TICKETS":"".join(tickets), "FINDINGS":"".join(findings),
        "TICKET_FILTERS":filters("tickets",analysis), "FINDING_FILTERS":filters("findings",analysis),
        "PHOTOS":"".join(photos), "UPDATES":updates, "BOUNDARY":esc(progress["overview"]["note"]),
        "PHASE":esc(progress["overview"]["label"]),
        "SCRIPT":script,
    }
    document = (ROOT / "template.html").read_text()
    for key,value in substitutions.items():
        document = document.replace("{{"+key+"}}",value)
    assert not re.search(r"\{\{[A-Z_]+\}\}",document), "Unexpanded template value"
    destination.mkdir(parents=True,exist_ok=True)
    (destination/"index.html").write_text(document)
    (destination/"404.html").write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Return to the Styld product review."><link rel="stylesheet" href="/styles.css"><title>Page not found</title><main class="section"><h1>Page not found</h1><p><a href="/">Return to the Styld review</a></p></main></html>')
    shutil.copy2(ROOT/"styles.css",destination/"styles.css")
    for name in ["hanken.woff2", "FONT-LICENSE.txt", "favicon.svg"]:
        shutil.copy2(ROOT/name,destination/name)
    shutil.copytree(ROOT/"evidence",destination/"evidence",dirs_exist_ok=True)
    for name in ["review.json","analysis.json","progress.json"]:
        shutil.copy2(ROOT/name,destination/name)
    digest = hashlib.sha256(script.encode()).digest()
    import base64
    script_hash = base64.b64encode(digest).decode()
    (destination/"_headers").write_text(f'''/*
  X-Robots-Tag: noindex, nofollow, noarchive
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; script-src 'sha256-{script_hash}'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Cache-Control: no-cache
''')
    (destination/"robots.txt").write_text('User-agent: *\nAllow: /\n')
    manifest = {"updatedAt":progress["updatedAt"],"findings":len(findings),"tickets":len(tickets),"screenshots":len(photos),"codeReviewed":analysis["codeCommit"],"sourceDigest":hashlib.sha256((ROOT/"review.json").read_bytes()).hexdigest()}
    (destination/"manifest.json").write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({"output":str(destination),**manifest}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out",type=Path,default=ROOT/"dist")
    args = parser.parse_args()
    build(args.out.resolve())
