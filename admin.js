/**
 * Admin / operational routes
 *
 *   POST /api/admin/shipments/:trackingId/assign-drone   { drone_id }
 *   POST /api/admin/shipments/:trackingId/complete        { description? }
 *   POST /api/admin/shipments/:trackingId/fail            { description? }
 *   POST /api/admin/drones/:id/return-home               {}
 */
const { Router }   = require("express");
const { getDb }    = require("../db/connection");
const { validate } = require("../middleware/validate");

const router = Router();

// ── POST /api/admin/shipments/:trackingId/assign-drone ────────────────────────
router.post(
  "/shipments/:trackingId/assign-drone",
  validate({ required: ["drone_id"], types: { drone_id: "number" } }),
  (req, res) => {
    const db = getDb();

    const shipment = db.prepare(
      `SELECT * FROM shipments WHERE tracking_id = ?`
    ).get(req.params.trackingId);
    if (!shipment) return res.status(404).json({ error: "Shipment not found" });

    if (!["pending"].includes(shipment.status)) {
      return res.status(409).json({
        error: `Can only assign a drone to a 'pending' shipment (current: '${shipment.status}')`,
      });
    }

    const drone = db.prepare(`SELECT * FROM drones WHERE id = ?`).get(req.body.drone_id);
    if (!drone) return res.status(404).json({ error: "Drone not found" });

    if (!["idle"].includes(drone.status)) {
      return res.status(409).json({
        error: `Drone '${drone.name}' is not available (status: '${drone.status}'). Only idle drones can be assigned.`,
      });
    }

    // Check drone is not already assigned to another active shipment
    const alreadyAssigned = db.prepare(`
      SELECT tracking_id FROM shipments
      WHERE  drone_id = ? AND status IN ('assigned','in_transit','out_for_delivery')
      LIMIT  1
    `).get(drone.id);

    if (alreadyAssigned) {
      return res.status(409).json({
        error: `Drone '${drone.name}' is already linked to active shipment ${alreadyAssigned.tracking_id}`,
      });
    }

    const assign = db.transaction(() => {
      // Update shipment
      db.prepare(`
        UPDATE shipments
        SET    drone_id = ?, status = 'assigned', updated_at = datetime('now')
        WHERE  id = ?
      `).run(drone.id, shipment.id);

      // Update drone
      db.prepare(`UPDATE drones SET status = 'in_flight' WHERE id = ?`).run(drone.id);

      // Create event
      db.prepare(`
        INSERT INTO tracking_events (shipment_id, status, description)
        VALUES (?, 'assigned', ?)
      `).run(shipment.id, `${drone.name} assigned and dispatched`);
    });

    assign();

    const updated = db.prepare(`SELECT * FROM shipments WHERE id = ?`).get(shipment.id);
    res.status(200).json({ data: updated });
  }
);

// ── POST /api/admin/shipments/:trackingId/complete ────────────────────────────
router.post("/shipments/:trackingId/complete", (req, res) => {
  const db = getDb();

  const shipment = db.prepare(
    `SELECT * FROM shipments WHERE tracking_id = ?`
  ).get(req.params.trackingId);
  if (!shipment) return res.status(404).json({ error: "Shipment not found" });

  const nonTerminalActive = ["assigned","in_transit","out_for_delivery"];
  if (!nonTerminalActive.includes(shipment.status)) {
    return res.status(409).json({
      error: `Shipment cannot be completed from status '${shipment.status}'`,
    });
  }

  const complete = db.transaction(() => {
    db.prepare(`
      UPDATE shipments SET status = 'delivered', updated_at = datetime('now') WHERE id = ?
    `).run(shipment.id);

    db.prepare(`
      INSERT INTO tracking_events (shipment_id, status, description)
      VALUES (?, 'delivered', ?)
    `).run(shipment.id, req.body.description || "Package delivered successfully ✓");

    // Free the drone
    if (shipment.drone_id) {
      db.prepare(`UPDATE drones SET status = 'idle' WHERE id = ?`).run(shipment.drone_id);
    }
  });

  complete();

  const updated = db.prepare(`SELECT * FROM shipments WHERE id = ?`).get(shipment.id);
  res.json({ data: updated });
});

// ── POST /api/admin/shipments/:trackingId/fail ────────────────────────────────
router.post("/shipments/:trackingId/fail", (req, res) => {
  const db = getDb();

  const shipment = db.prepare(
    `SELECT * FROM shipments WHERE tracking_id = ?`
  ).get(req.params.trackingId);
  if (!shipment) return res.status(404).json({ error: "Shipment not found" });

  const terminal = ["delivered","failed","cancelled"];
  if (terminal.includes(shipment.status)) {
    return res.status(409).json({
      error: `Shipment is already in terminal state '${shipment.status}'`,
    });
  }

  const fail = db.transaction(() => {
    db.prepare(`
      UPDATE shipments SET status = 'failed', updated_at = datetime('now') WHERE id = ?
    `).run(shipment.id);

    db.prepare(`
      INSERT INTO tracking_events (shipment_id, status, description)
      VALUES (?, 'failed', ?)
    `).run(shipment.id, req.body.description || "Delivery failed");

    if (shipment.drone_id) {
      db.prepare(`UPDATE drones SET status = 'idle' WHERE id = ?`).run(shipment.drone_id);
    }
  });

  fail();

  const updated = db.prepare(`SELECT * FROM shipments WHERE id = ?`).get(shipment.id);
  res.json({ data: updated });
});

// ── POST /api/admin/drones/:id/return-home ────────────────────────────────────
router.post("/drones/:id/return-home", (req, res) => {
  const db = getDb();

  const drone = db.prepare(`SELECT * FROM drones WHERE id = ?`).get(req.params.id);
  if (!drone) return res.status(404).json({ error: "Drone not found" });

  const cal = db.prepare(
    `SELECT home_lat, home_lng FROM drone_calibrations WHERE drone_id = ?`
  ).get(drone.id);

  if (!cal) return res.status(409).json({ error: "Drone has no calibration — home coordinates unknown" });

  // Snap drone back to home (in a real system you'd stream waypoints)
  db.prepare(`
    UPDATE drones SET current_lat = ?, current_lng = ?, status = 'idle' WHERE id = ?
  `).run(cal.home_lat, cal.home_lng, drone.id);

  const updated = db.prepare(`SELECT * FROM drones WHERE id = ?`).get(drone.id);
  res.json({ data: { drone: updated, message: "Drone returned to home coordinates and set to idle" } });
});

module.exports = router;
