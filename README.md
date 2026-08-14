# Course Traveler — Setup

## 1. Upload to your repo
Upload all of these, keeping the folder structure exactly as-is:
```
index.html
data/assignments.json
data/notes.json
.github/workflows/process-commands.yml
scripts/apply-commands.js
```

## 2. Edit one line in index.html
Near the top of the `<script>` block:
```js
const GITHUB_REPO = "yourusername/yourrepo";
```
Change this to your actual GitHub username and repo name (e.g. `"jcorales/course-traveler"`).

## 3. Turn on GitHub Pages
Repo → **Settings** → **Pages** → under "Build and deployment," set Source to **Deploy from a branch**, branch `main`, folder `/ (root)`. Save. Your site will be live at `https://yourusername.github.io/yourrepo/` within a minute or two.

## 4. Give the Action permission to write back to the repo
Repo → **Settings** → **Actions** → **General** → scroll to "Workflow permissions" → select **Read and write permissions** → Save.

Without this step, the Action will run but fail to commit changes back to `data/assignments.json`.

## 5. Test it
Open your live site, click **+ Command** → **Calendar**, type:
```
add assignment "Test Item" course grd463 end 12/25/2026
```
Hit Enter, then click **Save**. A new tab opens on GitHub with a pre-filled Issue — click **Submit new issue**. Within roughly 1–3 minutes the Action will run, commit the change, comment the result on the issue, and close it. Refresh your site to see it live.

## Command syntax reference
```
add project|assignment|discussion "Name" course CODE [start MM/DD/YYYY] [end MM/DD/YYYY] [points N]
delete project|assignment|discussion "Name" course CODE
change project|assignment|discussion "Name" course CODE [start MM/DD/YYYY] [end MM/DD/YYYY] [points N]
complete "Name" course CODE
uncomplete "Name" course CODE
note add "Text"
note edit ID "New text"
note delete ID
```
Course codes: `grd463` `grd430` `grt237` `grt245`

## Notes on how it works
- Everything you do on the site (notes, calendar commands, marking things complete) queues locally in your browser and previews immediately, but nothing is written to GitHub until you press **Save**.
- Save bundles every queued command into one GitHub Issue and opens it for you to submit — you still need to click **Submit new issue** on GitHub's page once.
- Delete/change/complete commands match by name + course. If a name matches more than one item in that course, the Action skips it and reports "no unique match" in its comment on the issue rather than guessing.
- The pending queue is saved to your browser's local storage, so if you accidentally refresh before hitting Save, your queued changes are still there.
