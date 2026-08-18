# Meridian

Meridian is a **fictional ERP application built for software QA training**. It is a teaching fixture, not a product: every screen, business rule, and test in this repository exists so that trainees can practice real testing techniques against a system whose correct behaviour is completely and precisely specified.

Nothing here talks to a real company, a real payment gateway, or real people. All names, accounts, and data are invented.

## What you can practice against it

- **Requirement-based testing.** Every behaviour traces to a written business rule (`MR-*` identifiers) in [docs/Meridian-System-Spec.md](docs/Meridian-System-Spec.md). Given a cart and the rules, exactly one total is correct.
- **Boundary and decision-table techniques.** The rules were deliberately shaped to have real boundaries: discount rates 1 to 50, a $200.00 free-shipping threshold, a 4.5 rating band edge, a 10-day refund window, a nine-row eligibility decision table.
- **State-transition testing.** Orders and evaluations each follow an explicit state machine with listed transitions; everything not listed must be refused.
- **API-level testing.** Every rule is enforced on the server, not just in the UI. "The button is hidden but the API allows it" is always a defect here (rule MR-PLT-02).
- **Defect hunting, in class.** Training exercises run against facilitator-provided builds of Meridian that contain deliberately planted defects. This public repository is the clean build: it is the reference for what *correct* looks like, which is exactly what you test those builds against.

## The three modules

| Module | What it does |
|---|---|
| **Platform** | Sign-in, sessions, three roles (Associate, Manager, Administrator), user administration, the reporting chain (`managerId`) |
| **Storefront** | Products, carts, discount codes, checkout with simulated payment capture, order state machine, whole-line refunds with exact-to-the-cent arithmetic |
| **Reviews** | Performance evaluation cycles, four-competency ratings, an evaluation state machine with segregation-of-duties guards, read-access rules |

The full behavioural specification, rule by rule, is [docs/Meridian-System-Spec.md](docs/Meridian-System-Spec.md). A guided tour in plainer language is [docs/Functionality-Guide.md](docs/Functionality-Guide.md).

## Running it on your own PC

### Prerequisites

