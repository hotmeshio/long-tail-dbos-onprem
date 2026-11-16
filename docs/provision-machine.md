# Provision the site machine

The site machine is an Ubuntu 24.04 host with Docker. It runs Postgres, NATS and Mosquitto as services that start at boot, and the app as the ECS Anywhere service that a version tag deploys. This guide takes a fresh Ubuntu host to a running site in five steps. The scripts are in `deploy/machine`.

Before you start, complete the first deploy in [deploy/README.md](../deploy/README.md): the stacks exist, the cloud key is stored, and the service is at zero tasks.

## 1. Get an Ubuntu host

Any Ubuntu 24.04 machine works, arm64 or amd64: 4 CPUs, 8 GB of memory and 60 GB of disk fit the site with room for order files.

### A VM on a Mac

ECS Anywhere registers a Linux host, so on a Mac the site is a Linux VM. [Multipass](https://canonical.com/multipass) creates one from the terminal:

```bash
brew install --cask multipass
multipass launch 24.04 --name site-1 --cpus 4 --memory 8G --disk 60G
multipass info site-1          # shows the VM's address
```

The VM shares the Mac's network connection. The Mac reaches the VM at the address `multipass info` prints, and the VM reaches the internet through the Mac. The site is up while the Mac is awake: closing the lid pauses the VM, and opening it resumes the site where it stopped, with every order in flight intact.

A site that serves tablets and printers on the LAN uses a machine with its own LAN address: a dedicated host, or a VM with bridged networking and a DHCP reservation.

## 2. Provision

Copy the scripts to the host and run the provisioner. From the repository root on your workstation, for the Multipass VM:

```bash
multipass transfer -r deploy/machine site-1:machine
multipass exec site-1 -- sudo AWS_REGION=us-west-2 bash machine/provision.sh
```

On any other host, copy `deploy/machine` over and run `sudo AWS_REGION=us-west-2 bash machine/provision.sh` there.

`provision.sh` installs Docker Engine, the AWS CLI, time sync and unattended security updates, then lays out the machine:

| Path | Holds |
|---|---|
| `/opt/onpremsite` | The compose file, broker configs and scripts |
| `/etc/onpremsite/site.env` | Region and paths |
| `/etc/onpremsite/secrets.env` | Postgres password and NATS token, readable by root |
| `/var/lib/onpremsite/postgres` | The database |
| `/var/lib/onpremsite/work` | Files of claimed orders, mounted into the app at `/work` |

It also installs the systemd unit `onpremsite-services`. Running the script again updates the files in place.

## 3. Register

Create a one-use activation on your workstation, with the profile that deployed the stacks:

```bash
aws ssm create-activation --iam-role OnPremSite-InstanceRole \
  --registration-limit 1 --default-instance-name site-1 \
  --query '[ActivationId,ActivationCode]' --output text
```

Pass the id and code to the host:

```bash
multipass exec site-1 -- sudo /opt/onpremsite/register.sh <activation-id> <activation-code>
```

`register.sh` runs four steps:

1. Installs the Systems Manager and ECS agents and registers the machine into the `onpremsite` cluster. From here the machine holds `OnPremSite-InstanceRole` through credentials Systems Manager rotates.
2. Records the image repository address.
3. Copies the Postgres password and NATS token from Secrets Manager to `/etc/onpremsite/secrets.env`.
4. Enables and starts `onpremsite-services`.

The script ends with the three services listed as healthy. Confirm the registration from your workstation:

```bash
aws ecs list-container-instances --cluster onpremsite
```

## 4. Deploy the app

Push a version tag to build the first image, then raise the service to one task:

```bash
git tag v0.1.0 && git push origin v0.1.0
gh run watch                                  # tests, image, cdk deploy

gh variable set SITE_DESIRED_COUNT --body 1
cd deploy/cdk && SITE_DESIRED_COUNT=1 npx cdk deploy OnPremSite-Site
```

ECS starts the app on the machine. Open the dashboard at `http://<host address>:3000` and sign in as `superadmin` with the generated password:

```bash
aws secretsmanager get-secret-value --secret-id OnPremSite/AdminPassword \
  --query SecretString --output text | pbcopy
```

## 5. Add a printer

A site with a real printer points it at the machine's MQTT broker. Set `MQTT_BIND=0.0.0.0` in `/etc/onpremsite/site.env` and restart `onpremsite-services` to open port 1883 to the LAN.

A site with no printer yet runs the stand-in from the site image:

```bash
multipass exec site-1 -- sudo /opt/onpremsite/enable-mock-printer.sh
```

It answers as `printer-01` on the local broker and completes each print in `PRINT_SECONDS` (default 5, set in `site.env`).

## Day to day

| Task | Command on the host |
|---|---|
| Service status | `sudo /opt/onpremsite/compose-services.sh ps` |
| Service logs | `sudo /opt/onpremsite/compose-services.sh logs -f postgres` |
| App container and logs | `sudo docker ps`, then `sudo docker logs -f <container>` |
| Agent status | `systemctl status ecs amazon-ssm-agent` |
| Refresh secrets after a rotation | `sudo /opt/onpremsite/sync-secrets.sh`, then `sudo systemctl restart onpremsite-services` |

The Postgres password is set when the database is first created. To rotate it, change it in Postgres with `ALTER USER`, store the same value in `OnPremSite/PostgresPassword`, run `sync-secrets.sh` and redeploy the app.

## Start over

```bash
multipass delete site-1 && multipass purge
```

Then deregister the machine in Systems Manager (Fleet Manager) and set `SITE_DESIRED_COUNT` back to `0`.
