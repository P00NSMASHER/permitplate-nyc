"""Bound public x402 directory evidence without changing payment attribution."""

import json
from pathlib import Path

MAX_RESPONSE_BYTES = 1024 * 1024
MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024
MAX_MATCHES = 50
MAX_MATCH_FIELDS = 16
MAX_FIELD_CHARS = 256


class OversizedDirectoryResponse(ValueError):
    """A remote response cannot be classified within the evidence budget."""


class OversizedDirectorySnapshot(ValueError):
    """A generated receipt exceeds the safe commit budget."""


def load_bounded_json(stream, max_bytes=MAX_RESPONSE_BYTES):
    """Read at most max_bytes + 1; never classify incomplete JSON as no match."""
    if max_bytes < 1:
        raise ValueError("max_bytes must be positive")
    raw = stream.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise OversizedDirectoryResponse(
            f"directory response exceeds {max_bytes} bytes"
        )
    return json.loads(raw.decode("utf-8", errors="replace"))


def find_matching_dicts(value, needles, path=""):
    """Return bounded, direct-field evidence; never copy matching ancestors."""
    terms = tuple(str(term).casefold() for term in needles if term)
    if not terms:
        return []
    matches = []

    def direct_text(raw):
        if isinstance(raw, (str, int, float, bool)) or raw is None:
            return str(raw)
        if isinstance(raw, list) and len(raw) <= 16 and all(
            isinstance(item, (str, int, float, bool)) or item is None
            for item in raw
        ):
            return ", ".join(str(item) for item in raw)
        return None

    def project_text(raw):
        if len(raw) <= MAX_FIELD_CHARS:
            return raw
        # Preserve a matching span so reviewers can verify why it was selected.
        match_at = next(
            (raw.casefold().find(term) for term in terms if term in raw.casefold()),
            0,
        )
        start = max(0, match_at - 48)
        return raw[start:start + MAX_FIELD_CHARS] + "…"

    # Iterative traversal avoids recursion failures from deeply nested
    # provider JSON and stops as soon as the 50-match evidence cap is reached.
    stack = [(value, path)]
    while stack and len(matches) < MAX_MATCHES:
        node, current_path = stack.pop()
        if isinstance(node, dict):
            fields = []
            for key, child in node.items():
                raw = direct_text(child)
                if raw is not None:
                    fields.append((str(key), raw))
            matching = [
                (key, raw) for key, raw in fields
                if any(term in raw.casefold() for term in terms)
            ]
            if matching:
                record = {}
                # Put evidence-bearing fields first, even on wide records.
                for key, raw in matching + [pair for pair in fields if pair not in matching]:
                    if len(record) >= MAX_MATCH_FIELDS:
                        break
                    record[key[:80]] = project_text(raw)
                matches.append({"path": current_path or "/", "record": record})
            for key, child in reversed(list(node.items())):
                if isinstance(child, (dict, list)):
                    stack.append((child, current_path + "/" + str(key)))
        elif isinstance(node, list):
            for index in range(len(node) - 1, -1, -1):
                child = node[index]
                if isinstance(child, (dict, list)):
                    stack.append((child, current_path + "/" + str(index)))
    return matches


def assert_snapshot_size(path, max_bytes=MAX_SNAPSHOT_BYTES):
    """Refuse oversized Git receipts instead of silently losing evidence."""
    size = Path(path).stat().st_size
    if size > max_bytes:
        raise OversizedDirectorySnapshot(
            f"directory snapshot is {size} bytes (limit {max_bytes}); refusing commit"
        )
    return size
