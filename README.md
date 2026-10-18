# Tuition Manager

A simple, mobile-friendly app for a tuition center that does two jobs: fee collection and attendance.
It runs on Node.js + Express + SQLite and needs no build step.

## Features

- **Dashboard:** collected today and this month, total pending, 6-month trend, cash/UPI/bank split,
  class-wise summary, and an overdue list with WhatsApp reminders.
- **Quick Collect:** search a student, the amount is pre-filled, pick a mode, save. The app then
  offers a PDF receipt and a WhatsApp share.
- **Fees:** the monthly fee for each class (8-A … 10-D) is charged automatically on the 1st.
  Payments clear the oldest months first. Partial and advance payments are both handled.
- **Student profile:** pending amount, unpaid months, every receipt (downloadable PDF), and
  attendance history.
- **Attendance:** pick a class, and everyone starts as present. Tap the absentees, then save.
  There's also a monthly register per class.
- **Payments:** filter by date and mode, export to CSV.

## Run locally

```bash
npm install
npm start          # http://127.0.0.1:4200
```

The first visit asks you to create the admin account. Data is stored in `data/tuition.db`.

## Deploy on Ubuntu VPS

```bash
# 1. Node.js 22 LTS, nginx, certbot
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx

# 2. App user + code
sudo useradd --system --create-home --home-dir /opt/tuition tuition
sudo cp -r . /opt/tuition            # or git clone into /opt/tuition
sudo chown -R tuition:tuition /opt/tuition
cd /opt/tuition && sudo -u tuition npm ci --omit=dev

# 3. Service
sudo cp deploy/tuition.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tuition
sudo systemctl status tuition

# 4. Nginx + HTTPS (edit server_name in deploy/nginx.conf first)
sudo cp deploy/nginx.conf /etc/nginx/sites-available/tuition
sudo ln -s /etc/nginx/sites-available/tuition /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d fees.example.com
```

> `COOKIE_SECURE=true` in the service file requires HTTPS. If you test over plain HTTP first,
> set it to `false` or login will not stick.

### Daily backups

Back up the database every night at 2 AM and keep 30 days of copies:

```bash
sudo -u tuition crontab -e
# add:
0 2 * * * cd /opt/tuition && /usr/bin/node scripts/backup.js /opt/tuition/backups >> /opt/tuition/backups/backup.log 2>&1
```

Copy the `backups/` folder off the server now and then (e.g. `scp` or `rclone` to Google Drive).

### Updating

```bash
cd /opt/tuition && sudo -u tuition git pull && sudo -u tuition npm ci --omit=dev
sudo systemctl restart tuition
```

## Configuration (environment variables)

| Variable         | Default              | Purpose                              |
|------------------|----------------------|--------------------------------------|
| `PORT`           | `4200`               | HTTP port                            |
| `HOST`           | `127.0.0.1`          | Address to listen on                 |
| `DB_PATH`        | `data/tuition.db`    | SQLite file location                 |
| `TZ`             | `Asia/Kolkata`       | Time zone for dates and months       |
| `COOKIE_SECURE`  | `false`              | Set `true` behind HTTPS              |
| `SESSION_SECRET` | auto-generated       | Optional; stored in DB if not set    |

## How fees work

- Each class has a monthly fee (default ₹2,500), editable under **More → Monthly fee per class**.
- Each active student is charged that fee every month, starting from their *Charge fees from month*.
- **Pending = total charged − total paid.** Payments are applied oldest month first, and the
  receipt records which months it covered.
- **Mark as left** stops new monthly charges. Old dues stay until they're paid.
- A fee change applies to future months. You can optionally apply it to the current month too.
