import SwiftUI
import WebKit

/// One embedded page of jarvis.passanha.com, kept alive for the life of its tab.
/// Signs the web view in by redeeming a one-time code from the API (Google won't
/// sign in inside a web view, so the native OAuth session is the source of truth).
@MainActor
final class WebPage: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let webView: WKWebView
    let route: String
    private var loaded = false
    private var lastSessionAttempt: Date = .distantPast

    init(hash: String) {
        self.route = hash
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.allowsInlineMediaPlayback = true
        // Appended to the default UA: the web app switches to its in-app shell on this.
        cfg.applicationNameForUserAgent = "JarvisiOS/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") ?? "1.0")"
        webView = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        cfg.userContentController.add(WeakHandler(self), name: "jarvis")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .always
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pulled), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
    }

    func loadIfNeeded() {
        guard !loaded else { return }
        loaded = true
        Task { await establishSession() }
    }

    /// Mint a code over the Bearer token and let the API set the session cookie,
    /// landing on this page's hash route.
    func establishSession() async {
        guard Date().timeIntervalSince(lastSessionAttempt) > 3 else { return } // no loops
        lastSessionAttempt = Date()
        do {
            let code = try await JarvisAPI.appSessionCode()
            var comps = URLComponents(url: Config.apiBase.appendingPathComponent("auth/app-session/\(code)"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "next", value: route)]
            webView.load(URLRequest(url: comps.url!))
        } catch {
            webView.loadHTMLString(Self.offlineHTML(error.localizedDescription), baseURL: nil)
        }
    }

    @objc private func pulled() {
        webView.scrollView.refreshControl?.endRefreshing()
        if webView.url?.host == Config.apiBase.host { webView.reload() } else { Task { await establishSession() } }
    }

    // MARK: WKScriptMessageHandler — the web app reports a lapsed session.

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.body as? String == "unauthenticated" { Task { await establishSession() } }
    }

    // MARK: Navigation — keep Jarvis in the app, everything else goes to Safari.

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url, let scheme = url.scheme else { return .allow }
        if url.host == Config.apiBase.host || scheme == "about" || scheme == "blob" || scheme == "data" { return .allow }
        await UIApplication.shared.open(url)
        return .cancel
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        webView.loadHTMLString(Self.offlineHTML(error.localizedDescription), baseURL: nil)
    }

    private static func offlineHTML(_ detail: String) -> String {
        """
        <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{font:-apple-system-body;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;
        align-items:center;justify-content:center;height:90vh;margin:0;color:#888;text-align:center;padding:24px}
        h1{font-size:1.1rem;color:#444;margin:0 0 .4rem}@media(prefers-color-scheme:dark){h1{color:#ddd}}</style>
        <h1>Jarvis is unreachable</h1><div>\(detail)</div>
        """
    }

    /// WKUserContentController retains its handlers strongly; break the cycle.
    private final class WeakHandler: NSObject, WKScriptMessageHandler {
        weak var target: WKScriptMessageHandler?
        init(_ target: WKScriptMessageHandler) { self.target = target }
        func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
            target?.userContentController(c, didReceive: m)
        }
    }
}

struct WebView: UIViewRepresentable {
    let page: WebPage
    func makeUIView(context: Context) -> WKWebView {
        page.loadIfNeeded()
        return page.webView
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// A tab or pushed screen showing one hash route of the web app.
struct WebScreen: View {
    @State private var page: WebPage
    init(hash: String) { _page = State(initialValue: WebPage(hash: hash)) }
    var body: some View {
        WebView(page: page)
            .ignoresSafeArea(edges: .bottom)
            .toolbar(.hidden, for: .navigationBar)
    }
}
