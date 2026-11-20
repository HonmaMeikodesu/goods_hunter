#!/usr/bin/python3 -I
"""Build and activate the current main revision after its GitHub Actions checks pass."""

import fcntl
import http.client
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


REPOSITORY = "HonmaMeikodesu/goods_hunter"
SOURCE = "https://github.com/" + REPOSITORY + ".git"
WORKFLOW = "https://api.github.com/repos/" + REPOSITORY + "/actions/workflows/goods-hunter.yml/runs"
ROOT = Path("/opt/goods-hunter")
RELEASES = ROOT / "releases"
CURRENT = ROOT / "current"
FAILED = ROOT / "failed-action"
LOCK = Path("/run/lock/goods-hunter-deploy.lock")
SERVICE = "goods-hunter.service"
SYSTEMCTL = "/usr/bin/systemctl"


def main_revision():
    ref = subprocess.check_output(
        ["/usr/bin/git", "ls-remote", "--exit-code", SOURCE, "refs/heads/main"],
        text=True, timeout=20,
    )
    match = re.fullmatch(r"([0-9a-f]{40})\trefs/heads/main\n?", ref)
    if not match:
        raise RuntimeError("Unable to resolve the main revision")
    return match.group(1)


def verified_run(revision):
    query = urlencode({"branch": "main", "head_sha": revision, "event": "push", "per_page": 1})
    request = Request(WORKFLOW + "?" + query, headers={"Accept": "application/vnd.github+json"})
    try:
        with urlopen(request, timeout=15) as response:
            runs = json.load(response)["workflow_runs"]
    except HTTPError as error:
        if error.code == 404:
            return None
        raise
    if not runs:
        return None
    run = runs[0]
    if (
        run["head_sha"] == revision
        and run["head_branch"] == "main"
        and run["head_repository"]["full_name"] == REPOSITORY
        and run["event"] == "push"
        and run["conclusion"] == "success"
    ):
        return f"{run['id']}/{run['run_attempt']}"
    return None


def build_release(revision):
    release = RELEASES / revision
    if release.exists():
        return release
    with tempfile.TemporaryDirectory(prefix=".build-", dir=RELEASES) as scratch:
        staged = Path(scratch) / revision
        staged.mkdir(mode=0o755)
        executable = staged / "goods-hunter"
        with executable.open("xb") as output:
            subprocess.run(
                [
                    "/usr/bin/systemd-run", "--quiet", "--wait", "--collect", "--pipe",
                    "--unit=goods-hunter-build-" + revision[:12],
                    "--property=Type=exec", "--property=RuntimeMaxSec=5min",
                    "--property=DynamicUser=yes", "--property=CacheDirectory=goods-hunter-build",
                    "--property=ProtectHome=yes", "--property=PrivateTmp=yes",
                    "--property=NoNewPrivileges=yes", "--property=LimitFSIZE=64M",
                    "/usr/local/libexec/goods-hunter-build", revision,
                ],
                stdin=subprocess.DEVNULL, stdout=output, check=True, timeout=330,
            )
            os.fsync(output.fileno())
        if executable.stat().st_size == 0:
            raise RuntimeError("Build produced an empty executable")
        executable.chmod(0o755)
        staged.chmod(0o755)
        staged.rename(release)
    return release


def preflight(release):
    subprocess.run(
        [
            "/usr/bin/systemd-run", "--quiet", "--wait", "--collect",
            "--unit=goods-hunter-preflight-" + release.name[:12],
            "--property=Type=exec", "--property=RuntimeMaxSec=40s",
            "--property=User=wangming",
            "--property=WorkingDirectory=/home/wangming/project/goods_hunter",
            "--property=EnvironmentFile=/etc/goods-hunter/production.env",
            str(release / "goods-hunter"), "-check",
        ],
        check=True,
        timeout=50,
    )


def select_release(release):
    with tempfile.TemporaryDirectory(prefix=".switch-", dir=ROOT) as scratch:
        link = Path(scratch) / "current"
        link.symlink_to(release)
        link.replace(CURRENT)


def healthy(release):
    try:
        pid = subprocess.check_output(
            [SYSTEMCTL, "show", SERVICE, "--property=MainPID", "--value"],
            text=True,
            timeout=4,
        ).strip()
        if not pid.isdigit() or pid == "0":
            return False
        if Path(os.readlink("/proc/" + pid + "/exe")) != release / "goods-hunter":
            return False
        connection = http.client.HTTPConnection("127.0.0.1", 7001, timeout=3)
        try:
            connection.request("GET", "/")
            return connection.getresponse().status == 200
        finally:
            connection.close()
    except (OSError, http.client.HTTPException, subprocess.SubprocessError):
        return False


def restart_and_verify(release):
    subprocess.run([SYSTEMCTL, "restart", SERVICE], check=True, timeout=55)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if healthy(release):
            return
        time.sleep(0.5)
    raise RuntimeError("HTTP health check failed for " + release.name)


def deploy():
    with LOCK.open("a", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        previous = CURRENT.resolve(strict=True)
        if not CURRENT.is_symlink() or previous.parent != RELEASES:
            raise RuntimeError("Invalid current release pointer")
        revision = main_revision()
        if previous.name == revision:
            return
        run = verified_run(revision)
        if run is None:
            return
        if FAILED.exists() and FAILED.read_text(encoding="utf-8").strip() == run:
            return
        print(f"Building {revision} after GitHub Actions run {run}", flush=True)
        release = build_release(revision)
        preflight(release)
        if main_revision() != revision:
            print("main advanced during preparation for " + revision)
            return
        select_release(release)
        try:
            restart_and_verify(release)
        except BaseException:
            select_release(previous)
            restart_and_verify(previous)
            FAILED.write_text(run + "\n", encoding="utf-8")
            print("Restored release " + previous.name, file=sys.stderr)
            raise
        FAILED.unlink(missing_ok=True)
        print("Deployed and verified " + release.name)


if __name__ == "__main__":
    try:
        deploy()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
