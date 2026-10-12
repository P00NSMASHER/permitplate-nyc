"""Network-free size and matching regression tests for PA directory receipts."""

import io
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts.directory_snapshot_safety import (
    MAX_MATCHES,
    MAX_RECORD_BYTES,
    MAX_RESPONSE_BYTES,
    fetch_json,
    find_matching_dicts,
    write_bounded_snapshot,
)


class _Response(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class DirectoryReceiptSafetyTests(unittest.TestCase):
    def test_does_not_duplicate_large_ancestor_payloads(self):
        child = {"title": "Pennsylvania Vendor Intake Decision Gate", "url": "/vendor-intake-gate"}
        index = {"data": {"records": [{"irrelevant": "x" * 10000}, child]}}
        hits = find_matching_dicts(index, ["vendor-intake-gate"])
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["path"], "/data/records/1")
        self.assertEqual(hits[0]["record"]["url"], "/vendor-intake-gate")
        self.assertNotIn("data", hits[0]["record"])

    def test_bounds_matches_and_each_record(self):
        items = [{"url": "vendor-intake-gate", "description": "z" * 20000}
                 for _ in range(100)]
        hits = find_matching_dicts({"items": items}, ["vendor-intake-gate"])
        self.assertEqual(len(hits), MAX_MATCHES)
        self.assertTrue(all(len(json.dumps(hit["record"]).encode("utf-8")) <= MAX_RECORD_BYTES
                            for hit in hits))

    def test_handles_deeply_nested_provider_response(self):
        data = {"name": "vendor-intake-gate"}
        for _ in range(200):
            data = [data]
        self.assertEqual(len(find_matching_dicts(data, ["vendor-intake-gate"])), 1)

    def test_rejects_oversized_http_payload_without_retaining_it(self):
        with patch("urllib.request.urlopen", return_value=_Response(b"x" * (MAX_RESPONSE_BYTES + 10))):
            result = fetch_json("https://example.com/directory")
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "response_exceeds_receipt_limit")
        self.assertNotIn("data", result)

    def test_preserves_regular_http_json_contract(self):
        with patch("urllib.request.urlopen", return_value=_Response(b'{"services": [{"id": "1"}]}')):
            result = fetch_json("https://example.com/directory")
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["services"][0]["id"], "1")

    def test_snapshot_budget_rejects_large_receipt_without_overwriting_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "latest.json"
            file.write_text("previous evidence", encoding="utf-8")
            with self.assertRaises(ValueError):
                write_bounded_snapshot(file, {"data": "x" * 1000}, max_snapshot_bytes=500)
            self.assertEqual(file.read_text(encoding="utf-8"), "previous evidence")

    def test_writes_valid_small_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "latest.json"
            count = write_bounded_snapshot(file, {"ok": True}, max_snapshot_bytes=100)
            self.assertEqual(count, file.stat().st_size)
            self.assertEqual(json.loads(file.read_text(encoding="utf-8"))["ok"], True)

    def test_missing_targets_do_not_create_false_matches(self):
        self.assertEqual(find_matching_dicts({"url": "unrelated"}, ["vendor-intake-gate"]), [])
        self.assertEqual(find_matching_dicts({"url": "vendor-intake-gate"}, []), [])


if __name__ == "__main__":
    unittest.main()