- **Git** — the tool used to download (clone) this repository. See [Installing Git](#installing-git) below if you don't have it; there is also a no-Git alternative.
- **Node.js 20 or newer** (the app is developed on Node 24), which includes **npm**. See [Installing Node.js](#installing-nodejs) below.
- **VS Code** — optional but recommended as your editor for reading the code and specs. See [Installing VS Code](#installing-vs-code-optional) below.
- Any OS. The database is SQLite through a bundled prebuilt binary, so there is nothing else to install — no Docker, no database server, no C++ compiler.

To check what you already have, open a terminal (on Windows: press the Windows key, type `powershell`, press Enter) and run:

```bash
git --version    # e.g. git version 2.47.0
node --version   # v20 or higher
```

If a command prints a version, that tool is installed. If it prints "not recognized" or "command not found", install it, then **close and reopen the terminal** and check again.

### Installing Git

Git is not preinstalled on Windows. To install it:

1. Download the installer from [git-scm.com/downloads/win](https://git-scm.com/downloads/win) (choose "64-bit Git for Windows Setup").
2. Run it and click **Next** through every screen — the defaults are all fine for this course.
3. Close and reopen your terminal, then confirm with `git --version`.

On **macOS**, running `git --version` in Terminal prompts you to install Apple's command line tools; accept and you're done. On **Linux**, use your package manager, e.g. `sudo apt install git`.

**No Git at all?** You can skip it: on the [repository page](https://github.com/ejentic/meridian), click the green **Code** button, choose **Download ZIP**, and extract it. Everything in the Quickstart works the same — just skip the `git clone` line and `cd` into the extracted folder instead. The trade-off: to pick up updates later you re-download the ZIP, whereas a clone updates with a single `git pull`.

### Installing Node.js

Node.js is the runtime that executes the application; npm, its package manager, is included with it.

1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** version (the one labeled "Recommended for most users") for your OS.
2. Run the installer and click **Next** through every screen — the defaults are fine. On Windows, if a screen offers to install "Tools for Native Modules" or Chocolatey, leave it **unchecked**; Meridian doesn't need it.
3. Close and reopen your terminal, then confirm both tools answer:

```bash
node --version   # v20 or higher
npm --version    # any version that prints is fine
```

On **macOS** or **Linux** the nodejs.org installer works the same way; Linux users can also use their package manager, but check the version afterwards — some distributions ship a Node older than 20.

### Installing VS Code (optional)

You don't need an editor to *run* Meridian, but the course constantly asks you to read things — the spec, the seed data, a rule's implementation, a failing test — and VS Code is the easiest way to do that.

1. Download it from [code.visualstudio.com](https://code.visualstudio.com) and install with the defaults. On Windows, leave **"Add to PATH"** checked, and the **"Open with Code"** checkboxes are worth ticking too.
2. Open the project: **File → Open Folder** and pick your `meridian` folder.
3. VS Code has a built-in terminal (**Terminal → New Terminal**, or `` Ctrl+` ``) that opens already inside the project folder — every command in this README can be run from there instead of a separate window.

One extension worth adding for this course: **SQLite Viewer** (search for it in the Extensions panel, `Ctrl+Shift+X`), which lets you click `meridian.db` and browse the tables directly — see [Looking inside the database](docs/Test-Data.md#looking-inside-the-database).

### Quickstart

Run these one at a time in your terminal:

```bash
git clone https://github.com/ejentic/meridian.git
cd meridian
npm install
npm run db:reset   # creates meridian.db and loads the seed fixture
npm run dev        # starts the app at http://localhost:3000
```

Open http://localhost:3000 and sign in with one of the seeded accounts below. Leave the `npm run dev` terminal open while you use the app; press `Ctrl+C` in it to stop the server.

> **Note:** `npm install` deliberately skips dependency install scripts (see `.npmrc`). This is what makes the install work without a C++ toolchain. The one side effect: before the first `npm run e2e`, run `npx playwright install chromium` once to download the test browser.

### Seeded accounts

Every account uses the password **`meridian`**.

| Email | Role | Reports to |
|---|---|---|
| `admin01@meridian-corp.test` | Administrator | — |
| `manager01@meridian-corp.test` | Manager | admin01 |
| `associate01@meridian-corp.test` | Associate | manager01 |
| `associate02@meridian-corp.test` | Associate | manager01 |
| `associate03@meridian-corp.test` | Associate | admin01 |

Why `associate03` reports to the Administrator rather than the Manager is not an accident — it makes the "a Manager may act only on their own direct reports" rules testable. The full fixture, and the reason behind every value in it, is documented in [docs/Test-Data.md](docs/Test-Data.md).

### Resetting your data

Anything you create (orders, evaluations, users) is written to a local `meridian.db` file. To throw it all away and return to the pristine fixture:

```bash
npm run db:reset
```

The command prints the row count of every table so you can see exactly what you are starting from. Stop the dev server before resetting; the server holds the database open.

Want to look inside `meridian.db` directly — tables, rows, your own SQL queries? See [Looking inside the database](docs/Test-Data.md#looking-inside-the-database) in the test-data guide.

### Getting updates

This repository changes during the course — fixes, new content, spec clarifications. If you cloned it with `git clone`, picking up the latest version takes three commands:

```bash
git pull
npm install
npm run db:reset
```

Run these from inside your `meridian` folder, with the dev server stopped (`Ctrl+C` in the `npm run dev` terminal first). `npm install` picks up any dependency change; `npm run db:reset` rebuilds your database against the current seed fixture, in case it changed too. All three are safe to run even when nothing changed.

If `npm run e2e` complains about a missing browser after an update, rerun `npx playwright install chromium` — the skipped install scripts (see the note above) mean a Playwright version bump doesn't download it automatically.

If `git pull` refuses because of local changes you made to the repo files, run `git status` to see which files, then check with your facilitator before discarding anything — that usually means you edited something directly instead of just running the app. `meridian.db` itself is gitignored and never causes this.

Downloaded a ZIP instead of cloning? There is no `git pull` for you. Go back to the [repository page](https://github.com/ejentic/meridian), download a fresh ZIP, and extract it into a **new** folder rather than over your old one — an update can delete or rename files, and extracting over the old folder leaves those stale files behind. Then run `npm install` and `npm run db:reset` again, as above, before `npm run dev`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the application at http://localhost:3000 |
| `npm run db:reset` | Drop, recreate, and reseed the local database |
| `npm test` | Unit and API tests (Vitest, in-memory database, no server needed) |
| `npm run typecheck` | TypeScript check with no emit |
| `npm run e2e` | Browser end-to-end suite (Playwright; starts its own server on port 3311 against its own database file, so your dev data is untouched) |
| `npm run build` / `npm start` | Production build and serve, if you want it |

The end-to-end suite includes visual regression baselines captured on Windows (`*-win32.png`). On macOS or Linux the visual spec may report font-rendering differences; regenerate local baselines with `npx playwright test visual.spec.ts --update-snapshots` and don't commit them.

## Repository map

```
src/app/            Screens (Next.js App Router) and the /api/v1 route handlers
src/lib/            The business rules as code: pricing, orders, evaluations, sessions, authz
src/rules/          Client-side visibility rules (what controls to draw); never enforcement
src/db/             SQLite schema, seed fixture, reset CLI
e2e/                Playwright specs, one per module, plus visual baselines
docs/               System spec, functionality guide, test data
tools/              The Node loader that lets npm scripts run the TypeScript sources
```

## What this repository is not

- Not a security reference. Passwords are stored as a salted SHA-256 digest, which is deterministic and fast so tests can reseed constantly — it is **not** a scheme to copy into a real application, and the spec says so explicitly.
- Not an example of production architecture. The data layer is hand-written SQL, on purpose, so the SQL a rule produces is readable next to the rule it implements.
- Not connected to anything. Payment capture is simulated; the "decline" outcome is selectable so a facilitator can produce the failure path on demand.
