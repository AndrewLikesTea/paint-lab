import argparse
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def validate(base: str) -> list[str]:
    policy = json.loads((ROOT / ".agent-policy.json").read_text())
    errors: list[str] = []
    # Pull-request jobs use a detached merge commit. GitHub provides the
    # authenticated source branch separately; local runs use the Git branch.
    branch = os.environ.get("GITHUB_HEAD_REF") or git("branch", "--show-current")
    if branch != "main" and not branch.startswith(policy["branch_prefix"]):
        errors.append(f"branch {branch!r} does not start with {policy['branch_prefix']!r}")
    changed = sorted(set(filter(None, (
        git("diff", "--name-only", f"{base}...HEAD") + "\n" +
        git("diff", "--name-only") + "\n" + git("diff", "--cached", "--name-only")
    ).splitlines())))
    if len(changed) > policy["max_files_changed"]:
        errors.append(f"{len(changed)} files exceeds limit {policy['max_files_changed']}")
    for path in changed:
        if any(path == prefix.rstrip("/") or path.startswith(prefix) for prefix in policy["forbidden_paths"]):
            errors.append(f"forbidden path changed: {path}")
    diff = (git("diff", "--numstat", f"{base}...HEAD") + "\n" +
            git("diff", "--numstat") + "\n" + git("diff", "--cached", "--numstat"))
    lines = sum(int(value) for row in diff.splitlines() for value in row.split("\t")[:2] if value.isdigit())
    if lines > policy["max_diff_lines"]:
        errors.append(f"{lines} changed lines exceeds limit {policy['max_diff_lines']}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="main")
    args = parser.parse_args()
    errors = validate(args.base)
    if errors:
        print("\n".join(f"policy: {error}" for error in errors), file=sys.stderr)
        return 1
    print("agent policy: passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
