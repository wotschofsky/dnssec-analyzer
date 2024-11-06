CREATE TABLE IF NOT EXISTS domains (
  domain VARCHAR(255) PRIMARY KEY,
  tld VARCHAR(50) NOT NULL,
  dnssec BOOLEAN DEFAULT NULL,
  registrar VARCHAR(255) DEFAULT NULL,
  created_at DATE DEFAULT NULL,
  records_ns VARCHAR[] DEFAULT NULL,
  records_ds VARCHAR[] DEFAULT NULL,
  records_dnskey VARCHAR[] DEFAULT NULL,
  analyzed_at DATE DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_dnssec ON domains (dnssec);
CREATE INDEX IF NOT EXISTS idx_registrar ON domains (registrar);
