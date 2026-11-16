# Deploy to AWS

The site runs on a machine on the factory LAN. The CDK app in `deploy/cdk` creates what that machine uses in AWS: an image repository, an ECS cluster it registers into through ECS Anywhere, its role, its secrets, a backup bucket, log groups and an alarm for silence. Every call between the machine and AWS is outbound from the machine.

## What gets created

| Stack | Resources |
|---|---|
| `OnPremSite-Registry` | ECR repository `onpremsite`, scanned on push, holding the last 60 images |
| `OnPremSite-Storage` | Backup bucket (versioned, encrypted, private) and the secrets below |
| `OnPremSite-Logs` | Log groups `/site/onpremsite/app`, `/services` and `/host`, an SNS topic, and the silence alarm |
| `OnPremSite-Site` | ECS cluster `onpremsite`, the role the machine holds, the `app` task definition and service (launch type `EXTERNAL`) |
| `OnPremSite-GithubOidc` | The role GitHub Actions assumes to deploy, limited to version tags of one repository |

## What runs where on the machine

| Runs as | Parts | Starts |
|---|---|---|
| Services on the machine | Postgres, NATS, Mosquitto, the log shipper, the backup timer | at boot, with or without internet |
| ECS Anywhere service `app` | the Long Tail app from this repository | by the ECS agent; restarted in place by the agent when it exits |

The app shares the machine's network and reaches Postgres, NATS and Mosquitto on `127.0.0.1`. Files of claimed orders live in `/var/lib/onpremsite/work` on the machine, mounted at `/work`. The app's container logs stay on the machine's disk (50 MB x 5); the log shipper forwards them to CloudWatch when the link is up.

The machine's role allows it to pull the image, read and write the backup bucket, write to the three log groups and read the five secrets.

## Where each secret lives

| Value | Local | Runtime |
|---|---|---|
| Cloud key and bot id | `.env` (`CLOUD_API_KEY`, `CLOUD_BOT_ID`) | `OnPremSite/CloudBot`, JSON fields `apiKey` and `botId`, written once by you |
| Admin password | `.env` | `OnPremSite/AdminPassword`, generated |
| JWT signing key | `.env` | `OnPremSite/JwtSigningKey`, generated |
| NATS token | compose default | `OnPremSite/NatsToken`, generated |
| Postgres password | compose default | `OnPremSite/PostgresPassword`, generated |

ECS injects the secrets into the app at start. The services on the machine read the NATS token and Postgres password with the machine's role. GitHub holds one role ARN and plain settings as repository variables, and reaches AWS through OIDC.

## Settings

Each setting is CDK context (`-c name=value`); some also read an environment variable.

| Context | Environment | Default | Meaning |
|---|---|---|---|
| `cloudUrl` | `CLOUD_URL` | required | The cloud Long Tail this site takes work from |
| `desiredCount` | `SITE_DESIRED_COUNT` | `0` | `1` once the machine is registered and an image is pushed |
| `imageTag` | `SITE_IMAGE_TAG` | `latest` | Image tag the service runs |
| `assetBaseUrl` | `SITE_ASSET_BASE_URL` | `http://127.0.0.1:3001` | Where machines on the LAN fetch order files: the machine's LAN address |
| `alarmEmail` | `SITE_ALARM_EMAIL` | none | Receives the silence alarm |
| `silenceHours` | | `3` | Hours with no log line before the alarm fires |
| `logRetentionDays` | | `30` | CloudWatch retention |
| `backupTransitionDays` | | `30` | Days before backups move to Glacier Instant Retrieval |
| `backupExpirationDays` | | `365` | Days before backups are deleted |

## First deploy

You need an AWS account and a deployed cloud with a site key (`npm run site-key` on the cloud repository).

