# long-tail-dbos-onprem

A Long Tail factory site on DBOS that takes fabrication orders from a cloud, builds them on the local network, and reports the result.

The site polls a cloud Long Tail over outbound HTTPS, claims the orders advertised to the `fabrication` role, and downloads each order's files at claim time. From there the order runs on the factory LAN: a DBOS workflow drives the printer over MQTT, a person inspects the part on the site's own dashboard, and the last step resolves the cloud's wait. An order in progress continues through an internet outage and through a restart of the site.

The cloud half lives in [long-tail-temporal-cloud](https://github.com/hotmeshio/long-tail-temporal-cloud).

## How an order moves

1. **Claim.** `POST /api/escalations/claim-by-facets` on the cloud, one atomic call per pass. One site holds each order.
2. **Stage.** The site reads the order, downloads its files through signed links into `WORK_DIR/<escalationId>/` and verifies each checksum.
3. **Start.** The `fabricate` workflow starts with the cloud escalation id as its workflow id, so each order has one run. Every pass also reads the site's own claims and starts any order that has no run yet.
4. **Print.** The workflow sends the job to the printer through the machine gateway over MQTT. The printer fetches the model from the site's asset server.
5. **Inspect.** A `floor-inspector` task appears on the site dashboard. The inspector records pass or fail and the unit count.
6. **Report.** The workflow resolves the cloud row by signal key. While the cloud is out of reach it retries with capped backoff for as long as it takes.
7. **Clean up.** The order's work directory is removed.

| Situation | What the site does |
|---|---|
| The print fails | A `floor-lead` task offers a retry or a rejection |
| The cloud is out of reach during intake | The pass is logged and the next one tries again |
| The cloud is out of reach during the report | The report step retries until it lands |
| The site restarts mid-order | DBOS resumes the run from its last completed step |
| The cloud stopped waiting (expired or cancelled) | A `floor-lead` task records that the order closed without a report |
| The report already landed | The repeat counts as delivered |

## Run it locally

Start the cloud stack (`docker compose up -d --build` in `long-tail-temporal-cloud`) and issue this site its key there:

```bash
npm run site-key
```

Copy `.env.example` to `.env`, set `CLOUD_API_KEY` and `CLOUD_BOT_ID` from that output, then start the site:

```bash
docker compose up -d --build
```

| Service | Address |
|---|---|
| Site dashboard and API | http://localhost:3700 (superadmin / l0ngt@1l) |
| Asset server | http://localhost:3701 |
| Postgres | localhost:5437 |
| NATS | localhost:4822 |
| MQTT | localhost:1893 |

The compose file includes a mock printer that speaks the machine contract over MQTT and finishes a job in `PRINT_SECONDS`. The site reaches the cloud at `http://host.docker.internal:3600` and calls it as its bot, with the key from `.env`.

Start an order on the cloud (dashboard at http://localhost:3600, Invoke, `fabricationOrderRequest`). Within a few seconds the site claims it, the mock printer runs, and an inspection task appears at http://localhost:3700. Resolve it and the cloud workflow completes with `status: fabricated`.

## Connect to a deployed cloud

Run `npm run site-key` against the deployed cloud and give the site the three values it prints:

```bash
CLOUD_URL=https://cloud.example.com
CLOUD_API_KEY=lt_bot_...
CLOUD_BOT_ID=...
```

Each call to the cloud carries the key, and the cloud validates it with one indexed read.

## Deploy

The site runs on a machine on the factory LAN, registered with AWS through ECS Anywhere. Postgres, NATS and Mosquitto run as services on the machine and start with or without internet; the app runs as an ECS service, so a version tag pushed to GitHub builds the image and updates the machine. Backups go to S3, logs to CloudWatch, and an alarm fires when the machine has been silent for three hours.

[deploy/README.md](deploy/README.md) covers the stacks, the secrets and the first deploy. [docs/provision-machine.md](docs/provision-machine.md) takes a fresh Ubuntu host, or a Linux VM on a Mac, to a running site.

## Layout

```
src/
  index.ts                  boot: DBOS, Long Tail, machine gateway, intake
  services/intake/          claim, stage, start
  services/asset-server.ts  serves staged files to machines on the LAN
  lib/cloud-client/         typed client for the cloud API
  workflows/fabricate.ts    print, inspect, report, clean up
  activities/               plan, assets and cloud steps
  config/                   roles, line, workers, workflow bot
  modules/                  config (env) and constants
lines/site-line.json        the line and its machines
mock/                       mock printer
deploy/cdk/                 AWS side of the site: registry, cluster, role, secrets, backups, logs
deploy/machine/             Site machine: provisioning, registration, the services beside the app
```

## Tests

```bash
npm test                   # unit, mocked
npm run test:integration   # both compose stacks running
npm run typecheck
```

The integration test drives an order from the cloud to the site and back four ways: straight through, with the site restarted during inspection, with the cloud paused during the report, and with the cloud wait expired before the site finishes. It restarts and pauses containers through `docker compose -p`, using the project names `long-tail-dbos-onprem` and `long-tail-temporal-cloud` (`SITE_COMPOSE_PROJECT`, `CLOUD_COMPOSE_PROJECT`).

## Configuration

`.env.example` lists every variable with its local default. `DBOS__VMID` stays the same across restarts so the site recovers its own orders.
