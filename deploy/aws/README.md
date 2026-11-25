# Open Artifact host on AWS (EC2)

`open-artifact-host.yaml` is a CloudFormation template that sets up the Docker and Caddy deployment from
`deploy/docker` on a single EC2 instance. For what the host is and how to configure it, see
[packages/host/README.md](../../packages/host/README.md).

**Nothing on this page was run against AWS.** The template was checked offline only; see
[What was validated](#what-was-validated).

## What the stack creates

| Resource | Details |
| --- | --- |
| EC2 instance | Ubuntu 24.04 LTS (amd64), t3.medium by default. IMDSv2 is required. It has a 16 GiB encrypted root disk. |
| Data volume | A gp3 EBS volume, encrypted, 30 GiB by default, mounted at `/srv`. It holds Docker's state (the host's `/data` volume and Caddy's certificates), the checkout, `.env` and the local backups. When the stack deletes or replaces the volume, CloudFormation takes a snapshot first. |
| Elastic IP | A fixed public address for the DNS records. |
| Security group | Open to the world on 80/tcp (certificate challenges and redirects), 443/tcp and 443/udp (HTTP/3), for IPv4 and IPv6. Port 22 opens only to `SshCidr`, and only if you set it. |
| Instance role | `AmazonSSMManagedInstanceCore`, so you can open a shell with Session Manager and need no SSH. If you give `BackupBucket`, it also gets read, write and list access to that bucket's `open-artifact/` prefix. |

On first boot, the user-data script does the following:

1. It formats the data volume if the volume is new and mounts it at `/srv`.
2. It installs Docker and keeps Docker's state under `/srv/docker`.
3. It clones `RepoUrl` at `RepoRef` to `/srv/open-artifact`.
4. It writes `deploy/docker/.env` from `.env.example`, filling in your addresses and a newly generated
   `OA_SIGNING_KEYS`. It does this only once.
5. It runs `docker compose up -d --build`.
6. It sets up a systemd timer that runs `deploy/backup.sh` every day at about 03:30, writing to `/srv/backups` and,
   if you gave a bucket, to `s3://<BackupBucket>/open-artifact/`.

Its log is `/var/log/open-artifact-setup.log`.

## Deploy

1. **Choose two names on two different registrable domains:** an app host such as `artifacts.example.com` and a
   content domain such as `oa-content.example.net`. The packages/host README explains why they must differ.
2. **Create the stack** (**not run here**). Use the console's "Create stack" page with this file, or the CLI:

   ```sh
   aws cloudformation deploy \
     --stack-name open-artifact \
     --template-file deploy/aws/open-artifact-host.yaml \
     --capabilities CAPABILITY_IAM \
     --parameter-overrides \
       AppHost=artifacts.example.com \
       ContentDomain=oa-content.example.net \
       AcmeEmail=you@example.com \
       VpcId=vpc-0123456789abcdef0 \
       SubnetId=subnet-0123456789abcdef0 \
       BackupBucket=my-backup-bucket
   ```

   The subnet must be public, meaning it routes to an internet gateway. You make the backup bucket yourself; the stack
   only gets permission to write to it. Leave `BackupBucket` empty if you want local backups only.
3. **Create the DNS records** for the `PublicIp` output. The `DnsRecords` output prints them:

   ```
   artifacts.example.com.          A   <PublicIp>
   *.oa-content.example.net.       A   <PublicIp>
   ```

   Until these records resolve, Caddy cannot get certificates. It keeps retrying, so the order of the steps does not
   matter.
4. **Sign in as the owner.** Open a shell with the command in the `Shell` output, then:

   ```sh
   sudo sh -c 'cd /srv/open-artifact/deploy/docker && docker compose logs host'
   ```

   The host prints the owner's sign-in address there once. If the logs have rotated away, make a new one:
   `sudo sh -c 'cd /srv/open-artifact/deploy/docker && docker compose exec host node packages/host/src/node/main.ts owner-key'`.
5. **Add more sign-in methods** (Google, GitHub, your OIDC provider) or change any other setting:
   edit `/srv/open-artifact/deploy/docker/.env`, then run `docker compose up -d` in that folder.

The default is on-demand certificates over HTTP-01, which needs nothing else. To use one wildcard certificate through
Cloudflare DNS instead, set `COMPOSE_FILE` and `CLOUDFLARE_API_TOKEN` in `.env` as that file describes.

## Upgrades

Upgrade in place on the instance (**not run here**):

```sh
sudo -i
cd /srv/open-artifact
BACKUP_DIR=/srv/backups deploy/backup.sh
git fetch --depth 1 origin v0.14.6 && git checkout FETCH_HEAD    # or: git pull, to follow a branch
cd deploy/docker && docker compose up -d --build
```

The catalog migrates by itself when the new version starts.

Avoid upgrading by updating the stack in a way that replaces the instance, for example a new `ImageId` or a change to
the launch template. The data volume would survive, because it is a separate resource with a snapshot policy, but
CloudFormation would try to attach it to the new instance while the old instance still has it, and that update can
fail. If you must replace the instance:

1. Take a backup.
2. Delete the stack. The data volume is snapshotted.
3. Create a new stack.
4. Restore from the backup.

Reboots and stops are safe. The volume, the Elastic IP and the containers come back by themselves, because compose
uses `restart: unless-stopped`.

## Backups and restore

Each day the timer writes an archive to `/srv/backups` and keeps the newest seven. If you gave a bucket, it also
uploads the archive to `s3://<BackupBucket>/open-artifact/`. In S3, the bucket's lifecycle rules decide how long
archives are kept; set them on the bucket.

To run a backup now: `sudo systemctl start open-artifact-backup.service`. Check the result with
`journalctl -u open-artifact-backup`.

To restore on the same instance or on a new one (**not run here**):

```sh
sudo -i
cd /srv/open-artifact/deploy/docker
aws s3 cp s3://my-backup-bucket/open-artifact/open-artifact-20261122T033000Z.tar.gz /srv/backups/
docker compose down
docker run --rm -v open-artifact_oa-data:/data -v /srv/backups:/b alpine \
  sh -c 'rm -rf /data/* /data/.backup-host.db; tar -xzf /b/open-artifact-20261122T033000Z.tar.gz -C /data && mv /data/.backup-host.db /data/host.db && chown -R 1000:1000 /data'
docker compose up -d
```

On a new instance, first copy the old `.env`, or at least its `OA_SIGNING_KEYS`, so that existing share-link
addresses keep working. The archive does not include `.env`. Keep a copy of `.env` somewhere safe, such as a password
manager or AWS Secrets Manager.

The EBS snapshots that CloudFormation takes when the volume is deleted are a second safety net. You can add AWS Backup
or Data Lifecycle Manager for scheduled snapshots of the data volume.

## Why not ECS Fargate (yet)

A Fargate deployment waits for a later phase (P2), for three reasons:

- **Disk.** A Fargate task's own disk does not survive the task, and the host keeps its catalog and artifacts on
  disk.
- **EFS.** It is the durable disk Fargate offers, but SQLite on a network file system is unsafe. Its locking relies on
  file locks that network file systems do not reliably provide, so the catalog can be corrupted.
- **One process per artifact.** Each artifact's live room is in the memory of one process, so two tasks cannot serve
  the same artifact. Running more than one task would need routing by artifact and a catalog that is not a local
  SQLite file.

A single EC2 instance with an EBS volume has none of these problems.

## What was validated

- **Checked offline:**
  - The template parses as YAML with CloudFormation's short-form tags.
  - It has 12 parameters, 2 conditions, 9 resources and 5 outputs.
  - Every `Ref`, `!GetAtt`, `!Sub` variable and `!If` condition points at something that exists. A test copy with
    broken references was used to confirm that the checker catches mistakes.
  - The user-data script, taken out of the template, passes `bash -n`.
  - `deploy/backup.sh` was run against a running host without Docker, and the restore steps were followed. The restored
    host started on the restored data.
- **Not checked:**
  - `aws cloudformation validate-template`, which needs AWS credentials, and `cfn-lint`.
  - Creating the stack, the first-boot script on a real instance, Docker and Caddy on it, getting certificates, the
    S3 upload, and the systemd timer.
