"""Offline regression tests for public directory-status receipt bounding."""

import io
import json
import tempfile
import unittest
from pathlib import Path

from scripts.pa_entity_directory_bounding import (
    MAX_MATCHES,
    OversizedDirectoryResponse,
    OversizedDirectorySnapshot,
    assert_snapshot_size,
    find_matching_dicts,
    load_bounded_json,
)


class DirectoryBoundingTests(unittest.TestCase):
    def test_small_response_round_trip(self):
        sample = {"services": [{"name": "PA Vendor Intake"}]}
        self.assertEqual(load_bounded_json(io.BytesIO(json.dumps(sample).encode())), sample)

    def test_oversized_response_fails_closed(self):
        with self.assertRaises(OversizedDirectoryResponse):
            load_bounded_json(io.BytesIO(b"x" * 12), max_bytes=10)

    def test_only_matching_leaf_is_returned_not_giant_ancestor(self):
        source = {
            "unrelated": "x" * 100_000,
            "items": [{"url": "https://example.test/vendor-intake-gate", "blob": "y" * 100_000}],
        }
        hits = find_matching_dicts(source, ["vendor-intake-gate"])
        self.assertEqual([hit["path"] for hit in hits], ["/items/0"])
        self.assertIn("vendor-intake-gate", hits[0]["record"]["url"])
        self.assertLess(len(json.dumps(hits)), 1500)

    def test_matching_span_survives_long_string_projection(self):
        source = {"key": "q" * 3000 + "vendor-intake-gate" + "r" * 3000}
        hits = find_matching_dicts(source, ["vendor-intake-gate"])
        self.assertIn("vendor-intake-gate", hits[0]["record"]["key"])
        self.assertLess(len(hits[0]["record"]["key"]), 300)

    def test_matching_list_of_scalars(self):
        hits = find_matching_dicts({"tags": ["alpha", "vendor-intake-gate"]}, ["vendor-intake-gate"])
        self.assertEqual(len(hits), 1)

    def test_match_count_is_bounded(self):
        source = [{"url": f"vendor-intake-gate/{index}"} for index in range(500)]
        hits = find_matching_dicts(source, ["vendor-intake-gate"])
        self.assertEqual(len(hits), MAX_MATCHES)
        self.assertEqual(hits[-1]["path"], "/49")

    def test_missing_terms_are_not_false_matches(self):
        self.assertEqual(find_matching_dicts({"nested": {"url": "other"}}, ["vendor-intake-gate"]), [])

    def test_snapshot_limit_is_checked_before_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            path.write_bytes(b"x" * 12)
            self.assertEqual(assert_snapshot_size(path, max_bytes=12), 12)
            with self.assertRaises(OversizedDirectorySnapshot):
                assert_snapshot_size(path, max_bytes=11)


if __name__ == "__main__":
    unittest.main()
