import Foundation
import Observation

@Observable
@MainActor
final class AppModel {
    var signedIn = false
    var context: VoiceContext?
    var error: String?
    var busy = false

    func refresh() async {
        signedIn = await AuthStore.shared.isSignedIn
        guard signedIn else { context = nil; return }
        do {
            context = try await JarvisAPI.context()
            error = nil
        } catch let e as AuthError where e == .notSignedIn {
            signedIn = false
        } catch {
            self.error = error.localizedDescription
        }
    }

    func signIn() async {
        busy = true; defer { busy = false }
        do {
            try await AuthStore.shared.signIn()
            error = nil
            await refresh()
        } catch AuthError.cancelled {
            // user dismissed the sheet — nothing to report
        } catch {
            self.error = error.localizedDescription
        }
    }

    func signOut() async {
        await AuthStore.shared.signOut()
        CirclePreference.circleId = nil
        signedIn = false
        context = nil
    }

    func selectCircle(_ id: String) async {
        guard id != context?.circleId else { return }
        CirclePreference.circleId = id
        await refresh()
    }

    /// Text turn from the Home screen — same pipeline Siri uses.
    func ask(_ text: String) async -> String? {
        busy = true; defer { busy = false }
        do {
            error = nil
            return try await JarvisAPI.turn(text, circleId: context?.circleId).speech
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }
}

extension AuthError: Equatable {
    static func == (a: AuthError, b: AuthError) -> Bool {
        switch (a, b) {
        case (.notSignedIn, .notSignedIn), (.cancelled, .cancelled): return true
        case (.badResponse(let x), .badResponse(let y)): return x == y
        default: return false
        }
    }
}