```bash
cd deploy/cdk
npm ci

export AWS_PROFILE=...            # the account to deploy into
export AWS_REGION=us-west-2
export CLOUD_URL=https://cloud.example.com

# 1. Once per account and region
npx cdk bootstrap

# 2. Everything, with the service at zero tasks
npx cdk deploy --all

# 3. Store the site's cloud key, with CLOUD_API_KEY and CLOUD_BOT_ID exported from the site-key output
aws secretsmanager put-secret-value --secret-id OnPremSite/CloudBot \
  --secret-string "$(jq -n --arg apiKey "$CLOUD_API_KEY" --arg botId "$CLOUD_BOT_ID" '{apiKey: $apiKey, botId: $botId}')"
```

Provision and register the machine with the scripts in `deploy/machine`; [docs/provision-machine.md](../docs/provision-machine.md) walks through it, including a Linux VM on a Mac. In short, on your workstation:

```bash
aws ssm create-activation --iam-role OnPremSite-InstanceRole \
  --registration-limit 1 --default-instance-name site-1
```

Then on the machine, with the id and code that command returned:

```bash
sudo AWS_REGION=us-west-2 bash machine/provision.sh
sudo /opt/onpremsite/register.sh <id> <code>
```

Push the first image by pushing a version tag (next section), then start the app:

```bash
SITE_DESIRED_COUNT=1 npx cdk deploy OnPremSite-Site
```

## Deploys from GitHub Actions

Create the deploy role once. The stack uses the GitHub OIDC provider the account already has.

```bash
npx cdk deploy OnPremSite-GithubOidc -c githubOwner=<owner> -c githubRepo=<repo>
```

The role trusts tokens whose subject starts with `repo:<owner>/<repo>`. A repository with immutable subject claims issues a prefix that carries the owner and repository ids. Read it, and pass it when it differs:

```bash
gh api repos/<owner>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix
npx cdk deploy OnPremSite-GithubOidc -c githubOwner=<owner> -c githubRepo=<repo> \
  -c githubSubjectPrefix='repo:<owner>@<owner-id>/<repo>@<repo-id>'
```

Set these repository variables:

| Variable | Value |
|---|---|
| `AWS_ROLE_ARN` | the `RoleArn` output of `OnPremSite-GithubOidc` |
| `AWS_REGION` | the region you deployed to |
| `CLOUD_URL` | the cloud address |
| `SITE_DESIRED_COUNT` | `0` until the machine is registered, then `1` |
| `SITE_ASSET_BASE_URL` | the machine's LAN address with the asset port, e.g. `http://192.168.1.50:3001` |
| `SITE_ALARM_EMAIL` | optional |

Pushing a tag such as `v0.1.0` runs `.github/workflows/deploy.yml`: tests, one image built for `linux/arm64` and `linux/amd64` and pushed as `:v0.1.0` and `:latest`, then `cdk deploy --all` with that tag. ECS stops the running task and starts the new image on the machine; a release that fails to start rolls back to the previous one.

A deploy completes when the machine is online. While the machine is offline it keeps running the image it has, and the next deploy brings it up to date.

The deploy role holds `AdministratorAccess`, which CloudFormation needs to create the resources above. In an account shared with other systems, replace it with a policy scoped to these stacks.

## The silence alarm

`onpremsite-silent` sums log events across the three groups per hour and fires after `silenceHours` hours with none: the machine is off or offline. It notifies the `onpremsite-alarms` topic on alarm and on recovery. It stays in alarm until the machine ships its first log line.

## Rotating the site's cloud key

Run `npm run site-key` on the cloud repository, store the new values with the step 3 command, then restart the app:

```bash
aws ecs update-service --cluster onpremsite --service app --force-new-deployment
```

## Cost

About $10 a month in `us-west-2`: the ECS Anywhere instance $7.40, five secrets $2, plus CloudWatch log ingestion at $0.50 per GB and backup storage at S3 rates.

## Teardown

```bash
npx cdk destroy --all
```

The backup bucket and the image repository are retained; delete both by hand when their contents are no longer needed. Deregister the machine in Systems Manager.

## Tests

```bash
cd deploy/cdk
npm run build   # typecheck
npm test        # synthesizes every stack with fixed context, no AWS calls
```
