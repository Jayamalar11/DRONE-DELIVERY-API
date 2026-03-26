const { Router } = require("express");
const { getDb }  = require("../db/connection");

const router = Router();

// ── GET /api/customers ────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  const db = getDb();
  const customers = db.prepare(`SELECT * FROM customers ORDER BY id`).all();
  res.json({ count: customers.length, data: customers });
});

// ── GET /api/customers/:id ────────────────────────────────────────────────────
router.get("/:id", (req, res) => {
  const db = getDb();
  const customer = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  res.json({ data: customer });
});

// ── GET /api/customers/:id/shipments ─────────────────────────────────────────
router.get("/:id/shipments", (req, res) => {
  const db = getDb();

  const customer = db.prepare(
    `SELECT id, name, email, phone FROM customers WHERE id = ?`
  ).get(req.params.id);

  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const shipments = db.prepare(`
    SELECT s.*, d.name AS drone_name, d.status AS drone_status
    FROM   shipments s
    LEFT   JOIN drones d ON d.id = s.drone_id
    WHERE  s.customer_id = ?
    ORDER  BY s.created_at DESC
  `).all(customer.id);

  const summary = {
    total:            shipments.length,
    delivered:        shipments.filter(s => s.status === "delivered").length,
    active:           shipments.filter(s => ["in_transit","out_for_delivery","assigned"].includes(s.status)).length,
    pending:          shipments.filter(s => s.status === "pending").length,
    failed_cancelled: shipments.filter(s => ["failed","cancelled"].includes(s.status)).length,
  };

  res.json({ data: { customer, summary, shipments } });
});

module.exports = router;
