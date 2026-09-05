import Foundation

struct VoiceContext: Decodable {
    struct Circle: Decodable, Identifiable, Hashable {
        let id: String
        let name: String
    }
    let circleId: String
    let circleName: String
    let timezone: String
    let multipleCircles: Bool
    let circles: [Circle]
}

/// The circle the user picked when they belong to several. Read by Siri intents
/// too, so a switch on the Home screen carries over to hands-free turns.
enum CirclePreference {
    private static let key = "selectedCircleId"
    static var circleId: String? {
        get { UserDefaults.standard.string(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
}

struct TurnReply: Decodable {
    let speech: String
    let circleId: String
    let circleName: String
}

enum APIError: LocalizedError {
    case noCircle
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .noCircle: return "Your account isn't in a circle yet."
        case .server(let code, let msg): return "Jarvis returned \(code): \(msg)"
        }
    }
}

/// Bearer-authenticated client for /api/voice/*. Retries once after a 401 by
/// refreshing the token, so an expired hour-old token never surfaces to Siri.
enum JarvisAPI {
    static func context() async throws -> VoiceContext {
        var path = "voice/context"
        if let id = CirclePreference.circleId { path += "?circleId=\(id)" }
        return try await request(path, method: "GET", body: nil)
    }

    static func turn(_ text: String, circleId: String? = CirclePreference.circleId) async throws -> TurnReply {
        var body: [String: String] = ["text": text]
        if let circleId { body["circleId"] = circleId }
        return try await request("voice/turn", method: "POST", body: body)
    }

    private static func request<T: Decodable>(_ path: String, method: String, body: [String: String]?) async throws -> T {
        var token = try await AuthStore.shared.validAccessToken()
        for attempt in 0..<2 {
            var req = URLRequest(url: URL(string: path, relativeTo: Config.apiBase.appendingPathComponent("/"))!)
            req.httpMethod = method
            req.timeoutInterval = 45 // agent turns can take a while
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            if let body {
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try JSONEncoder().encode(body)
            }
            let (data, resp) = try await URLSession.shared.data(for: req)
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            switch status {
            case 200: return try JSONDecoder().decode(T.self, from: data)
            case 401 where attempt == 0: token = try await AuthStore.shared.refresh().accessToken
            case 401: throw AuthError.notSignedIn
            case 404 where errorCode(data) == "no_circle": throw APIError.noCircle
            default: throw APIError.server(status, errorCode(data) ?? "unknown")
            }
        }
        throw AuthError.notSignedIn
    }

    private static func errorCode(_ data: Data) -> String? {
        (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
    }
}
