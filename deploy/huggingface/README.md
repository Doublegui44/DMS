---
title: DMS Simulator
emoji: 🚗
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
short_description: Car dealer group DMS simulator (demo data)
---

# DMS Simulator

Simulator of a multi-site car dealer group's Dealer Management System: new and used car sales, workshop, parts, accounting and admin. Every figure is fictional seeded demo data.

**Open the app at its direct address, `https://<owner>-<space>.hf.space`.** The huggingface.co page shows it in a frame, where browsers block the login cookie.

- The site asks for a shared password first (any username).
- Then pick a role on the login page; every demo user's password is `demo1234`.
- Everyone shares one database and one business clock. It resets to the seeded demo whenever the Space restarts or wakes up.

This Space is deployed from the project repository with `scripts/deploy-hf.sh`; do not edit it here.
