# Jarvis iOS

SwiftUI app (iOS 18+). Native: Siri App Intents for one-shots with the phone locked and
an in-app voice screen with optional "Hey Jarvis" hotword. Everything else on
jarvis.passanha.com runs inside the app as embedded web pages, signed in automatically,
so the app always matches the site without a release.

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
- `Jarvis/Voice` — the in-app conversation: `SpeechRecognizer` (SFSpeechRecognizer,
  on-device when supported, ends on a pause), `Speaker` (AVSpeechSynthesizer), `Hotword`
  (Picovoice Porcupine, foreground-only), and `VoiceSession`, the state machine
  idle → listening → thinking → speaking with tap-to-talk, barge-in, and automatic
  follow-up listening when Jarvis asks a question.
- `Jarvis/Web` — `WebPage`/`WebScreen`: the rest of Jarvis (Calendar, Vacations, Chat,
  Admin, Billing…) is the web app embedded in `WKWebView`, one page per tab. The web view
  is signed in by redeeming a one-time code (`POST /api/voice/session` →
  `GET /api/auth/app-session/:code`) for the normal session cookie, because Google refuses
  to sign in inside a web view. The UA suffix `JarvisiOS` switches the web app into its
  in-app shell (no sidebar/topbar, full-screen chat at `#/chat`). External links open in
  Safari; a lapsed session is reported back over `webkit.messageHandlers.jarvis`.
- `Jarvis/Views` — sign-in, the tab bar (Calendar · Vacations · Chat · Voice · More),
  `MoreView` (circle switcher, admin pages by role, sign out) and `VoiceView`.

## "Hey Jarvis" hotword (optional)

Off unless configured, in which case a toggle appears on the Voice screen:

1. Create an AccessKey at console.picovoice.ai and train a "Hey Jarvis" keyword for iOS.
2. Drop the file in as `Jarvis/Resources/Hey-Jarvis_en_ios.ppn` (the synced group picks it up).
3. Add `PICOVOICE_ACCESS_KEY = ...` to `Config.local.xcconfig`.

The Porcupine Swift package is pinned to a commit because the repo's tags aren't semver;
the first build clones it (large repo, one-off).

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
