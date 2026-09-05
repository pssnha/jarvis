import AppIntents
import SwiftUI

@main
struct JarvisApp: App {
    @State private var model = AppModel()

    init() {
        // Register phrases with Siri as soon as the app has run once.
        JarvisShortcuts.updateAppShortcutParameters()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { await model.refresh() }
        }
    }
}
