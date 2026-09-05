# Jarvis iOS

SwiftUI app (iOS 18+) that gives the family hands-free access to Jarvis: Siri App
Intents for one-shots with the phone locked, and (P2) an in-app "Hey Jarvis" voice
screen. It only talks to the existing API — `/api/oauth/*` for sign-in and
`/api/voice/*` for turns — so all scheduling logic stays server-side on the `voice`
tool surface.

Not part of the pnpm/TS toolchain (like `apps/alexa`): build it with Xcode.

## Layout

- `Jarvis.xcodeproj` — single app target; sources are a file-system-synchronized group,
  so new `.swift` files under `Jarvis/` are picked up automatically.
- `Config.xcconfig` — API host, bundle id, OAuth client id. Put the real client secret
  and your `DEVELOPMENT_TEAM` in `Config.local.xcconfig` (git-ignored).
- `Jarvis/Auth` — OAuth2 authorization-code + PKCE via `ASWebAuthenticationSession`,
  tokens in the Keychain, silent refresh (rotating refresh tokens).
- `Jarvis/API` — Bearer client for `/voice/context` and `/voice/turn`; retries once on 401.
- `Jarvis/Intents` — `AskJarvisIntent` (open question), `CalendarTodayIntent`,
  `AddReminderIntent`, `CancelEventIntent` (Siri confirmation before the cancel turn),
  and the `AppShortcutsProvider` phrases.
- `Jarvis/Views` — sign-in and a Home screen with a text box that runs the same turn
  pipeline Siri uses (handy for testing without speaking).

## First run

1. Seed the OAuth client in prod (`deploy/sql/oauth-client-ios.sql`) with a real secret.
2. Create `Config.local.xcconfig`:
   ```
   DEVELOPMENT_TEAM = XXXXXXXXXX
   JARVIS_OAUTH_CLIENT_SECRET = the-same-secret
   ```
3. Open `Jarvis.xcodeproj`, pick your device, run. Sign in with Google.
4. Say "Hey Siri, ask Jarvis" — phrases are registered on first launch.

## Build from the terminal

```
xcodebuild -project Jarvis.xcodeproj -scheme Jarvis \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```
