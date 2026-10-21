# Deploying PV Toolkit

This puts the app on a small cloud server at your own web address, with HTTPS and
login protected by a password plus a code from your phone. Allow about an hour the
first time. After that, updates take one command.

You'll need:
- a credit card for the server (about $10–12 a month)
- a domain or subdomain you control, e.g. `pv.yourdomain.com` (about $10 a year if you buy one)
- a terminal: **Terminal** on Mac, **PowerShell** on Windows

---

## 1. Rent a server

Any provider works. Two good options:

| Provider | Plan | Why |
|---|---|---|
| **AWS Lightsail** | 2 GB RAM, Ubuntu 24.04, region **Bahrain** | Closest to Oman, so the app feels fastest |
| **Hetzner Cloud** | CX22 (2 vCPU / 4 GB), Ubuntu 24.04 | Cheapest for the power; servers in Europe |

Use at least **2 GB RAM**, because the PDF conversion (LibreOffice) needs it.

When creating the server:
1. Choose **Ubuntu 24.04**.
2. Add an **SSH key** (the provider shows how). This is safer than a password.
   - If you don't have one: run `ssh-keygen -t ed25519` in your terminal, press Enter at
     each prompt, then paste the contents of `~/.ssh/id_ed25519.pub` into the provider.
3. Note the server's **public IP address**.

On Lightsail, open **Networking → IPv4 firewall** and allow **HTTP (80)** and **HTTPS (443)**.
Also attach a **static IP** so the address never changes.

## 2. Point your domain at the server

Wherever your domain's DNS is managed, add an **A record**:

| Type | Name | Value |
|---|---|---|
| A | `pv` (or whatever subdomain you want) | your server's IP |

It can take a few minutes to an hour to take effect. Check it with `ping pv.yourdomain.com`.
It should show your server's IP.

## 3. Log in to the server and install Docker

```bash
ssh ubuntu@YOUR_SERVER_IP          # Hetzner uses root@ instead of ubuntu@
```

Then, on the server:

```bash
# updates + automatic security patches
sudo apt update && sudo apt -y upgrade
sudo apt -y install unattended-upgrades git
sudo dpkg-reconfigure -plow unattended-upgrades      # answer "Yes"

# firewall: only SSH and web traffic
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```

Log back in (`ssh ubuntu@YOUR_SERVER_IP`) so the Docker permission takes effect.

## 4. Put the code on the server

**Option A: GitHub (recommended, because updates become one command).**
Create an empty **private** repository on github.com, push this folder to it from your
computer, then on the server:

```bash
git clone https://github.com/YOUR_USER/pv-toolkit.git
cd pv-toolkit
```

(GitHub will ask for a token rather than your password: GitHub → Settings → Developer
settings → Personal access tokens → Fine-grained → read access to this repo.)

**Option B: copy the zip.** From your computer:

```bash
scp pv-toolkit.zip ubuntu@YOUR_SERVER_IP:~
ssh ubuntu@YOUR_SERVER_IP
sudo apt -y install unzip && unzip pv-toolkit.zip && cd pv-toolkit
```

## 5. Configure

```bash
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"     # copy the output
nano .env
```

In `.env`, set:
- `DOMAIN=pv.yourdomain.com`
- `SECRET_KEY=` followed by the long random string you just generated

- `ANTHROPIC_API_KEY=`: optional but recommended. This lets the app read uploaded datasheets
  reliably, including multi-model tables and scanned pages. Create a key at
  [console.anthropic.com](https://console.anthropic.com) under **Settings → API keys** and
  add a small amount of credit. Reading one datasheet costs a few cents. Without a key, a
  basic text reader is used instead. It reads clean tables, and you fill in anything it misses.

Save with **Ctrl+O**, press Enter, then exit with **Ctrl+X**.

Then lock the file down:

```bash
chmod 600 .env
```

## 6. Start it

```bash
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
```

The first build takes 5–10 minutes (it installs LibreOffice). Check it's running:

```bash
docker compose ps          # both services should say "running" / "healthy"
docker compose logs -f     # live logs; Ctrl+C to stop watching
```

Caddy fetches the HTTPS certificate automatically the first time someone visits the site.

## 7. Create your login

```bash
docker compose exec app python -m app.cli create-user
docker compose exec app python -m app.cli seed      # adds HTC, Sabla and the Sungrow MENA inverter range
```

Choose a password of at least 12 characters, with upper and lower case and a number.

Open `https://pv.yourdomain.com`, sign in, and scan the QR code with an authenticator
app. Google Authenticator, Microsoft Authenticator and 1Password all work. From then on,
every sign-in asks for the 6-digit code.

## 8. Backups (do this, it takes 2 minutes)

Everything lives in one database file, `data/app.db`. To back it up every night at 2 am:

```bash
crontab -e
```

Add this line, replacing the path with yours (check it with `pwd` inside the folder):

```
0 2 * * * /home/ubuntu/pv-toolkit/backup.sh >> /home/ubuntu/pv-toolkit/backups/log.txt 2>&1
```

This keeps the last 30 nightly copies in `backups/`. It's also worth copying them off the
server now and then:

```bash
# run this on your own computer
scp -r ubuntu@YOUR_SERVER_IP:~/pv-toolkit/backups ./pv-backups
```

Lightsail and Hetzner also offer automatic server snapshots for a small fee. Worth enabling.

**To restore** from a backup:

```bash
docker compose stop app
gunzip -c backups/app-2026-10-20_0200.db.gz > data/app.db
docker compose start app
```

## Updating to a new version

```bash
cd ~/pv-toolkit
git pull                         # or upload and unzip the new version
docker compose up -d --build
```

Your data in `data/` is untouched by updates.

## Day-to-day admin commands

```bash
docker compose exec app python -m app.cli reset-2fa      # lost your phone
docker compose exec app python -m app.cli set-password   # forgot your password
docker compose exec app python -m app.cli unlock         # locked out after 5 wrong tries
docker compose logs --tail 100 app                       # see recent errors
docker compose restart                                   # restart everything
```

## Troubleshooting

| Problem | Check |
|---|---|
| Browser says the site can't be reached | Does `ping your-domain` show the server IP? Are ports 80 and 443 open in the provider's firewall **and** in `ufw status`? |
| Certificate / HTTPS error | Look at `docker compose logs caddy`. Usually DNS isn't pointing at the server yet. |
| Can't sign in, nothing wrong with the password | Is the phone's clock set automatically? The codes depend on the time. |
| PDF button fails | Run `docker compose logs app`. The server may be short of memory, so use a 2 GB plan or larger. |
| "Form expired" message | You left a page open for more than 12 hours. Refresh and try again. |

## Running it on your own computer (optional, for trying changes)

```bash
python3 -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
export COOKIE_SECURE=0                                   # Windows: set COOKIE_SECURE=0
python -m app.cli create-user
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000. PDF export needs LibreOffice installed locally; Word export
works without it. Run the tests with `pytest -q`.
