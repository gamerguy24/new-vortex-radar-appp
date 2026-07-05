# YouTube Live setup (Chase Stream Hub)

This connects a chaser's **own** YouTube channel so that hitting **Go Live** in the
Chase Stream Hub will:

1. create the YouTube live broadcast + RTMP stream for them,
2. push YouTube's ingest URL + stream key straight into OBS over obs-websocket,
3. start OBS, and
4. post the watch link to Discord.

The code is already built. The steps below are the parts **only you can do** —
creating the Google Cloud OAuth app under your account. Budget ~15 minutes.

Once `YOUTUBE_CLIENT_ID` + `YOUTUBE_CLIENT_SECRET` are set and the server is
restarted, the Hub's YouTube **Connect** button lights up. Until then it returns
503 and the rest of the Hub works normally.

---

## 1. Create a Google Cloud project
1. Go to <https://console.cloud.google.com/> and create a project (e.g.
   "Vortex Radar Live").

## 2. Enable the YouTube Data API v3
1. **APIs & Services ▸ Library** → search **YouTube Data API v3** → **Enable**.

## 3. Configure the OAuth consent screen
1. **APIs & Services ▸ OAuth consent screen**.
2. User type: **External**. Fill in app name, support email, developer email.
3. **Scopes** → add `https://www.googleapis.com/auth/youtube.force-ssl`.
4. **Test users** → add the Google accounts (chaser channels) that will connect
   **while the app is in "Testing"**. In Testing mode only these accounts can
   connect, and refresh tokens expire after 7 days.
5. To let anyone connect and get long-lived tokens, **Publish** the app. Google
   may require verification because `youtube.force-ssl` is a sensitive scope —
   that review can take days, so start it early if you need public access.

## 4. Create the OAuth client ID
1. **APIs & Services ▸ Credentials ▸ Create credentials ▸ OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized redirect URIs** — add exactly (must match the server's redirect):
   - Production: `https://vortex-dome22.onrender.com/api/stream/connect/youtube/callback`
   - Local dev:  `http://localhost:3333/api/stream/connect/youtube/callback`
   (Add both if you test locally. The path is always
   `/api/stream/connect/youtube/callback`.)
4. Create → copy the **Client ID** and **Client secret**.

## 5. Put the credentials on the server
Add to `.env` (local) and to your host's environment (Render ▸ Environment):

```
YOUTUBE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=xxxxxxxx
# In production, pin the redirect so it never depends on proxy headers:
YOUTUBE_REDIRECT_URI=https://vortex-dome22.onrender.com/api/stream/connect/youtube/callback
```

Restart the server.

## 6. Connect a channel and test
1. In the app, open the **Chase Stream Hub** (video button, bottom-right) →
   **Auto-post** → YouTube **Connect**. Finish Google sign-in in the browser tab
   that opens, then return to the app — the row should read *channel connected ✓*.
2. Tick **YouTube Live**, make sure **Control OBS** is on with your laptop's
   obs-websocket host/port/password, and hit **Go Live**.
3. The Hub creates the broadcast, points OBS at YouTube's key, and starts OBS.
   YouTube auto-starts the broadcast once it sees the feed and auto-stops when
   you hit **Stop stream**.

---

## Gotchas
- **The channel must be live-enabled.** New/unverified channels can't stream —
  verify the channel and enable live streaming at
  <https://www.youtube.com/features> (can take 24h the first time).
- **"Google hasn't verified this app"** in Testing mode is expected for test
  users — click *Advanced ▸ Continue*. Publish + verify to remove it.
- **No refresh token returned?** The server forces `prompt=consent`, but if it
  still happens, remove Vortex Radar at
  <https://myaccount.google.com/permissions> and reconnect.
- **Mobile app (WebView):** Google blocks OAuth inside plain WebViews. The Hub
  opens the consent screen in a Custom Tab / system browser, which Google allows.
- **Redirect URI mismatch** is the most common error — the value in Google
  Cloud must match the server's redirect character-for-character (scheme, host,
  path, no trailing slash).

## What's stored
Only a **refresh token** per user, inside `server_data/stream_configs.json`
(`youtube.refreshToken`). It never leaves the server and is masked from the
client (`/api/stream/config` only reports `youtubeConfigured: true/false`).
Disconnecting deletes it.
