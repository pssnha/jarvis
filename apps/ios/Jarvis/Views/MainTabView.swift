import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            WebScreen(hash: "#/calendar")
                .tabItem { Label("Calendar", systemImage: "calendar") }
            WebScreen(hash: "#/vacations")
                .tabItem { Label("Vacations", systemImage: "airplane") }
            WebScreen(hash: "#/chat")
                .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
            NavigationStack { VoiceView() }
                .tabItem { Label("Voice", systemImage: "waveform") }
            NavigationStack { MoreView() }
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
    }
}
