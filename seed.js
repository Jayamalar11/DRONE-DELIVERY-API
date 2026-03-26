const { getDb } = require("./connection");

function seed() {
  const db = getDb();

  // Wipe in FK-safe order
  db.exec(`
    DELETE FROM tracking_events;
    DELETE FROM shipments;
    DELETE FROM drone_calibrations;
    DELETE FROM drones;
    DELETE FROM customers;
  `);

  // ── Customers ────────────────────────────────────────────────────────────────
  const addCustomer = db.prepare(
    `INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)`
  );
  const c1 = addCustomer.run("Priya Nair",   "priya.nair@example.com",   "+91-98400-11111");
  const c2 = addCustomer.run("Arjun Mehta",  "arjun.mehta@example.com",  "+91-98400-22222");
  const cid1 = c1.lastInsertRowid;
  const cid2 = c2.lastInsertRowid;

  // ── Drones ───────────────────────────────────────────────────────────────────
  const addDrone = db.prepare(`
    INSERT INTO drones (name, status, current_lat, current_lng, battery_level)
    VALUES (?, ?, ?, ?, ?)
  `);
  const d1 = addDrone.run("Falcon-1", "in_flight", 13.0950,  80.2420, 72);
  const d2 = addDrone.run("Falcon-2", "charging",  12.9698,  77.7499, 34);
  const d3 = addDrone.run("Falcon-3", "idle",      19.1136,  72.8697, 98);
  const did1 = d1.lastInsertRowid;
  const did2 = d2.lastInsertRowid;
  const did3 = d3.lastInsertRowid;

  // ── Drone Calibrations ───────────────────────────────────────────────────────
  const addCal = db.prepare(`
    INSERT INTO drone_calibrations
      (drone_id, max_payload_kg, cruise_speed_mps, max_altitude_m, home_lat, home_lng, geofence_radius_m)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  addCal.run(did1, 2.5, 18.0, 120.0, 13.0827, 80.2707, 15000.0);
  addCal.run(did2, 3.0, 15.5, 100.0, 12.9698, 77.7499, 12000.0);
  addCal.run(did3, 4.0, 20.0, 150.0, 19.1136, 72.8697, 20000.0);

  // ── Shipments ────────────────────────────────────────────────────────────────
  const addShipment = db.prepare(`
    INSERT INTO shipments
      (tracking_id, customer_id, drone_id, origin, destination, status, eta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now',?), datetime('now',?))
  `);

  const shipDefs = [
    // [trackingId, customerId, droneId, origin, destination, status, eta, createdOffset, updatedOffset]
    ["DRN-2024-0001", cid1, did1,  "Chennai Warehouse, Ambattur",    "Anna Nagar, Chennai",       "delivered",        "2024-06-01T10:30:00Z", "-3 hours",    "-1 hour"],
    ["DRN-2024-0002", cid1, did1,  "Chennai Warehouse, Ambattur",    "Velachery, Chennai",         "in_transit",       "2024-06-10T14:00:00Z", "-1 hour",     "-30 minutes"],
    ["DRN-2024-0003", cid2, did3,  "Mumbai Hub, Andheri",            "Bandra West, Mumbai",        "out_for_delivery", "2024-06-10T12:45:00Z", "-2 hours",    "-15 minutes"],
    ["DRN-2024-0004", cid2, null,  "Bengaluru Hub, Whitefield",      "Koramangala, Bengaluru",     "pending",          "2024-06-11T09:00:00Z", "-10 minutes", "-10 minutes"],
    ["DRN-2024-0005", cid1, did1,  "Chennai Warehouse, Ambattur",    "T Nagar, Chennai",           "failed",           "2024-06-09T11:00:00Z", "-5 hours",    "-2 hours"],
  ];

  const shipmentIds = shipDefs.map((s) => {
    const r = addShipment.run(...s);
    return r.lastInsertRowid;
  });

  // ── Tracking Events ──────────────────────────────────────────────────────────
  const addEvent = db.prepare(`
    INSERT INTO tracking_events
      (shipment_id, status, location_lat, location_lng, description, timestamp)
    VALUES (?, ?, ?, ?, ?, datetime('now',?))
  `);

  const eventDefs = [
    // DRN-2024-0001  — delivered
    [shipmentIds[0], "pending",          13.0827, 80.2707, "Order received at warehouse",                      "-3 hours"],
    [shipmentIds[0], "assigned",         13.0827, 80.2707, "Falcon-1 assigned",                               "-2 hours 50 minutes"],
    [shipmentIds[0], "in_transit",       13.0900, 80.2600, "Drone dispatched from Ambattur hub",               "-2 hours 30 minutes"],
    [shipmentIds[0], "telemetry",        13.0930, 80.2450, "Telemetry update · speed 18 m/s · battery 85%",   "-2 hours 15 minutes"],
    [shipmentIds[0], "out_for_delivery", 13.0950, 80.2350, "Approaching delivery zone",                        "-2 hours"],
    [shipmentIds[0], "delivered",        13.0878, 80.2185, "Package delivered successfully ✓",                 "-1 hour 45 minutes"],

    // DRN-2024-0002  — in_transit (active)
    [shipmentIds[1], "pending",          13.0827, 80.2707, "Order received at warehouse",                      "-1 hour"],
    [shipmentIds[1], "assigned",         13.0827, 80.2707, "Falcon-1 assigned",                               "-55 minutes"],
    [shipmentIds[1], "in_transit",       13.0700, 80.2550, "Drone airborne, cruising south",                   "-30 minutes"],
    [shipmentIds[1], "telemetry",        13.0600, 80.2490, "Telemetry update · speed 18 m/s · battery 72%",   "-10 minutes"],

    // DRN-2024-0003  — out_for_delivery (active)
    [shipmentIds[2], "pending",          19.1136, 72.8697, "Order received at Andheri hub",                    "-2 hours"],
    [shipmentIds[2], "assigned",         19.1136, 72.8697, "Falcon-3 assigned",                               "-1 hour 50 minutes"],
    [shipmentIds[2], "in_transit",       19.0800, 72.8500, "Drone en route to Bandra",                        "-1 hour"],
    [shipmentIds[2], "telemetry",        19.0620, 72.8350, "Telemetry update · speed 20 m/s · battery 61%",   "-30 minutes"],
    [shipmentIds[2], "out_for_delivery", 19.0540, 72.8282, "Drone in final approach",                         "-15 minutes"],

    // DRN-2024-0004  — pending (unassigned)
    [shipmentIds[3], "pending",          12.9698, 77.7499, "Order received, awaiting drone assignment",        "-10 minutes"],

    // DRN-2024-0005  — failed
    [shipmentIds[4], "pending",          13.0827, 80.2707, "Order received at warehouse",                      "-5 hours"],
    [shipmentIds[4], "assigned",         13.0827, 80.2707, "Falcon-1 assigned",                               "-4 hours 55 minutes"],
    [shipmentIds[4], "in_transit",       13.0560, 80.2490, "Drone dispatched",                                "-4 hours"],
    [shipmentIds[4], "telemetry",        13.0450, 80.2380, "Telemetry update · speed 18 m/s · battery 18% ⚠️ LOW BATTERY", "-3 hours"],
    [shipmentIds[4], "failed",           13.0450, 80.2380, "Delivery failed — critical battery, returning to base", "-2 hours"],
  ];

  eventDefs.forEach((e) => addEvent.run(...e));

  console.log("✅  Seed complete.");
  console.log(`   • 2 customers`);
  console.log(`   • 3 drones  (Falcon-1 in_flight, Falcon-2 charging, Falcon-3 idle)`);
  console.log(`   • 3 drone calibrations`);
  console.log(`   • 5 shipments  (delivered / in_transit / out_for_delivery / pending / failed)`);
  console.log(`   • ${eventDefs.length} tracking events`);
}

seed();
