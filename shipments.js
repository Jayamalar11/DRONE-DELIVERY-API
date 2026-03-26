const { Router }   = require("express");
const { getDb }    = require("../db/connection");
const { validate } = require("../middleware/validate");

const router = Router();

const VALID_STATUSES = ["pending", "assigned", "in_transit", "out_for_delivery", "delivered", "failed", "cancelled"];

// ── GET /api/shipments ────────────────────────────────────────────────────────
// Query params: ?status=in_transit  ?customer_id=1
router.get("/", (req, res) => {
  const db = getDb();

  let sql = `
    SELECT s.*,
           c.name  AS customer_name,
           c.email AS customer_email,
           d.name  AS drone_name,
           d.status AS drone_status
    FROM   shipments s
    JOIN   customers c ON c.id = s.customer_id
    LEFT   JOIN drones d ON d.id = s.drone_id
  `;
  const conditions = [];
  const params     = [];

  if (req.query.status) {
    conditions.push("s.status = ?");
    params.push(req.query.status);
  }
  if (req.query.customer_id) {
    conditions.push("s.customer_id = ?");
    params.push(req.query.customer_id);
  }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY s.created_at DESC";

  const shipments = db.prepare(sql).all(...params);
  res.json({ count: shipments.length, data: shipments });
});

// ── GET /api/shipments/:trackingId ────────────────────────────────────────────
router.get("/:trackingId", (req, res) => {
  const db = getDb();
  const shipment = db.prepare(`
    SELECT s.*,
           c.name  AS customer_name,
           c.email AS customer_email,
           c.phone AS customer_phone,
           d.name  AS drone_name,
           d.status AS drone_status,
           d.current_lat AS drone_lat,
           d.current_lng AS drone_lng,
           d.battery_level AS drone_battery
    FROM   shipments s
    JOIN   customers c ON c.id = s.customer_id
    LEFT   JOIN drones d ON d.id = s.drone_id
    WHERE  s.tracking_id = ?
  `).get(req.params.trackingId);

  if (!shipment) return res.status(404).json({ error: "Shipment not found" });
  res.json({ data: shipment });
});

// ── GET /api/shipments/:trackingId/events ─────────────────────────────────────
router.get("/:trackingId/events", (req, res) => {
  const db = getDb();

  const shipment = db.prepare(
    `SELECT id FROM shipments WHERE tracking_id = ?`
  ).get(req.params.trackingId);

  if (!shipment) return res.status(404).json({ error: "Shipment not found" });

  const events = db.prepare(`
    SELECT * FROM tracking_events
    WHERE  shipment_id = ?
    ORDER  BY timestamp ASC
  `).all(shipment.id);

  res.json({ count: events.length, data: events });
});

// ── PATCH /api/shipments/:trackingId/status ───────────────────────────────────
router.patch(
  "/:trackingId/status",
  validate({
    required: ["status"],
    types:    { status: "string" },
    oneOf:    { status: VALID_STATUSES },
  }),
  (req, res) => {
    const db = getDb();
    const shipment = db.prepare(
      `SELECT * FROM shipments WHERE tracking_id = ?`
    ).get(req.params.trackingId);

    if (!shipment) return res.status(404).json({ error: "Shipment not found" });

    const { status, description } = req.body;

    // Simple forward-only guard (prevent regressing delivered → pending etc.)
    const ORDER = VALID_STATUSES;
    const currentIdx = ORDER.indexOf(shipment.status);
    const newIdx     = ORDER.indexOf(status);
    const terminal   = ["delivered", "failed", "cancelled"];

    if (terminal.includes(shipment.status)) {
      return res.status(409).json({
        error: `Shipment is already in terminal state '${shipment.status}' and cannot be updated`,
      });
    }
    if (newIdx < currentIdx) {
      return res.status(409).json({
        error: `Cannot move status backwards from '${shipment.status}' to '${status}'`,
      });
    }

    const updateShipment = db.transaction(() => {
      db.prepare(`
        UPDATE shipments SET status = ?, updated_at = datetime('now') WHERE id = ?
      `).run(status, shipment.id);

      db.prepare(`
        INSERT INTO tracking_events (shipment_id, status, description)
        VALUES (?, ?, ?)
      `).run(
        shipment.id,
        status,
        description || `Status updated to '${status}'`
      );
    });

    updateShipment();

    const updated = db.prepare(`SELECT * FROM shipments WHERE id = ?`).get(shipment.id);
    res.json({ data: updated });
  }
);

module.exports = router;
