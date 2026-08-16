# Backend — Infrastructure Skeleton

This is the first coding step: config loading, DB connection, and the
`app.js`/`server.js` split, with nothing but a health check route.
Auth and every other module get built on top of this next.

## Setup

```bash
npm install
cp .env.example .env
# fill in mongoUrl, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, FRONTEND_URL
# at minimum — those four are validated at startup and required to boot
npm run dev
```

## Verify the green flag

```bash
curl http://localhost:3000/health
# expect: {"success":true,"data":{"status":"ok","env":"development"}}
```

If MongoDB connects and `/health` responds, the infrastructure layer is
confirmed working — this is the checkpoint before any Auth logic gets
added on top of it.

## What's intentionally not here yet

No routes beyond `/health`, no modules, no Socket.IO event handlers.
Those get added module by module, starting with Authentication, each
verified via Postman + its own Vitest/Supertest suite before moving to
the next.
