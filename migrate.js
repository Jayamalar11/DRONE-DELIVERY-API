const { getDb } = require("./connection");

function migrate() {
  const db = getDb();

  db.exec(`
    -- ── customers ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS customers (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT    NOT NULL,
      email     TEXT    NOT NULL UNIQUE,
      phone     TEXT    NOT NULL
    );

    -- ── drones (must exist before shipments references it) ──────────────────────
    CREATE TABLE IF NOT EXISTS drones (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL UNIQUE,
      status        TEXT    NOT NULL DEFAULT 'idle'
                    CHECK(status IN ('idle','in_flight','charging','low_battery','maintenance')),
      current_lat   REAL,
      current_lng   REAL,
      battery_level INTEGER NOT NULL DEFAULT 100
                    CHECK(battery_level BETWEEN 0 AND 100)
    );

    -- ── drone calibration (1-to-1 with drones) ──────────────────────────────────
    CREATE TABLE IF NOT EXISTS drone_calibrations (
      drone_id           INTEGER PRIMARY KEY REFERENCES drones(id) ON DELETE CASCADE,
      max_payload_kg     REAL NOT NULL,
      cruise_speed_mps   REAL NOT NULL,
      max_altitude_m     REAL NOT NULL,
      home_lat           REAL NOT NULL,
      home_lng           REAL NOT NULL,
      geofence_radius_m  REAL NOT NULL
    );

    -- ── shipments ────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS shipments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tracking_id  TEXT    NOT NULL UNIQUE,
      customer_id  INTEGER NOT NULL REFERENCES customers(id),
      drone_id     INTEGER REFERENCES drones(id),         -- assigned drone (nullable)
      origin       TEXT    NOT NULL,
      destination  TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending'
                   CHECK(status IN ('pending','assigned','in_transit','out_for_delivery','delivered','failed','cancelled')),
      eta          TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── tracking events ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS tracking_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id  INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
      status       TEXT    NOT NULL,
      location_lat REAL,
      location_lng REAL,
      description  TEXT,
      timestamp    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── indexes ──────────────────────────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_shipments_tracking   ON shipments(tracking_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_customer   ON shipments(customer_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_drone      ON shipments(drone_id);
    CREATE INDEX IF NOT EXISTS idx_events_shipment      ON tracking_events(shipment_id);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp     ON tracking_events(timestamp);
  `);

  console.log("✅  Migration complete.");
}

migrate();
