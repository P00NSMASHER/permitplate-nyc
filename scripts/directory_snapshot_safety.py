"""Bound public directory receipts without mistaking oversized data for a negative match."""

import json
import urllib.request

MAX_RESPONSE_BYTES = 512 * 1024
MAX_MATCHES = 50
MAX_RECORD_BYTES = 4096
MAX_SCALAR_CHARS = 400


def fetch_json(url, timeout=25, max_response_bytes=MAX_RESPONSE_BYTES):
    """Fetch at most max_response_bytes; oversized responses are explicitly unavailable."""
    request = urllib.request.Request(
        url,
        headers={
            "accept": "application/json",
            "user-agent": "permitplate-x402-readonly-verifier/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(max_response_bytes + 1)
            if len(raw) > max_response_bytes:
                return {
                    "ok": False,
                    "status": response.status,
                    "url": url,
                    "error": "response_exceeds_receipt_limit",
                    "limit_bytes": max_response_bytes,
                }
            return {
                "ok": True,
                "status": response.status,
                "url": url,
                "data": json.loads(raw.decode("utf-8")),
            }
    except Exception as exc:
        status = getattr(exc, "code", None)
        body = None
        try:
            body = exc.read(4000).decode("utf-8", errors="replace")
        except Exception:
            pass
        return {
            "ok": False,
            "status": status,
            "url": url,
            "error": str(exc),
            "body": body,
        }


def find_matching_dicts(value, needles, path=""):
    """Find scalar-bearing records, never copying or scanning entire parent trees.

    The caller receives the same list-of-{path, record} contract as before.
    Records are size-limited and restricted to scalar fields. Traversal is
    iterative to avoid recursion errors from deeply nested provider payloads.
    """
    targets = tuple(needle.casefold() for needle in needles if needle)
    if not targets:
        return []

    matches = []
    stack = [(value, path)]
    while stack and len(matches) < MAX_MATCHES:
        current, current_path = stack.pop()
        if isinstance(current, list):
            for index in range(len(current) - 1, -1, -1):
                stack.append((current[index], current_path + "/" + str(index)))
            continue
        if not isinstance(current, dict):
            continue

        scalars = [(str(key), item) for key, item in current.items()
                   if not isinstance(item, (dict, list))]
        if any(any(target in str(item).casefold() for target in targets)
               for _, item in scalars):
            record = {}
            for key, item in scalars:
                safe_key = key[:100]
                safe_value = item[:MAX_SCALAR_CHARS] if isinstance(item, str) else item
                candidate = {**record, safe_key: safe_value}
                if len(json.dumps(candidate, default=str).encode("utf-8")) <= MAX_RECORD_BYTES:
                    record = candidate
            matches.append({"path": current_path or "/", "record": record})

        # Push child containers only. A matching ancestor is never included
        # merely because one of its nested descendants contains the target.
        for key, child in reversed(list(current.items())):
            if isinstance(child, (dict, list)):
                stack.append((child, current_path + "/" + str(key)[:100]))
    return matches


MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024


def write_bounded_snapshot(path, snapshot, max_snapshot_bytes=MAX_SNAPSHOT_BYTES):
    """Write one complete receipt or leave the existing file untouched."""
    from pathlib import Path

    encoded = (json.dumps(snapshot, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if len(encoded) > max_snapshot_bytes:
        raise ValueError(
            f"directory receipt exceeds {max_snapshot_bytes} bytes; "
            "refusing to overwrite the previous evidence"
        )
    Path(path).write_bytes(encoded)
    return len(encoded)
