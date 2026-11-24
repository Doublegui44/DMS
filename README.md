# DMS Simulator

Web simulator of a French multi-site car dealer group's Dealer Management System: new and used car sales, workshop, parts, accounting and admin. Built for demos, training and workflow testing. Architecture and decisions are in [`docs/`](docs/ARCHITECTURE.md); working notes for contributors are in [`CLAUDE.md`](CLAUDE.md).

## Run locally

Needs Node 24 and PostgreSQL 17.

```bash
cp .env.example .env          # set DATABASE_URL to your local dms_dev database
npm ci
npm run db:reset              # migrate and seed six months of history (~200 s)
npm run dev                   # http://localhost:3000
```

With `DEMO_MODE=true` the login page offers one-click sign-in for every role. All demo users' password is `demo1234`.

## Demo script (about 30 minutes)

Every step below changes stock, invoices, journal entries and KPIs in the same transaction: the point of the demo is to follow one action into the books.

### 0. Start from a clean database

```bash
npm run db:reset              # six months of history up to today, the last finished month locked
npm run dev
```

Open http://localhost:3000. With `DEMO_MODE=true`, the login page lists every demo user by role and site: click one to sign in (the emails below are the same users, password `demo1234`), and use **Switch user (demo)** in the top bar to change role without signing out. The language selector next to it switches the whole app between English and French.

The group has three sites (Nantes, Rennes, Angers) and two brands. Site-scoped users see only their site; the dealer principal, the accountant and the admin pick a site, or all sites, in the top bar.

### 1. The group at a glance — dealer principal

Sign in as `dealer.principal@dms.test`. The **Dashboard** shows the month's sales, gross margin per department (VN, VO, workshop, parts), stock value and ageing, and what waits for approval. Every figure there comes from the same queries as the reports, so it never disagrees with them.

### 2. A new-car sale with a trade-in — salesperson, then sales manager

1. Sign in as `salesperson1.nantes@dms.test`. Open **Customers**, pick a private customer, then **New lead** (interest VN) and **New quote**.
2. In the quote builder, pick a car in stock. Tick the trade-in, fill in the customer's old car (make, model, first registration, mileage) and click **Market price**: the simulated market feed returns comparable listings and a trade value; **Use as market value** copies it into the quote. The summary on the right updates as you type.
3. Give a discount above 5 % of the list price: the quote now needs the sales manager's approval, and the button becomes **Save and ask for approval**.
4. Switch to `sales.manager.nantes@dms.test`, open its card on the **Pipeline** board (badge *Waiting for approval*; the dashboard counts the discounts to approve) and **Approve** it: it is sent to the customer. Then **Customer signs the order**: the car comes off sale, the trade-in enters used-car stock and the lead is won, in one transaction.
5. On the order: **Invoice**, **Record payment**, then **Hand over the vehicle**. The order shows its four steps done.
6. Switch to `accountant@dms.test` and open **Journal entries**, searching for the invoice number: the sale, its cost of sale (new-car stock out at cost), the trade-in purchase and the receipts are all there.

Also in sales: **VN stock** and the **OEM portal** (factory orders as the manufacturer sees them; it can ship a built car or push a promised date back), **VO stock** with reconditioning costs, and the **Police register** of used cars bought and sold.

### 3. A workshop visit — service advisor, technician

1. Sign in as `service.advisor.nantes@dms.test`. In the **Planner**, book an appointment for a customer's car, then **Check in** on the day: mileage, damages, the customer's request.
2. On the repair order, add labour from the catalogue and parts from stock. A job can have its own payer: customer, insurer, warranty (the manufacturer) or internal.
3. Switch to `technician1.nantes@dms.test`: in **Clocking**, **Clock on** the job and **Clock off** when the work is finished, then mark it **Job done** on the repair order.
4. Back as the advisor: **Invoice** (one invoice per payer, a warranty claim for warranty jobs), **Record payment** and **Hand over car**. Parts left stock at their weighted average cost (PMP); **Productivity** shows clocked against billed hours per technician.

