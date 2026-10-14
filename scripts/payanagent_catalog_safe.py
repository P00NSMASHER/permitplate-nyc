"""Parse bounded untrusted PayanAgent public catalog JSON without exposing payloads.

Source observations alone never establish listing ownership, registration,
payments or permission to contact a directory or a prospect.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

MAX_BYTES = 65_536
MAX_NODES = 2_000
URL_KEYS = ("endpoint", "endpointUrl", "url")


class UnsafeCatalog(ValueError):
    pass


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise UnsafeCatalog("duplicate JSON key")
        result[key] = value
    return result


def _potential_public_endpoint(text):
    if not isinstance(text, str) or len(text) > 500:
        return False
    try:
        parsed = urlsplit(text)
        host = parsed.hostname
        if (parsed.scheme != "https" or not host or parsed.username
                or parsed.password or parsed.port):
            return False
    except ValueError:
        return False
    return host == "pa-entity-x402.floot.app" or (
        host.endswith(".floot.app")
        and host.startswith("pa-entity-lookup-x402-4fbm4s")
    )


def count_potential_matches(raw):
    if not isinstance(raw, bytes) or not (2 <= len(raw) <= MAX_BYTES):
        raise UnsafeCatalog("catalog response size invalid")
    try:
        doc = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique)
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise UnsafeCatalog("unverified catalog JSON") from exc
    if not isinstance(doc, (dict, list)):
        raise UnsafeCatalog("catalog JSON root invalid")
    stack = [doc]
    nodes = 0
    matches = 0
    while stack:
        current = stack.pop()
        nodes += 1
        if nodes > MAX_NODES or len(stack) > MAX_NODES:
            raise UnsafeCatalog("catalog graph not bounded")
        if isinstance(current, dict):
            for key in URL_KEYS:
                if _potential_public_endpoint(current.get(key)):
                    matches += 1
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
    return matches


def main(args=None):
    args = sys.argv[1:] if args is None else args
    if len(args) != 1:
        raise UnsafeCatalog("expected a single private response file")
    path = Path(args[0])
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise UnsafeCatalog("response path unsafe")
    size = path.stat().st_size
    if not 2 <= size <= MAX_BYTES:
        raise UnsafeCatalog("catalog response outside size bound")
    print(count_potential_matches(path.read_bytes()))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (UnsafeCatalog, OSError):
        print("PAYAN_CATALOG_UNVERIFIED", file=sys.stderr)
        raise SystemExit(1)
