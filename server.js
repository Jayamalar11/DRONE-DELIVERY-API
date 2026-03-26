const express = require("express");
const cors    = require("cors");

const shipmentsRouter = require("./routes/shipments");
const dronesRouter    = require("./routes/drones");
const customersRouter = require("./routes/customers");
const adminRouter     = require("./routes/admin");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Core middleware ───────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Request logger ────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/shipments", shipmentsRouter);
app.use("/api/drones",    dronesRouter);
app.use("/api/customers", customersRouter);
app.use("/api/admin",     adminRouter);

// ── Health / meta ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

app.get("/api", (_req, res) => {
  res.json({
    version: "2.0.0",
    endpoints: [
      // Shipments
      "GET    /api/shipments",
      "GET    /api/shipments?status=<status>",
      "GET    /api/shipments/:trackingId",
      "GET    /api/shipments/:trackingId/events",
      "PATCH  /api/shipments/:trackingId/status",
      // Customers
      "GET    /api/customers",
      "GET    /api/customers/:id",
      "GET    /api/customers/:id/shipments",
      // Drones
      "GET    /api/drones",
      "GET    /api/drones?status=<status>",
      "GET    /api/drones/fleet-summary",
      "GET    /api/drones/:id",
      "PATCH  /api/drones/:id/status",
      "PATCH  /api/drones/:id/calibration",
      "POST   /api/drones/:id/telemetry",
      // Admin / operations
      "POST   /api/admin/shipments/:trackingId/assign-drone",
      "POST   /api/admin/shipments/:trackingId/complete",
      "POST   /api/admin/shipments/:trackingId/fail",
      "POST   /api/admin/drones/:id/return-home",
    ],
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error", detail: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚁  Drone Delivery Tracker v2  →  http://localhost:${PORT}`);
  console.log(`    API index : http://localhost:${PORT}/api`);
  console.log(`    Health    : http://localhost:${PORT}/health\n`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully…`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
