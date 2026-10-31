"""Validate that the Cloudflare D1 schema is valid SQLite and enforces its controls."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parent.parent

class PrivateTrialIntakeSchemaTests(unittest.TestCase):
    def test_sqlite_schema_and_exact_uniqueness(self):
        schema=(ROOT/'operations/trial-intake-schema.sql').read_text('utf-8')
        db=sqlite3.connect(':memory:')
        db.executescript(schema)
        self.assertIsNotNone(db.execute("SELECT name FROM sqlite_master WHERE name='trial_intake_requests'").fetchone())
        valid=('PP-TEST123','Fictional Vendor','vendor.com','https://vendor.com',
               'buyer@vendor.com','equipment','Brooklyn',1790000000000)
        query="INSERT INTO trial_intake_requests(reference,business_name,business_domain,website,contact_email,category,territory,requested_at) VALUES(?,?,?,?,?,?,?,?)"
        db.execute(query,valid)
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(query,('PP-TEST124','Same Domain','vendor.com','https://vendor.com','new@vendor.com','pos','Queens',1790000000001))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(query,('PP-TEST125','Wrong Category','another.com','https://another.com','new@another.com','unapproved','Queens',1790000000001))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE trial_intake_requests SET status='HANDOFF_RECORDED' WHERE reference='PP-TEST123'")
        db.execute("UPDATE trial_intake_requests SET status='REVIEWING',reviewed_at=1790000000000 WHERE reference='PP-TEST123'")
        self.assertEqual(db.execute("SELECT status FROM trial_intake_requests").fetchone()[0],'REVIEWING')
        db.execute("INSERT INTO trial_intake_limits(bucket,attempts,expires_at) VALUES(?,?,?)",('a'*64,1,1790000000000))
        self.assertEqual(db.execute("SELECT attempts FROM trial_intake_limits").fetchone()[0],1)
        db.close()

if __name__=='__main__':
    unittest.main()
