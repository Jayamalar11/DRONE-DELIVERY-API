# Drone Delivery Tracker — API v2

Node + Express + SQLite tracking backend for drone-based deliveries.

---

## Setup

```bash
npm install
npm run setup   # migrate + seed
npm start       # http://localhost:3000
```

Override port: `PORT=8080 npm start`

---

## Project structure

```
drone-delivery/
├── package.json
├── data/                         ← SQLite DB lives here (auto-created)
└── src/
    ├── server.js                 ← Express app, middleware, graceful shutdown
    ├── middleware/
    │   └── validate.js           ← Body validation helper
    ├── db/
    │   ├── connection.js         ← Singleton DB (WAL + FK enforced)
    │   ├── migrate.js            ← CREATE TABLE + indexes
    │   └── seed.js               ← Realistic sample data
    └── routes/
        ├── shipments.js          ← GET + PATCH /api/shipments
        ├── customers.js          ← GET /api/customers
        ├── drones.js             ← GET + PATCH + POST /api/drones
        └── admin.js              ← Operational commands (assign, complete, fail, return-home)
```

---

## Data model

```
customers  ──< shipments >── drones
                  │
                  └──< tracking_events
drones ──── drone_calibrations (1-to-1)
```

- `shipments.drone_id` is a real FK — telemetry events are created from this link.
- Status transitions are forward-only; terminal states block further updates.

---

## API reference

### Shipments

| Method | Path | Body / Query |
|--------|------|--------------|
| GET | `/api/shipments` | `?status=` `?customer_id=` |
| GET | `/api/shipments/:trackingId` | — |
| GET | `/api/shipments/:trackingId/events` | — |
| PATCH | `/api/shipments/:trackingId/status` | `{ status, description? }` |

#### Status values
`pending → assigned → in_transit → out_for_delivery → delivered`  
`pending / assigned / in_transit → failed`  
`pending → cancelled`

---

### Customers

| Method | Path |
|--------|------|
| GET | `/api/customers` |
| GET | `/api/customers/:id` |
| GET | `/api/customers/:id/shipments` |

---

### Drones

| Method | Path | Body |
|--------|------|------|
| GET | `/api/drones` | `?status=idle` |
| GET | `/api/drones/fleet-summary` | — |
| GET | `/api/drones/:id` | — (includes calibration + active shipment) |
| PATCH | `/api/drones/:id/status` | `{ status }` (not `in_flight`) |
| PATCH | `/api/drones/:id/calibration` | any calibration fields |
| POST | `/api/drones/:id/telemetry` | `{ lat, lng, battery_level, speed?, heading? }` |

---

### Admin / Operations

| Method | Path | Body |
|--------|------|------|
| POST | `/api/admin/shipments/:trackingId/assign-drone` | `{ drone_id }` |
| POST | `/api/admin/shipments/:trackingId/complete` | `{ description? }` |
| POST | `/api/admin/shipments/:trackingId/fail` | `{ description? }` |
| POST | `/api/admin/drones/:id/return-home` | — |

---

## curl examples

```bash
# List all shipments
curl http://localhost:3000/api/shipments

# Filter by status
curl "http://localhost:3000/api/shipments?status=in_transit"

# Shipment detail
curl http://localhost:3000/api/shipments/DRN-2024-0002

# Tracking events
curl http://localhost:3000/api/shipments/DRN-2024-0002/events

# Fleet summary
curl http://localhost:3000/api/drones/fleet-summary

# Drone with calibration
curl http://localhost:3000/api/drones/1

# Update calibration
curl -X PATCH http://localhost:3000/api/drones/1/calibration \
  -H "Content-Type: application/json" \
  -d '{ "max_payload_kg": 3.0, "cruise_speed_mps": 19.5 }'

# Assign Falcon-3 (id=3, idle) to pending shipment DRN-2024-0004
curl -X POST http://localhost:3000/api/admin/shipments/DRN-2024-0004/assign-drone \
  -H "Content-Type: application/json" \
  -d '{ "drone_id": 3 }'

# Send telemetry (auto-creates tracking event on linked shipment)
curl -X POST http://localhost:3000/api/drones/3/telemetry \
  -H "Content-Type: application/json" \
  -d '{ "lat": 12.975, "lng": 77.743, "battery_level": 88, "speed": 20, "heading": 215 }'

# Mark delivered
curl -X POST http://localhost:3000/api/admin/shipments/DRN-2024-0004/complete \
  -H "Content-Type: application/json" \
  -d '{ "description": "Left with neighbour — unit 4B" }'

# Return drone home
curl -X POST http://localhost:3000/api/admin/drones/3/return-home
```
