# Oman Scout (رصد)

A website that finds **upcoming** events, competitions, competitor moves and funding in Oman, the GCC and worldwide, then leaves out anything an Omani Bachelor's student cannot join. Press **Refresh** and it searches the web again.

## How it works

1. The site (`index.html`, `assets/`, `data/scout.json`) is plain files hosted free on GitHub Pages. It works on any phone or computer.
2. **Refresh** starts a GitHub Actions job (`.github/workflows/scout.yml`). The job runs four Claude web-research scans in parallel: Oman events and competitions, Oman competitors and funding, GCC, and Global.
3. Each scan follows `agent/brief.md` and your `agent/profile.md`. Its answer is checked and cleaned by `scripts/`, past items are dropped, Arabic text is added, and the result is saved to `data/scout.json`.
4. The site redeploys with the new data. The Refresh button shows progress and reloads the results when it finishes.

Nothing runs on your own computer. If one scan fails, the site keeps that area's previous results and marks them as "kept from an earlier scan".

## One-time setup

The repository, GitHub Pages and the workflows are set up for you. Two steps need you, because they involve your own accounts.

### 1. Give the scan your Claude access (secret `CLAUDE_CODE_OAUTH_TOKEN`)

The scan uses your Claude subscription (Pro, Max, Team or Enterprise), so there is no separate bill.

1. Install Claude Code on your computer: `npm install -g @anthropic-ai/claude-code`
2. Run `claude setup-token` and sign in when the browser opens. It prints a long token. Copy it.
3. On GitHub open your repository, then **Settings, Secrets and variables, Actions, New repository secret**. Name it `CLAUDE_CODE_OAUTH_TOKEN` and paste the token as the value.

Never paste the token into a chat, an issue, or any file in the repository.

### 2. Let the Refresh button start scans (optional, per device)

Without this, the Refresh dialog gives you a link to GitHub where you press **Run workflow** yourself. For a one-tap button:

1. On the site press **Refresh**. The dialog has a **Create the token on GitHub** button.
2. On GitHub choose **Only select repositories**, pick this repository, and give the token **Actions: Read and write**. Set an expiry you are comfortable with.
3. Copy the token and paste it into the Refresh dialog. It is stored only in that browser and is sent only to GitHub. Repeat on each device you want to use.

## Using it

- **Refresh** runs a new scan. Expect 10 to 20 minutes.
- Tabs switch between Oman, GCC, Global and your saved items. Filters, search, a calendar view, an Arabic and English switch, and light and dark themes are built in.
- **Save** keeps an item in the Saved tab. **Not for me** hides it. **Add to calendar** downloads a `.ics` file with the dates and the deadline.
- Everything you save or hide stays in your own browser.

## Changing what it looks for

- `agent/profile.md`: who the scan is for and what makes something eligible. Edit it on GitHub (the pencil icon). Keep your name, university and contact details out of it, because the repository is public.
- `agent/tasks.json`: the four scans and what each one focuses on.
- `agent/brief.md`: the general research rules.
- **Weekly refresh:** in the repository go to **Settings, Secrets and variables, Actions, Variables** and add `WEEKLY_REFRESH` with the value `true`. It then runs every Sunday at 07:00 Oman time. Delete the variable to stop it.

## Limits and honest caveats

- A scan uses your Claude usage allowance. Four scans plus translation is a heavy request, so do not refresh many times in an hour.
- Web search can miss things and pages can be wrong. Every card shows how sure the scan is, and each one links to its source. Confirm dates on the organiser's own page before you plan or travel.
- The site is public to anyone with the link. It contains public event information and a generic description of you (no name or university).
- GitHub switches off scheduled workflows in a public repository after 60 days with no activity. Press Refresh now and then, or push any small change.

## Troubleshooting

- **The Refresh dialog says the token was rejected:** the token expired or lacks Actions access. Create a new one and save it again.
- **A scan job is red in the run log:** open the run from the dialog and read the failed step. A missing `CLAUDE_CODE_OAUTH_TOKEN` secret prints a clear message. Re-run `claude setup-token` if the token has expired.
- **Results look old:** the data is only as new as the last successful scan. The footer shows each area's last scan date.

## Files

```
index.html, assets/        the website
data/scout.json            the latest results (written by the scan)
agent/                     what the scan looks for
scripts/                   runs the scans, cleans, merges and translates
.github/workflows/         scout.yml (the scan) and deploy.yml (publishing)
```
