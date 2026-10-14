# Oman Scout (رصد)

A website that finds **upcoming** events, competitions, competitor moves and funding in Oman, the GCC and worldwide, leaves out what an Omani Bachelor's student cannot join, and ranks the rest by how much it fits you. Press **Refresh** and it searches the web again.

## What you get

- **Best match ranking.** Every item has a score from 0 to 100 built from your topics, how well it fits a tech student, eligibility, deadline urgency, how reliable the information is, and how far you would have to go. Competitions count most by default. Tap **Tune your feed** to choose topics and priorities. Saving and hiding items teaches it more. Everything stays in your browser.
- **Search that forgives.** English and Arabic, typos, synonyms ("contest" finds "competition"), quoted phrases and `-exclusions`. Press `/` to jump to the search box.
- **My plan.** Save an item, move it from Interested to Preparing, Applied, Going and Done, and keep notes.
- **Detail drawer** with why an item ranks where it does, eligibility, dates (with the Hijri date), how well it was checked, and every source.
- **Calendar view**, add-to-calendar files, Google Calendar links, WhatsApp sharing and a **calendar feed** you can subscribe to once (Settings, Calendar feed). Deadlines come with reminders.
- **English and Arabic** with right-to-left layout, light and dark themes, three text sizes, and a compact card mode.
- **Installable and fast.** Add it to your phone's home screen; it also works offline with the last data it loaded.

## How a scan works

1. **Refresh** starts a GitHub Actions run (`.github/workflows/scout.yml`) that runs eight research tasks (Oman competitions, events, funding and market; GCC competitions and events; global competitions and events), four at a time.
2. Each task opens the watch pages in `agent/sources.json` first, then searches in English and Arabic (`agent/tasks.json` holds the queries). Results are cleaned and checked by `scripts/`.
3. **Quick** (about 15 minutes) stops there. **Thorough** (about 40 minutes) adds a second pass for what was missed, and a verifier that re-opens the pages of the most important items and corrects them only when the page shows the evidence.
4. Every link is fetched by plain code (no model) to see whether it opens, and whether the date is written on the page. Dead pages with no other source are dropped.
5. `finalize` merges the tasks, removes duplicates, scores everything, adds Arabic text, writes `data/scout.json` and the calendar feed `data/oman-scout.ics`, and redeploys the site.

If a task fails, the site keeps that area's previous results and marks them as kept from an earlier scan. Nothing is published when no task worked.

## One-time setup

The repository, GitHub Pages and the workflows are set up. Two steps need you, because they involve your own accounts.

### 1. Give the scan your Claude access (secret `CLAUDE_CODE_OAUTH_TOKEN`)

The scan uses your Claude subscription (Pro, Max, Team or Enterprise), so there is no separate bill.

1. Run `claude setup-token` and sign in when the browser opens. It prints a long token. Copy it. If you do not have the `claude` command, install it first with `npm install -g @anthropic-ai/claude-code`. The Claude desktop app also ships its own `claude.exe`.
2. Save the token as a repository secret named `CLAUDE_CODE_OAUTH_TOKEN`. Either run `gh secret set CLAUDE_CODE_OAUTH_TOKEN` and paste the token when asked, or open your repository on GitHub, then **Settings, Secrets and variables, Actions, New repository secret**.

Never paste the token into a chat, an issue, or any file in the repository.

### 2. Let the Refresh button start scans (optional, per device)

Without this, the Refresh dialog gives you a link to GitHub where you press **Run workflow** yourself. For a one-tap button, press **Refresh**, choose **Create the token on GitHub**, give it access to this repository only with **Actions: Read and write**, and paste it into the dialog. It is stored only in that browser and sent only to GitHub. Repeat on each device.

## Changing what it looks for

- `agent/profile.md`: who the scan is for, their interests and what makes something eligible. Edit it on GitHub. The repository is public, so keep your name, university and contact details out of it.
- `agent/tasks.json`: the eight tasks, their focus text and seed queries. `agent/sources.json`: the pages opened first.
- `agent/brief.md`: the general research rules.
- **Weekly scan:** add the repository variable `WEEKLY_REFRESH` with the value `true` (Settings, Secrets and variables, Actions, Variables). It runs a thorough scan every Sunday at 07:00 Oman time.

## Limits and honest caveats

- A scan uses your Claude allowance. A thorough scan is heavy, so use Quick for a daily check and do not refresh many times in an hour.
- Web search can miss things and pages can be wrong. Each card shows how sure the scan is, and every one links to its source. Confirm dates on the organiser's page before you plan or travel.
- The site is public to anyone with the link. It holds public event information and a generic description of you (no name or university). Your plan, notes and settings never leave your browser.
- The first real scan has not run yet, so expect to tune the prompts after it. The job log shows turns used, tools denied, and cost for each task to make that easy.
- GitHub switches off scheduled workflows in a public repository after 60 days with no activity.

## Troubleshooting

- **The Refresh dialog says the token was rejected:** the token expired or lacks Actions access. Create a new one and save it again.
- **A scan job is red:** open the run from the dialog and read the failed step. A missing `CLAUDE_CODE_OAUTH_TOKEN` secret prints a clear message. Re-run `claude setup-token` if the token has expired.
- **Results look old:** the footer shows each area's last scan date.

## For developers

```
index.html, assets/      the website (plain ES modules, no build step); assets/lib has the pure ranking, search, calendar and storage code
sw.js, manifest.webmanifest, assets/icons   offline support and installability (icons from scripts/make-icons.mjs)
data/scout.json          latest results (written by the scan); data/oman-scout.ics is the calendar feed
agent/                   what the scan looks for
scripts/                 scan runner, link checker, merge, translate; scripts/dev/fake-claude.mjs stands in for Claude in tests
.github/workflows/       scout.yml (the scan) and deploy.yml (publishing)
tests/                   npm test (Node's built-in runner, no dependencies, no network)
```
