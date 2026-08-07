# Pulse — Live Trend Discovery

## Setup (5 minutes, free)

### Step 1: Put this on GitHub
1. Go to **github.com** → click **+** → **New repository**
2. Name it `pulse` → click **Create repository**
3. Click **uploading an existing file**
4. Drag ALL files from this folder into the upload box
5. Click **Commit changes**

### Step 2: Connect to Netlify
1. Go to **netlify.com** → **Add new site** → **Import an existing project**
2. Click **GitHub** → authorize → select your `pulse` repo
3. Build settings: leave everything blank (auto-detected)
4. Click **Deploy site**

### Step 3: Add your API key
1. In Netlify: **Site configuration** → **Environment variables** → **Add a variable**
2. Key: `RAPIDAPI_KEY`
3. Value: `2b38b98bf6msh7c278ae47bd93b0p1d1928jsn060fc738b1af`
4. Click **Save** → then **Trigger deploy** → **Deploy site**

### Done!
- Reddit scraping works immediately (real posts, real comments)
- TikTok works with the RapidAPI key
- Auto-refreshes every 15 minutes
