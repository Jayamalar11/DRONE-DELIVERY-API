const { Router }   = require("express");
const { getDb }    = require("../db/connection");
const { validate } = require("../middleware/validate");

const router = Router();

const DRONE_STATUSES = ["idle", "in_flight", "charging", "low_battery", "maintenance"];

// ── GET /api/drones ───────────────────────────────────────────────────────────
// Optional ?status=idle
router.get("/", (req, res) => {
  const db = getDb();

  let sql    = `SELECT * FROM drones`;
  const params = [];
  if (req.query.status) {
    sql += ` WHERE status = ?`;
    params.push(req.query.status);
  }
  sql += ` ORDER BY id`;

  const drones = db.prepare(sql).all(...params);
  res.json({ count: drones.length, data: drones });
});

// ── GET /api/drones/fleet-summary ────────────────────────────────────────────
// Must be defined BEFORE /:id to avoid "fleet-summary" being treated as an id
router.get("/fleet-summary", (req, res) => {
  const db = getDb();

  const drones = db.prepare(`SELECT * FROM drones`).all();

  const byStatus = drones.reduce((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1;
    return acc;
  }, {});

  const avgBattery = drones.length
    ? Math.round(drones.reduce((s, d) => s + d.battery_level, 0) / drones.length)
    : 0;

  const lowBattery = drones.filter(d => d.battery_level < 20);

  // Active shipments per drone
  const activeShipments = db.prepare(`
    SELECT drone_id, COUNT(*) AS count
    FROM   shipments
    WHERE  drone_id IS NOT NULL
      AND  status IN ('assigned','in_transit','out_for_delivery')
    GROUP  BY drone_id
  `).all();

  const busyDroneIds = new Set(activeShipments.map(r => r.drone_id));

  res.json({
    data: {
      total_drones:      drones.length,
      by_status:         byStatus,
      avg_battery_pct:   avgBattery,
      low_battery_drones: lowBattery.map(d => ({ id: d.id, name: d.name, battery_level: d.battery_level })),
      drones_with_active_shipments: busyDroneIds.size,
      idle_available:    drones.filter(d => d.status === "idle" && !busyDroneIds.has(d.id)).length,
    },
  });
});

// ── GET /api/drones/:id ───────────────────────────────────────────────────────
router.get("/:id", (req, res) => {
  const db = getDb();

  const drone = db.prepare(`SELECT * FROM drones WHERE id = ?`).get(req.params.id);
  if (!drone) return res.status(404).json({ error: "Drone not found" });

  const calibration = db.prepare(
    `SELECT * FROM drone_calibrations WHERE drone_id = ?`
  ).get(drone.id) ?? null;

  // Currently assigned active shipment (if any)
  const activeShipment = db.prepare(`
    SELECT id, tracking_id, status, origin, destination, eta
    FROM   shipments
    WHERE  drone_id = ? AND status IN ('assigned','in_transit','out_for_delivery')
    LIMIT  1
  `).get(drone.id) ?? null;

  res.json({ data: { ...drone, calibration, active_shipment: activeShipment } });
});

// ── PATCH /api/drones/:id/status ─────────────────────────────────────────────
router.patch(
  "/:id/status",
  validate({ required: ["status"], oneOf: { status: DRONE_STATUSES } }),
  (req, res) => {
    const db = getDb();
    const drone = db.prepare(`SELECT * FROM drones WHERE id = ?`).get(req.params.id);
    if (!drone) return res.status(404).json({ error: "Drone not found" });

    if (req.body.status === "in_flight") {
      return res.status(409).json({
        error: "Use POST /api/admin/shipments/:trackingId/assign-drone to put a drone in_flight",
      });
    }

    db.prepare(`UPDATE drones SET status = ? WHERE id = ?`).run(req.body.status, drone.id);
    const updated = db.prepare(`SELECT * FROM drones WHERE id = ?`).get(drone.id);
    res.json({ data: updated });
  }
);

