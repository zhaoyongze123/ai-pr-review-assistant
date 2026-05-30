import json
import os
import shutil
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import tempfile


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
        rule_id = normalize_semgrep_rule_id(finding.get("check_id", "semgrep.unknown"))
        violations.append(
            {
                "source": "rule",
                "engine": "semgrep",
                "ruleId": rule_id,
                "filePath": finding.get("path", "unknown"),
                "severity": severity_from_semgrep(extra.get("severity")),
                "category": metadata.get("category", "maintainability"),
                "title": rule_id,
                "message": extra.get("message", "Semgrep reported a rule violation."),
                "lineStart": (finding.get("start") or {}).get("line"),
                "lineEnd": (finding.get("end") or {}).get("line"),
                "metadata": metadata,
            }
        )
    return violations


def normalize_semgrep_rule_id(value):
    rule_id = str(value or "semgrep.unknown")
    for marker in (".yml.", ".yaml."):
        if marker in rule_id:
            return rule_id.split(marker, 1)[1]
    return rule_id


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


def resolve_executable(name):
    explicit = shutil.which(name)
    if explicit:
        return explicit

    candidate = Path(sys.executable).parent / name
    if candidate.exists():
        return str(candidate)

    return None


def build_semgrep_command(configs):
    command = [
        resolve_executable("semgrep"),
        "scan",
        "--json",
        "--no-rewrite-rule-ids",
    ]
    resolved_configs = configs or ["auto"]
    for config in resolved_configs:
        command.extend(["--config", config])
    command.append(".")
    return command


def collect_semgrep_configs(root, semgrep_configs, module_rule_configs):
    configs = []
    seen = set()

    for config in semgrep_configs or []:
        target = Path(config)
        resolved = target if target.is_absolute() else (root / target)
        normalized = str(resolved.resolve())
        if resolved.exists() and normalized not in seen:
            configs.append(normalized)
            seen.add(normalized)

    for prefix, config in (module_rule_configs or {}).items():
        target = Path(config)
        resolved = target if target.is_absolute() else (root / target)
        if not resolved.exists():
            continue

        matched = any(
            str(path.relative_to(root)).replace("\\", "/").startswith(prefix.rstrip("/") + "/")
            or str(path.relative_to(root)).replace("\\", "/") == prefix.rstrip("/")
            for path in root.rglob("*")
            if path.is_file()
        )
        normalized = str(resolved.resolve())
        if matched and normalized not in seen:
            configs.append(normalized)
            seen.add(normalized)

    return configs


def run_scan(repository_path, files, engines, timeout, semgrep_configs=None, module_rule_configs=None):
    temp_root = None
    root = None

    if repository_path:
        root = Path(repository_path).resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError("repositoryPath must point to an existing directory")
    elif files:
        temp_root = tempfile.TemporaryDirectory(prefix="rule-engine-scan-")
        root = Path(temp_root.name).resolve()
        for file_entry in files:
            target = root / file_entry["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(file_entry.get("content", ""), encoding="utf-8")
    else:
        raise ValueError("repositoryPath or files is required")

    root = root.resolve()
    results = []
    failures = []

    try:
        if "semgrep" in engines:
            semgrep_executable = resolve_executable("semgrep")
            if semgrep_executable:
                try:
                    configs = collect_semgrep_configs(root, semgrep_configs, module_rule_configs)
                    return_code, payload, stderr = run_command(
                        build_semgrep_command(configs),
                        root,
                        timeout,
                    )
                    results.extend(normalize_semgrep(payload))
                    if return_code != 0:
                        failures.append({"engine": "semgrep", "message": stderr})
                except Exception as error:
                    failures.append({"engine": "semgrep", "message": str(error)})
            else:
                failures.append({"engine": "semgrep", "message": "semgrep executable not found"})

        if "eslint" in engines:
            npx_executable = resolve_executable("npx")
            if npx_executable:
                try:
                    return_code, payload, stderr = run_command(
                        [npx_executable, "eslint", ".", "--format", "json"],
                        root,
                        timeout,
                    )
                    results.extend(normalize_eslint(payload))
                    if return_code != 0:
                        failures.append({"engine": "eslint", "message": stderr})
                except Exception as error:
                    failures.append({"engine": "eslint", "message": str(error)})
            else:
                failures.append({"engine": "eslint", "message": "npx executable not found"})

        return {"violations": results, "failures": failures}
    finally:
        if temp_root:
            temp_root.cleanup()


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
                request.get("files", []),
                request.get("engines", ["semgrep", "eslint"]),
                int(request.get("timeoutSeconds", 30)),
                request.get("semgrepConfigs", []),
                request.get("moduleRuleConfigs", {}),
            )
            self._send_json(200, payload)
        except Exception as error:
            self._send_json(400, {"error": "scan_failed", "message": str(error)})


def main():
    host = os.environ.get("RULE_ENGINE_HOST", "0.0.0.0")
    port = int(os.environ.get("RULE_ENGINE_PORT", "58001"))
    server = HTTPServer((host, port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
