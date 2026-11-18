# long-tail-dbos-onprem

The Acme Eyeglass production site: Long Tail on DBOS, on the factory network. It claims production orders from a cloud, prints the frame, runs the lens line, fits, packs, and reports the result.

A customer orders a pair of glasses. The cloud reviews the prescription, takes the order and advertises it to the `production` role. This site polls the cloud over outbound HTTPS, claims the order as the bot `site-1`, and downloads its frame file and prescription at claim time. From there the order runs on the factory LAN: a DBOS workflow sends the frame to a printer over MQTT, hands the lenses along the lens line, and parks at each station where a person works. The last step resolves the cloud's wait, and the cloud books the carrier. An order in progress continues through an internet outage and through a restart of the site.

The cloud half lives in [long-tail-temporal-cloud](https://github.com/hotmeshio/long-tail-temporal-cloud).

## The story, chapter by chapter

Chapters 1, 2 and 7 (the order, the prescription review, shipping) run in the cloud. The site runs the four in between.

| Chapter | What happens | Queues |
|---|---|---|
| 3. Print a frame | The frame file goes to printer `p1s-01` (serial `PRN-001`) on line `print-1`. The printed frame waits for a person to take it off the plate. | `printer-fleet`, `print-unload`, `print-servicing` |
| 4. The print farm | Every frame waiting for a printer or printing is a row keyed by `serialNumber`; the Lines page shows the printer, its job and its queue. | `printer-fleet` |
| 5. Lens line and assembly | Line `line-1` edges the lenses (`edge-01`), mounts them (`mount-01`) and inspects the pair (`inspect-01`). A fitter does the final fit. | `edge-cell`, `mount-cell`, `inspect-cell`, `line-operator`, `hand-mount`, `fitter` |
| 6. Pack | The boxed order waits for its scan into the open bin for its destination (`bin-7`, Portland). A full bin, or a shift lead, ships it. | `package`, `bin`, `shift-lead` |

## How an order moves

1. **Claim.** `POST /api/escalations/claim-by-facets` on the cloud, one atomic call per pass. One site holds each order.
2. **Stage.** The site reads the order, downloads the files named `frame` and `prescription` through signed links into `WORK_DIR/<escalationId>/` and verifies each checksum.
3. **Start.** The `makeGlasses` workflow starts with the cloud escalation id as its workflow id, so each order has one run. Every pass also reads the site's own claims and starts any order that has no run yet.
4. **Print the frame.** The workflow sends the job to the printer through the machine gateway over MQTT. The printer fetches the frame file from the site's asset server. The finished print opens a `print-unload` row; the person who clears the plate records good and scrapped parts.
5. **Lens line.** The unit moves from the edger to the mounting press to the inspection camera, one handoff per station. The inspected pair opens a `fitter` row for the final fit.
6. **Pack.** The boxed order opens a `package` row and the destination's `bin` row collects it. A packer scans the package, then the bin.
7. **Report.** The workflow resolves the cloud row by signal key (`production-<orderId>`) with a `ProductionOutcome`. While the cloud is out of reach it retries with capped backoff for as long as it takes.
8. **Clean up.** The order's work directory is removed.

| Situation | What the site does |
|---|---|
| The print stops | A `print-servicing` row offers a retry, a manual finish or scrap |
| A lens station rejects the unit | A `line-operator` row offers a manual finish or scrap |
| The mounting press cannot mount | Chosen manual, the unit goes to `hand-mount`, then to `fitter` |
| The order is scrapped | The cloud hears `completed: false` with the reason |
| The cloud is out of reach during intake | The pass is logged and the next one tries again |
| The cloud is out of reach during the report | The report step retries until it lands |
| The site restarts mid-order | DBOS resumes the run from its last completed step |
| The cloud stopped waiting (expired or cancelled) | A `shift-lead` row records that the order closed without a report |
| The report already landed | The repeat counts as delivered |

## Roles and queues

Each role owns its form and list schema. The workflow bot `dbos-workflows` opens every row.

| Role | Who works it | A row is | Answered with |
|---|---|---|---|
| `printer-fleet` | Printers | A frame waiting for a printer, or printing | The printer, over MQTT |
| `print-unload` | Uma (unload) | A printed frame on its plate | Good parts, scrapped parts |
| `print-servicing` | Sam (servicing) | A print that stopped | Retry, manual or scrap |
| `edge-cell` | Edger `edge-01` | Lenses at the edger (`RCP-EDGE-A`) | The station, over MQTT |
| `mount-cell` | Press `mount-01` | Lenses at the mounting press (`RCP-MOUNT-A`) | The station, over MQTT |
| `inspect-cell` | Camera `inspect-01` | A pair at inspection (`RCP-INSPECT-A`) | The station, over MQTT |
| `line-operator` | Olive (line operator) | A unit that stopped on the lens line | Manual or scrap |
| `hand-mount` | Hank (hand mount) | A pair to mount by hand | Received |
| `fitter` | Fay (fitter) | A pair ready for its final fit | Received |
| `package` | Pat (packer) | One boxed order waiting for its bin | A scan into the bin |
| `bin` | Pat (packer) | One open bin per destination | Filling up, or Ship via |
| `shift-lead` | Lee (shift lead) | An order the cloud stopped waiting for | An acknowledgement |

Scan schemes: `11` badge, `12` package (`12:0:A-1042`), `13` bin (`13:0:bin-7`), `21` printer (`21:1:PRN-001`). Scanning a package holds it and names its bin; scanning that bin places it, under the signed-in person or a scanned badge.

The site creates one member per human queue at startup. Set `PEOPLE_PASSWORD` and they can sign in.

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

The compose file includes a mock floor that speaks the machine contract over MQTT: the printer finishes a job in `PRINT_SECONDS`, each lens station in `STATION_SECONDS`. `STATION_REJECTS=inspect-01:A-1044` makes a machine stop an order on its first try. The site reaches the cloud at `http://host.docker.internal:3600` and calls it as its bot, with the key from `.env`.

## Walk an order through

1. On the cloud dashboard (http://localhost:3600), invoke `eyeglassOrderRequest` with `orderId: A-1042` and approve the order there until it reaches `production`.
2. Within a few seconds the site claims it. On http://localhost:3700, **Lines** shows `print-1` with the frame on `p1s-01`.
3. Open the `print-unload` queue, claim the row, enter one good part and submit.
4. **Lines**, `line-1`: the unit passes the edger, the press and the camera.
5. Open the `fitter` queue, claim the row, tick Received and submit.
6. On **Scan**, scan `12:0:A-1042`, then `13:0:bin-7`. The package row closes and the bin row counts one order.
7. The site reports to the cloud. The cloud's `production` row resolves and a `carrier-pickup` row opens there.

## Seed the story

`npm run seed:story` puts one order in the queue of each site chapter, with the cloud out of the picture:

```bash
docker compose exec app npm run seed:story
```

| Order | Stops at | Chapter |
|---|---|---|
| `A-1042` | `package`, with `bin-7` open | 6. Pack |
| `A-1043` | `fitter` | 5. Lens line and assembly |
| `A-1044` | `print-unload` | 3. Print a frame |
| `A-1045` | `printer-fleet`, behind `A-1044` | 4. The print farm |

The script signs in as the admin, starts each order as a `makeGlasses` run with the workflow id `story-<orderId>`, and answers the station rows ahead of the queue the order stops in. An order that already has a run keeps it, so the script is safe to run again. It runs where the app runs, because the app serves the staged files from `WORK_DIR`; it needs the app, the mock floor and `LT_ADMIN_PASSWORD`. `STORY_SITE_URL`, `STORY_POLL_MS` and `STORY_TIMEOUT_MS` adjust it.

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
  services/story.ts         the seeded story orders
  lib/cloud-client/         typed client for the cloud API
  lib/floor-client.ts       the site's own API, as a person at a station uses it
  workflows/make-glasses.ts plan, verify, build, report, clean up
  workflows/print.ts        the frame on the print line
  workflows/lens-line.ts    edge, mount, inspect, final fit
  workflows/pack.ts         the boxed order and its bin
  workflows/rollup-bin.ts   one open bin per destination
  workflows/report.ts       the outcome, back to the cloud
  activities/               plan, assets, bin and cloud steps
  config/                   roles, lines, scan schemes, people, workers, workflow bot
  modules/                  config (env) and constants
  types/production.ts       the order and outcome shapes shared with the cloud
lines/print-line.json       line print-1 and its printer
lines/lens-line.json        line line-1 and its stations
mock/                       mock printer and lens stations
scripts/seed-story.ts       npm run seed:story
deploy/cdk/                 AWS side of the site: registry, cluster, role, secrets, backups, logs
deploy/machine/             Site machine: provisioning, registration, the services beside the app
```

The roles, lines and scan schemes are owned by code: every boot applies `src/config/` and the line files to the site's database.

## Tests

```bash
npm test                   # unit, mocked
npm run test:integration   # both compose stacks running
npm run typecheck
```

The integration test drives an order from the cloud to the site and back four ways: straight through, with the site restarted at the final fit, with the cloud paused during the report, and with the cloud wait expired before the site finishes. It restarts and pauses containers through `docker compose -p`, using the project names `long-tail-dbos-onprem` and `long-tail-temporal-cloud` (`SITE_COMPOSE_PROJECT`, `CLOUD_COMPOSE_PROJECT`).

## Configuration

`.env.example` lists every variable with its local default. `DBOS__VMID` stays the same across restarts so the site recovers its own orders.