// ── PATCH /api/drones/:id/calibration ────────────────────────────────────────
router.patch("/:id/calibration", (req, res) => {
  const db = getDb();

  const drone = db.prepare(`SELECT id FROM drones WHERE id = ?`).get(req.params.id);
  if (!drone) return res.status(404).json({ error: "Drone not found" });

  const allowed = ["max_payload_kg","cruise_speed_mps","max_altitude_m","home_lat","home_lng","geofence_radius_m"];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));

  if (updates.length === 0) {
    return res.status(400).json({ error: "No valid calibration fields provided", allowed });
  }

  const existing = db.prepare(`SELECT * FROM drone_calibrations WHERE drone_id = ?`).get(drone.id);

  if (!existing) {
    const missing = allowed.filter(f => req.body[f] === undefined);
    if (missing.length) {
      return res.status(400).json({
        error: "No calibration exists yet — provide all fields to create one",
        missing,
      });
    }
    db.prepare(`
      INSERT INTO drone_calibrations
        (drone_id, max_payload_kg, cruise_speed_mps, max_altitude_m, home_lat, home_lng, geofence_radius_m)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(drone.id, ...allowed.map(f => req.body[f]));
  } else {
    const set    = updates.map(([k]) => `${k} = ?`).join(", ");
    const values = updates.map(([, v]) => v);
    db.prepare(`UPDATE drone_calibrations SET ${set} WHERE drone_id = ?`).run(...values, drone.id);
  }

  const updated = db.prepare(`SELECT * FROM drone_calibrations WHERE drone_id = ?`).get(drone.id);
  res.json({ data: updated });
});

// ── POST /api/drones/:id/telemetry ───────────────────────────────────────────
router.post(
  "/:id/telemetry",
  validate({
    required: ["lat", "lng", "battery_level"],
    types:    { lat: "number", lng: "number", battery_level: "number" },
  }),
  (req, res) => {
    const db = getDb();

    const drone = db.prepare(`SELECT * FROM drones WHERE id = ?`).get(req.params.id);
    if (!drone) return res.status(404).json({ error: "Drone not found" });

    const { lat, lng, battery_level, speed, heading } = req.body;

    if (battery_level < 0 || battery_level > 100) {
      return res.status(400).json({ error: "battery_level must be 0–100" });
    }

    // Auto-derive status from battery
    let newStatus = drone.status;
    if (battery_level < 10 && drone.status === "in_flight") {
      newStatus = "low_battery";
    } else if (drone.status === "low_battery" && battery_level >= 20) {
      newStatus = "in_flight"; // recovered (e.g., hot-swap battery)
    }

    const applyTelemetry = db.transaction(() => {
      db.prepare(`
        UPDATE drones
        SET    current_lat = ?, current_lng = ?, battery_level = ?, status = ?
        WHERE  id = ?
      `).run(lat, lng, battery_level, newStatus, drone.id);

      // Resolve shipment via real FK — no guessing
      const linked = db.prepare(`
        SELECT id, tracking_id, status FROM shipments
        WHERE  drone_id = ? AND status IN ('assigned','in_transit','out_for_delivery')
        LIMIT  1
      `).get(drone.id);

      let eventId = null;

      if (linked) {
        const parts = [
          "Telemetry update",
          speed   != null ? `speed ${speed} m/s`  : null,
          heading != null ? `heading ${heading}°`  : null,
          `battery ${battery_level}%`,
          battery_level < 20 ? "⚠️ LOW BATTERY" : null,
        ].filter(Boolean);

        const result = db.prepare(`
          INSERT INTO tracking_events (shipment_id, status, location_lat, location_lng, description)
          VALUES (?, 'telemetry', ?, ?, ?)
        `).run(linked.id, lat, lng, parts.join(" · "));

        eventId = result.lastInsertRowid;
      }

      return { eventId, linked };
    });

    const { eventId, linked } = applyTelemetry();
    const updatedDrone = db.prepare(`SELECT * FROM drones WHERE id = ?`).get(drone.id);

    res.json({
      data: {
        drone:             updatedDrone,
        linked_shipment:   linked ? linked.tracking_id : null,
        tracking_event_id: eventId,
      },
    });
  }
);

module.exports = router;
