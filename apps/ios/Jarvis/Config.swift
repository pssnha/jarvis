import Foundation

/// Build-time settings, injected into Info.plist from Config.xcconfig.
enum Config {
    private static func string(_ key: String) -> String {
        guard let v = Bundle.main.object(forInfoDictionaryKey: key) as? String, !v.isEmpty else {
            fatalError("Missing \(key) in Info.plist — check Config.xcconfig")
        }
        return v
    }

    static let apiBase = URL(string: "https://\(string("JarvisAPIHost"))/api")!
    static let oauthClientId = string("JarvisOAuthClientId")
    static let oauthClientSecret = string("JarvisOAuthClientSecret")
    static let oauthRedirect = URL(string: "jarvis://oauth/callback")!
    static let oauthCallbackScheme = "jarvis"

    /// Hotword is optional: present only when both the key and the keyword model exist.
    static let picovoiceAccessKey: String? = {
        let v = Bundle.main.object(forInfoDictionaryKey: "PicovoiceAccessKey") as? String ?? ""
        return v.isEmpty ? nil : v
    }()
    static let hotwordKeywordPath: String? =
        Bundle.main.path(forResource: "Hey-Jarvis_en_ios", ofType: "ppn")
}
