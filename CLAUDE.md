# Tuition Manager

Node.js + Express + EJS + SQLite (better-sqlite3) app for a tuition center: fee collection and attendance.
Entry point is `src/app.js`. See README.md for features and how fees work.

## Deployment

| | |
|---|---|
| Server | 187.127.162.81 (Ubuntu 26.04), shared by ~15 students |
| SSH | `ssh vipinchandran1291@187.127.162.81` (key login) |
| App name | `tuition` |
| Port | 4200 on 127.0.0.1 (allowed range 4200–4299) |
| Address | https://vipinchandran1291.dhilber.in → 127.0.0.1:4200 (HTTPS handled by the instructor's proxy) |
| Repo | https://github.com/vipinchandran1291-glitch/Tuition-App.git (public) |
| Code | `~/apps/tuition/` |
| Database | `~/data/tuition/tuition.db` |
| Backups | `~/data/tuition/backups/` (cron, 21:36 UTC daily, keeps 14 days) |
| Settings | `~/.config/tuition.env` (chmod 600) |
| Service | `~/.config/systemd/user/tuition.service` (`systemctl --user`) |

### Updating

After pushing changes to GitHub:

```
ssh vipinchandran1291@187.127.162.81 "cd ~/apps/tuition && git pull && npm ci && systemctl --user restart tuition"
```

Then check `systemctl --user status tuition --no-pager` and the address.
Logs: `journalctl --user -u tuition -n 50 --no-pager`.

### Server rules

1. No sudo or root. Never run `sudo`, `apt` or `npm install -g`. Anything needing root: ask the instructor.
2. Stay inside /home/vipinchandran1291. Never read, change, stop or kill anything not created for this app.
3. Listen on 127.0.0.1 only, on a port in 4200–4299. Never 0.0.0.0 or port 3000, including test runs.
4. Don't touch the web server, firewall or DNS.
5. Keep secrets out of git and out of this file. They go only in `~/.config/tuition.env` (chmod 600).
6. Keep apps running with `systemctl --user` services, not pm2, nohup, screen or `&`.
