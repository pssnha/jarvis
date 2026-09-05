# Releasing Jarvis iOS to the family (TestFlight)

Everything below happens on your Mac / Apple account; the repo side is done.

## One-time setup

1. **Apple Developer Program** (paid). Nothing native ships without it.
2. **App Store Connect → Apps → +**: name "Jarvis", bundle id `com.passanha.jarvis`
   (register it under Certificates, Identifiers & Profiles first, with the **Siri**
   capability ticked), SKU anything, primary language English.
3. **Xcode → Signing & Capabilities**: automatic signing, pick your team (or put
   `DEVELOPMENT_TEAM = XXXXXXXXXX` in `Config.local.xcconfig`). Confirm the Siri capability
   shows without errors.
4. **Prod**: run `deploy/sql/oauth-client-ios.sql` with the real secret; the same secret goes
   in `Config.local.xcconfig` as `JARVIS_OAUTH_CLIENT_SECRET`.
5. Optional: Picovoice AccessKey + `Hey-Jarvis_en_ios.ppn` (see README) for the hotword.

## Each build

1. Bump `CURRENT_PROJECT_VERSION` (build) and, for user-visible changes, `MARKETING_VERSION`.
2. Xcode → Product → Archive → Distribute App → **TestFlight & App Store** → Upload.
3. App Store Connect → TestFlight → the build appears after processing (5–15 min).
4. Add family members as **Internal Testers** (App Store Connect users, up to 100) — no
   Beta App Review needed. External testers would require review; avoid unless necessary.
5. Testers install TestFlight, accept the invite, install Jarvis, sign in with Google,
   then say "Hey Siri, ask Jarvis".

## Privacy answers (App Store Connect → App Privacy)

- Data collection: **No, we do not collect data from this app**. The app only sends
  what the user says to the family's own Jarvis server; nothing goes to third parties.
  (`PrivacyInfo.xcprivacy` declares no tracking, no collected data, and the UserDefaults
  required-reason `CA92.1` for the selected circle.)
- Speech recognition may route audio through Apple when on-device recognition isn't
  available for the device language — covered by the `NSSpeechRecognitionUsageDescription`.

## QA before inviting the family

| Check | How |
|---|---|
| Sign-in round trip | Fresh install → Sign in with Google → Home shows the circle name |
| Token refresh | Leave the app >1h, then run a Siri intent — must work without re-login |
| Siri: ask | "Hey Siri, ask Jarvis" → prompts for the question → spoken answer |
| Siri: today | "Hey Siri, what's on today in Jarvis" |
| Siri: add | "Hey Siri, add a reminder in Jarvis" → item appears in the web calendar |
| Siri: cancel | "Hey Siri, cancel an event in Jarvis" → Siri confirms → cancelled only after yes |
| Locked phone | All four intents with the phone locked (after first unlock) |
| Voice screen | Tap to talk → reply spoken → question from Jarvis re-opens the mic |
| Barge-in | Tap while Jarvis is speaking → it stops and listens |
| Interruption | Incoming call during a turn → screen returns to idle, no crash |
| Trip guardrail | "Add a flight to Lisbon" by voice → declined, points to the app |
| Multi-circle | Account in two circles → Circle picker on Home; Siri follows the selection |
| Hotword (if configured) | Toggle on → "Hey Jarvis" → listening; leave screen → mic indicator off |
