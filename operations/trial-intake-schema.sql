-- Private, US-jurisdiction PermitPlate NYC trial REQUEST intake.
-- Distinct from the owner-authoritative, private admitted trial registry.
CREATE TABLE IF NOT EXISTS trial_intake_requests (
  reference TEXT PRIMARY KEY,
  business_name TEXT NOT NULL CHECK(length(business_name) BETWEEN 2 AND 160),
  business_domain TEXT NOT NULL UNIQUE,
  website TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN (
    'pos','insurance','equipment','hoodfire','waste','pest','linen','distribution')),
  territory TEXT NOT NULL CHECK(territory IN (
    'AllNYC','Manhattan','Brooklyn','Queens','Bronx','StatenIsland',
    'ManhattanBrooklyn','ManhattanQueens','BrooklynQueens','ManhattanBronx',
    'ManhattanBrooklynQueens','BrooklynStatenIsland')),
  requested_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN
    ('PENDING','REVIEWING','DECLINED','HANDOFF_RECORDED')),
  reviewed_at INTEGER,
  operator_note TEXT,
  CHECK(status='PENDING' OR reviewed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS trial_intake_status_time_idx ON trial_intake_requests(status,requested_at);
CREATE TABLE IF NOT EXISTS trial_intake_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK(attempts>0),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trial_intake_limits_expiration_idx ON trial_intake_limits(expires_at);