### 4. Parts — parts manager

Sign in as `parts.manager.nantes@dms.test`. **Purchasing** shows **Suggestions** for every part below its minimum, up to its maximum; order, receive (the PMP is recalculated) and match the supplier invoice (a price difference beyond the tolerance waits for validation). **Counter sales** sells parts to trade and retail customers at their discount class.

### 5. Let a week go by — admin

Sign in as `admin@dms.test` and open **Simulation**. Run 7 days for all sites: each site's staff create leads, quotes, sales, appointments, repair orders, parts orders and payments, and the business date moves forward day by day. The run ends with its counts and two checks that must always hold: the journal balances and the stock accounts equal the stock sub-ledgers. The dashboards and reports now include the new week.

The same runner exists on the command line: `npm run simulate -- --days 7`.

### 6. Month-end close — accountant

Sign in as `accountant@dms.test`. **Reports** holds the P&L by department, the VAT return, receivables and payables ageing, stock value and the FEC export. In **Periods**, the last finished month is still open; its close checklist checks that earlier months are locked, the month has ended, no invoice is left in draft and the trial balance balances. **Lock period**: from then on nothing can be posted into that month, corrections go through reversals and credit notes.

Every invoice, order form, repair order and warranty claim also prints as a PDF from its page.

### Reset

`npm run db:reset` returns to the seeded state at today's date. On the hosted demo, restarting the Space does the same.

## Share the demo from your Mac (free tunnel)

`scripts/demo-tunnel.sh` serves the app from your Mac and gives it a public HTTPS address through a Cloudflare quick tunnel: free, no account (D-086).

```bash
brew install cloudflared       # once
scripts/demo-tunnel.sh         # asks for the site password, builds, opens the tunnel
```

- The script prints an address like `https://random-words.trycloudflare.com`. Send it with the site password. Visitors type the password (any username), then pick a role on the login page.
- The app uses its own database, `dms_demo` (created and seeded on the first run), never `dms_dev`. It listens only on 127.0.0.1, so the tunnel is the only way in.
- `--reset` reseeds `dms_demo` at today's date (about 3 minutes). `--no-build` skips the build when the code has not changed.
- It works only while your Mac is awake and the script runs. Ctrl-C stops the app and the tunnel. Each start gets a new random address.

## Host a demo on Hugging Face Spaces (paid)

Since July 2026, Hugging Face needs a PRO plan (about $9 a month) to create Docker Spaces; free accounts can only create static ones.

The `Dockerfile` builds one self-contained image: Postgres 17 and the production server, with the demo database seeded while the image is built. Each start begins from that seeded state (D-085).

1. On huggingface.co, create a **Space** with SDK **Docker**, hardware **CPU basic (free)**, visibility **Public**.
2. In the Space's **Settings → Variables and secrets**, add:
   - secret `AUTH_SECRET`: the output of `openssl rand -base64 32`
   - secret `SITE_PASSWORD`: the shared password your visitors will type
   - variable `DEMO_MODE`: `true`
3. Install git-lfs once (`brew install git-lfs`; the favicon is a binary file), then deploy:

   ```bash
   scripts/deploy-hf.sh <hf-user>/<space-name>
   ```

   Git asks for your Hugging Face username and an access token with write permission the first time. The build takes about 10 minutes.
4. Share the direct address `https://<hf-user>-<space-name>.hf.space` and the site password. Do not share the huggingface.co page: it shows the app in a frame, where browsers block the login cookie.

Good to know:
- Everyone shares one database and one business clock. A simulation run moves the date for everybody.
- The Space sleeps after about 48 hours without visits. Waking it up or restarting it resets the data to the seeded demo. Rebuilding it (a new deploy, or **Factory rebuild**) reseeds with today's date.
- The same image runs on any Docker host: `docker build -t dms-demo .` then `docker run -p 7860:7860 -e AUTH_SECRET=… -e DEMO_MODE=true -e SITE_PASSWORD=… dms-demo`.
