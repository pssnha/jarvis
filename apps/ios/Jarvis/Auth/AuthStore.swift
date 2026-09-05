import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

struct TokenSet: Codable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
}

enum AuthError: LocalizedError {
    case notSignedIn
    case cancelled
    case badResponse(String)

    var errorDescription: String? {
        switch self {
        case .notSignedIn: return "Open Jarvis and sign in first."
        case .cancelled: return "Sign-in was cancelled."
        case .badResponse(let s): return s
        }
    }
}

/// OAuth2 authorization-code + PKCE against the Jarvis API, with tokens in the
/// Keychain and silent refresh. One shared instance; safe from intents (no UI
/// dependency except in `signIn`).
actor AuthStore {
    static let shared = AuthStore()
    private static let account = "oauth-tokens"

    private var tokens: TokenSet? = Keychain.load(TokenSet.self, account: AuthStore.account)
    private var refreshing: Task<TokenSet, Error>?

    var isSignedIn: Bool { tokens != nil }

    // MARK: Sign in / out

    @MainActor
    func signIn() async throws {
        let verifier = Self.randomURLSafe(32)
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.randomURLSafe(16)

        var comps = URLComponents(url: Config.apiBase.appendingPathComponent("oauth/authorize"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            .init(name: "client_id", value: Config.oauthClientId),
            .init(name: "redirect_uri", value: Config.oauthRedirect.absoluteString),
            .init(name: "response_type", value: "code"),
            .init(name: "state", value: state),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
        ]

        let callback = try await WebAuth.run(url: comps.url!, scheme: Config.oauthCallbackScheme)
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value else {
            throw AuthError.badResponse(items.first(where: { $0.name == "error" })?.value ?? "No code returned.")
        }

        let set = try await Self.exchange([
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": Config.oauthRedirect.absoluteString,
            "code_verifier": verifier,
        ])
        await store(set)
    }

    func signOut() {
        tokens = nil
        Keychain.delete(account: Self.account)
    }

    // MARK: Tokens

    /// A usable access token, refreshing first if it expires within a minute.
    func validAccessToken() async throws -> String {
        guard let t = tokens else { throw AuthError.notSignedIn }
        if t.expiresAt.timeIntervalSinceNow > 60 { return t.accessToken }
        return try await refresh().accessToken
    }

    /// Force a refresh (after a 401). Coalesces concurrent callers.
    func refresh() async throws -> TokenSet {
        if let inflight = refreshing { return try await inflight.value }
        guard let t = tokens else { throw AuthError.notSignedIn }
        let task = Task<TokenSet, Error> {
            do {
                let set = try await Self.exchange(["grant_type": "refresh_token", "refresh_token": t.refreshToken])
                self.store(set)
                return set
            } catch let e as AuthError {
                // The server rotates refresh tokens; a rejected one means we're out.
                if case .badResponse = e { self.signOut() }
                throw e
            }
        }
        refreshing = task
        defer { refreshing = nil }
        return try await task.value
    }

    private func store(_ set: TokenSet) {
        tokens = set
        try? Keychain.save(set, account: Self.account)
    }

    // MARK: Token endpoint

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Double
    }

    private static func exchange(_ params: [String: String]) async throws -> TokenSet {
        var req = URLRequest(url: Config.apiBase.appendingPathComponent("oauth/token"))
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var all = params
        all["client_id"] = Config.oauthClientId
        all["client_secret"] = Config.oauthClientSecret
        req.httpBody = all
            .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? "")" }
            .joined(separator: "&")
            .data(using: .utf8)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            let body = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "token_error"
            throw AuthError.badResponse(body)
        }
        let tr = try JSONDecoder().decode(TokenResponse.self, from: data)
        return TokenSet(accessToken: tr.access_token, refreshToken: tr.refresh_token,
                        expiresAt: Date().addingTimeInterval(tr.expires_in))
    }

    // MARK: PKCE helpers

    private static func randomURLSafe(_ bytes: Int) -> String {
        var buf = [UInt8](repeating: 0, count: bytes)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes, &buf)
        return base64URL(Data(buf))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension CharacterSet {
    /// RFC 3986 unreserved — what form-encoded values may contain unescaped.
    static let urlQueryValueAllowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
}

/// ASWebAuthenticationSession wrapped for async/await.
@MainActor
enum WebAuth {
    private final class Anchor: NSObject, ASWebAuthenticationPresentationContextProviding {
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
    }
    private static let anchor = Anchor()
    private static var current: ASWebAuthenticationSession?

    static func run(url: URL, scheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, error in
                current = nil
                if let callback { cont.resume(returning: callback); return }
                if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                    cont.resume(throwing: AuthError.cancelled)
                } else {
                    cont.resume(throwing: error ?? AuthError.badResponse("Sign-in failed."))
                }
            }
            session.presentationContextProvider = anchor
            // Shared cookies so an existing Google session on the phone is reused.
            session.prefersEphemeralWebBrowserSession = false
            current = session
            session.start()
        }
    }
}
