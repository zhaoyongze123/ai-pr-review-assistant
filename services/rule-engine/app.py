import json
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


def severity_from_semgrep(value):
    severity = str(value or "").upper()
    if severity == "ERROR":
        return "HIGH"
    if severity == "WARNING":
        return "MEDIUM"
    if severity == "INFO":
        return "LOW"
    return "INFO"


def severity_from_eslint(value):
    if value in (2, "2", "error"):
        return "HIGH"
    if value in (1, "1", "warn"):
        return "MEDIUM"
    return "INFO"


def normalize_semgrep(payload):
    violations = []
    for finding in payload.get("results", []):
        extra = finding.get("extra", {})
        metadata = extra.get("metadata") or {}
        violations.append(
            {
                "source": "rule",
                "engine": "semgrep",
                "ruleId": finding.get("check_id", "semgrep.unknown"),
                "filePath": finding.get("path", "unknown"),
                "severity": severity_from_semgrep(extra.get("severity")),
                "category": metadata.get("category", "maintainability"),
                "title": finding.get("check_id", "Semgrep rule matched"),
                "message": extra.get("message", "Semgrep reported a rule violation."),
                "lineStart": (finding.get("start") or {}).get("line"),
                "lineEnd": (finding.get("end") or {}).get("line"),
                "metadata": metadata,
            }
        )
    return violations


def normalize_eslint(payload):
    violations = []
    for file_result in payload:
        for message in file_result.get("messages", []):
            rule_id = message.get("ruleId") or "eslint.unknown"
            violations.append(
                {
                    "source": "rule",
                    "engine": "eslint",
                    "ruleId": rule_id,
                    "filePath": file_result.get("filePath", "unknown"),
                    "severity": severity_from_eslint(message.get("severity")),
                    "category": "bug" if "promise" in rule_id else "maintainability",
                    "title": rule_id,
                    "message": message.get("message", "ESLint reported a rule violation."),
                    "lineStart": message.get("line"),
                    "lineEnd": message.get("endLine") or message.get("line"),
                }
            )
    return violations


def run_command(command, cwd, timeout):
    completed = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    stdout = completed.stdout.strip() or "[]"
    return completed.returncode, json.loads(stdout), completed.stderr.strip()


def run_scan(repository_path, engines, timeout):
    root = Path(repository_path).resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError("repositoryPath must point to an existing directory")

    results = []
    failures = []

    if "semgrep" in engines:
        if shutil.which("semgrep"):
            try:
                _, payload, stderr = run_command(
                    ["semgrep", "scan", "--json", "--config", "auto", "."],
                    root,
                    timeout,
                )
                results.extend(normalize_semgrep(payload))
                if stderr:
                    failures.append({"engine": "semgrep", "message": stderr})
            except Exception as error:
                failures.append({"engine": "semgrep", "message": str(error)})
        else:
            failures.append({"engine": "semgrep", "message": "semgrep executable not found"})

    if "eslint" in engines:
        if shutil.which("npx"):
            try:
                _, payload, stderr = run_command(
                    ["npx", "eslint", ".", "--format", "json"],
                    root,
                    timeout,
                )
                results.extend(normalize_eslint(payload))
                if stderr:
                    failures.append({"engine": "eslint", "message": stderr})
            except Exception as error:
                failures.append({"engine": "eslint", "message": str(error)})
        else:
            failures.append({"engine": "eslint", "message": "npx executable not found"})

    return {"violations": results, "failures": failures}


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        self._send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/scan":
            self._send_json(404, {"error": "not_found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length) or b"{}")
            payload = run_scan(
                request.get("repositoryPath"),
                request.get("engines", ["semgrep", "eslint"]),
                int(request.get("timeoutSeconds", 30)),
            )
            self._send_json(200, payload)
        except Exception as error:
            self._send_json(400, {"error": "scan_failed", "message": str(error)})


def main():
    server = HTTPServer(("0.0.0.0", 8001), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
