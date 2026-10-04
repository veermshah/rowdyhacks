# Riverwalk with Presage through a Cloudflare tunnel

Presage face scanning runs on a laptop (it needs real CPU and the API key), and
a free Cloudflare tunnel makes it reachable from the deployed game. Everything
else (loot, wanted level, Alamo, Tower, the Pi) stays on the Python server on
Render.

```
browser (Vercel game) ──► Python server on Render   loot · wanted · Alamo · Tower
          │                       ▲
          │ Riverwalk only        │ game relays: riverwalk_complete / riverwalk_alarm
          ▼                       │
   https://<name>.trycloudflare.com ──► laptop: Node Presage server (:5001)
```

## On the laptop (Windows, PowerShell)

One-time:
```powershell
winget install --id Cloudflare.cloudflared   # or download cloudflared-windows-amd64.exe from its GitHub releases
cd server
npm install
copy .env.example .env                        # put PRESAGE_API_KEY in it
```

Every session, two terminals:
```powershell
# 1) Presage server on port 5001
cd server
$env:PORT=5001; npm start                     # should print "API key: set"

# 2) the tunnel
cd server
npm run tunnel                                # prints https://<random-name>.trycloudflare.com
```

## Play

Add the tunnel link to the game URL:

```
https://rowdyhacks-green.vercel.app/?presage=https://<random-name>.trycloudflare.com
```

Local testing works the same: `http://localhost:5173/?presage=https://<random-name>.trycloudflare.com`
(or `?presage=http://localhost:5001` with no tunnel).

Without `?presage=`, the game behaves exactly as before (everything on the
Python server).

## Notes

- Keep the laptop awake and both terminals open. The tunnel link changes every
  time `npm run tunnel` restarts, so send teammates the new link.
- One player can be scanned at a time (a Presage SDK limit). Others see
  "Another crew is at the checkpoint".
- `CORS_ORIGINS` in `server/.env` must include the game's address, e.g.
  `https://rowdyhacks-green.vercel.app,http://localhost:5173` (any localhost
  port is always allowed).
- The tunnel needs outbound port 7844. Some campus/event Wi-Fi blocks it
  (cloudflared logs "Allow outbound TCP on port 7844") - switch networks or use
  a phone hotspot. ngrok (port 443) is an alternative; the game sends ngrok's
  `ngrok-skip-browser-warning` header so its free-plan warning page doesn't
  block the connection.
- The Python server must be a version with the `riverwalk_complete` and
  `riverwalk_alarm` handlers, or Presage clears won't pay out.
