# Jarvis Alexa skill

A private Alexa skill that talks to a Jarvis **circle**. Every request is
account-linked; the linked token is forwarded to the Jarvis voice API
(`/api/voice/turn`), which runs the same agent as the web chat, scoped to the
caller's circle. No calendar/vacation logic lives in the Lambda.

```
apps/alexa/
  skill-package/
    skill.json                              # skill manifest (PRIVATE distribution)
    interactionModels/custom/en-US.json     # intents + sample utterances
  lambda/
    index.js                                # fulfillment (ASK SDK v2)
    package.json                            # ask-sdk-core (installed by Alexa-hosted)
```

This folder is **not** part of the pnpm workspace tooling (its own Node/CJS
runtime); it deploys to AWS Lambda via the Alexa console / ASK CLI, not the
Jarvis docker/rsync flow.

## What it can do (Phase 2)

| Ask | Intent |
| --- | --- |
| "what's on our calendar today" | `CalendarTodayIntent` |
| "when is our next vacation" | `NextVacationIntent` |
| "tell me about the {trip} trip" | `TripDetailsIntent` |
| "what time is our flight from {origin} to {destination}" | `FlightTimeIntent` |

Reminders and group messaging come in Phase 3.

## One-time setup (Amazon Developer Console)

1. Create a free **Amazon Developer account** → open the **Alexa Developer Console**.
2. **Create Skill** → Custom model → **Alexa-hosted (Node.js)**. Region: US.
3. **Interaction model** → JSON editor → paste `skill-package/interactionModels/custom/en-US.json` → **Build model**.
4. **Code** tab → replace `index.js` and `package.json` with the files in `lambda/` → **Deploy**.
   - Set the environment variable **`JARVIS_API_BASE`** to the public Jarvis URL
     (e.g. `https://<your-jarvis-host>`, no trailing slash). On Alexa-hosted set
     it in the Lambda config; on your own Lambda use the function's env vars.
5. **Account Linking** (Build → Account Linking):
   - Auth Grant type: **Auth Code Grant**.
   - Authorization URI: `https://<jarvis>/api/oauth/authorize`
   - Access Token URI: `https://<jarvis>/api/oauth/token`
   - Client ID / Secret: the values you registered as an `OAuthClient` in Jarvis
     (see "Register the client" below).
   - Scope: `voice` (any non-empty value; Jarvis ignores scope today).
   - **Enable "Your skill sends requests with PKCE"** (S256). Client
     authentication scheme: **HTTP Basic** (or request body — both supported).
   - Add Alexa's redirect URLs (shown on that page, e.g.
     `https://layla.amazon.com/api/skill/link/...`) to the client's allowed
     redirect URIs in Jarvis.
6. Keep the skill in **Development**. Use **Test → Skill testing: Development**
   and a real Echo on the dev account. Add family members via **Distribution →
   Availability → Beta Test** (invite by email, up to 500). Do **not** submit for
   certification until it's polished — that's the only thing that makes it public.

## Register the OAuth client in Jarvis

Account linking needs an `OAuthClient` row whose `clientId`/secret you enter in
the console, and whose `redirectUris` include Alexa's link callbacks. Create it
once (replace the secret + redirect URIs Alexa shows you):

```sql
-- clientId is public; store the sha256 of the secret. Example secret below is a
-- placeholder — generate a strong one and paste the same value into the console.
INSERT INTO OAuthClient (id, clientId, secretHash, name, redirectUris, createdAt)
VALUES (
  UUID(),
  'alexa-skill',
  SHA2('PUT-A-STRONG-SECRET-HERE', 256),
  'Alexa skill',
  'https://layla.amazon.com/api/skill/link/CALLBACK1,https://pitangui.amazon.com/api/skill/link/CALLBACK2,https://alexa.amazon.co.jp/api/skill/link/CALLBACK3',
  NOW(3)
);
```

(Alexa shows the exact redirect URLs on the Account Linking page; copy all of
them in, comma-separated.)

## Testing checklist

- Unlinked: invoking the skill speaks the link prompt and drops a LinkAccount
  card in the Alexa app.
- Linked: each of the four asks above speaks the agent's answer.
- A foreign/expired token → the skill falls back to the link prompt (the voice
  API returns 401).
