import SwiftUI

struct VoiceView: View {
    @Environment(AppModel.self) private var model
    @State private var session = VoiceSession()

    var body: some View {
        VStack(spacing: 0) {
            transcript
            controls
        }
        .navigationTitle("Voice")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if session.hotwordAvailable {
                ToolbarItem(placement: .topBarTrailing) {
                    Toggle("Hey Jarvis", isOn: Binding(
                        get: { session.hotwordEnabled },
                        set: { session.hotwordEnabled = $0 }
                    ))
                    .toggleStyle(.switch)
                    .labelsHidden()
                }
            }
        }
        .task { await session.activate(circleId: model.context?.circleId) }
        .onDisappear { session.deactivate() }
        // The hotword only works while the screen is up, so keep it up.
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(session.exchanges) { line in
                        bubble(line.text, mine: line.role == .user).id(line.id)
                    }
                    if session.state == .listening, !session.partial.isEmpty {
                        bubble(session.partial, mine: true).opacity(0.6).id("partial")
                    }
                }
                .padding()
            }
            .onChange(of: session.exchanges.count) {
                if let last = session.exchanges.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
        }
    }

    private func bubble(_ text: String, mine: Bool) -> some View {
        HStack {
            if mine { Spacer(minLength: 40) }
            Text(text)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(mine ? Color.accentColor.opacity(0.15) : Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            if !mine { Spacer(minLength: 40) }
        }
    }

    private var controls: some View {
        VStack(spacing: 16) {
            if let error = session.error {
                Text(error).foregroundStyle(.red).font(.footnote).multilineTextAlignment(.center)
            }
            Text(stateLabel).font(.subheadline).foregroundStyle(.secondary)
            Button(action: session.tap) {
                ZStack {
                    Circle().fill(Color.accentColor.opacity(session.state == .listening ? 0.25 : 0.12))
                        .frame(width: 112, height: 112)
                        .scaleEffect(session.state == .listening ? 1.15 : 1)
                        .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: session.state == .listening)
                    Circle().fill(Color.accentColor).frame(width: 84, height: 84)
                    Image(systemName: icon).font(.system(size: 34, weight: .semibold)).foregroundStyle(.white)
                }
            }
            .buttonStyle(.plain)
            .disabled(session.state == .thinking)
        }
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity)
        .background(.bar)
    }

    private var stateLabel: String {
        switch session.state {
        case .idle: return session.hotwordEnabled ? "Say “Hey Jarvis”" : "Tap to talk"
        case .listening: return "Listening"
        case .thinking: return "Thinking"
        case .speaking: return "Speaking"
        }
    }

    private var icon: String {
        switch session.state {
        case .idle: return "mic.fill"
        case .listening: return "waveform"
        case .thinking: return "ellipsis"
        case .speaking: return "stop.fill"
        }
    }
}
