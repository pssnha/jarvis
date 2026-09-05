import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @State private var reply: String?

    var body: some View {
        List {
            Section(model.context?.circleName ?? "Jarvis") {
                NavigationLink { VoiceView() } label: { Label("Voice", systemImage: "mic.fill") }
                HStack {
                    TextField("Ask Jarvis", text: $text)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.send)
                        .onSubmit { send() }
                    Button(action: send) { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                        .disabled(model.busy || text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if model.busy { ProgressView() }
                if let reply { Text(reply) }
            }
            if let error = model.error {
                Section { Text(error).foregroundStyle(.red) }
            }
            Section {
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            }
        }
        .navigationTitle("Jarvis")
        .refreshable { await model.refresh() }
    }

    private func send() {
        let q = text.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        text = ""
        Task { reply = await model.ask(q) }
    }
}
