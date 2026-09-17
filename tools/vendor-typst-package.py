#!/usr/bin/env python3
"""Vendor a Typst package from packages.typst.org into the web workbench.

Usage: python3 tools/vendor-typst-package.py @preview/tiaoma:0.3.0

Downloads the package tarball, records its sha256, extracts it into
app/typstbit/web_wasm/packages/<namespace>/<name>/<version>/ and refreshes
the bundle manifest consumed by the browser at runtime.
"""
import hashlib
import io
import json
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG_ROOT = ROOT / "app" / "typstbit" / "web_wasm" / "packages"
MANIFEST = PKG_ROOT / "manifest.json"


def parse_spec(spec):
    match = re.fullmatch(r"@([a-z0-9-]+)/([a-z0-9-]+):(\d+\.\d+\.\d+)", spec)
    if not match:
        raise SystemExit(f"invalid package spec: {spec}")
    return match.groups()


def safe_name(name):
    name = name.lstrip("./")
    if not name or name.startswith("/") or ".." in Path(name).parts:
        raise SystemExit(f"unsafe path in archive: {name}")
    return name


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: vendor-typst-package.py @namespace/name:version")
    namespace, name, version = parse_spec(sys.argv[1])
    url = f"https://packages.typst.org/{namespace}/{name}-{version}.tar.gz"
    with urllib.request.urlopen(url) as response:
        archive = response.read()
    digest = hashlib.sha256(archive).hexdigest()
    print(f"{url}\nsha256={digest}\nsize={len(archive)} bytes")

    target = PKG_ROOT / namespace / name / version
    target.mkdir(parents=True, exist_ok=True)
    files = []
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            relative = safe_name(member.name)
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            extracted = tar.extractfile(member)
            if extracted is None:
                continue
            destination.write_bytes(extracted.read())
            files.append(relative)
    files.sort()

    manifest = {}
    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text())
    entries = {entry["spec"]: entry for entry in manifest.get("packages", [])}
    entries[sys.argv[1]] = {
        "spec": sys.argv[1],
        "root": f"{namespace}/{name}/{version}",
        "url": url,
        "sha256": digest,
        "files": files,
    }
    ordered = [entries[spec] for spec in sorted(entries)]
    MANIFEST.write_text(json.dumps({"packages": ordered}, indent=2) + "\n")
    print(f"vendored {sys.argv[1]} -> {target}")
    print(f"manifest: {MANIFEST} ({len(ordered)} package(s))")


if __name__ == "__main__":
    main()
