"""Pure result-collection tests over canned runner payloads."""

import csv
import io
import tempfile
import unittest
from pathlib import Path

from ve_batch import RunOutcome, VeRunError, to_csv, to_rows

HEADERS = ["RecordingDate", "FileName", "Notes", "CdA", "Crr"]


def ok_outcome(file_name: str, cda: str) -> RunOutcome:
    return RunOutcome(
        file=file_name,
        payload={
            "ok": True,
            "csvRow": {
                "headers": HEADERS,
                "values": ["2026-04-19", file_name, "", cda, "0.0050"],
                "quoteAlways": [2],
            },
        },
    )


def failed_outcome(file_name: str, message: str) -> RunOutcome:
    return RunOutcome(
        file=file_name,
        payload={"ok": False, "error": {"code": "no-valid-segments", "message": message}},
    )


class ToRowsTests(unittest.TestCase):
    def test_headers_come_from_the_response_not_from_python(self):
        rows = to_rows([ok_outcome("a.fit", "0.280")])
        self.assertEqual(list(rows[0].keys()), [*HEADERS, "Error"])
        self.assertEqual(rows[0]["CdA"], "0.280")

    def test_a_failed_run_still_gets_a_row_with_the_error_named(self):
        rows = to_rows([ok_outcome("a.fit", "0.280"), failed_outcome("b.fit", "too short")])
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]["FileName"], "b.fit")
        self.assertEqual(rows[1]["Error"], "too short")
        self.assertEqual(rows[1]["CdA"], "")  # blank, never fabricated

    def test_mixed_headers_fail_loudly(self):
        other = ok_outcome("c.fit", "0.300")
        other.payload["csvRow"]["headers"] = [*HEADERS[:-1], "Krr"]
        with self.assertRaises(VeRunError):
            to_rows([ok_outcome("a.fit", "0.280"), other])


class ToCsvTests(unittest.TestCase):
    def test_writes_a_parseable_csv_accounting_for_every_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "out.csv"
            to_csv([ok_outcome("a.fit", "0.280"), failed_outcome("b.fit", "boom")], target)
            parsed = list(csv.DictReader(io.StringIO(target.read_text())))
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["FileName"], "a.fit")
        self.assertEqual(parsed[1]["Error"], "boom")


if __name__ == "__main__":
    unittest.main()
