import AVFoundation
import Foundation
import Observation

enum VoiceState: Equatable { case idle, listening, thinking, speaking }

struct Exchange: Identifiable {
    enum Role { case user, jarvis }
    let id = UUID()
    let role: Role
    let text: String
}

/// The conversational voice loop: idle → listening → thinking → speaking, with
/// tap-to-talk, barge-in (tap while speaking), an optional wake word while idle,
/// and automatic follow-up listening when Jarvis asks a question.
@Observable
@MainActor
final class VoiceSession {
    private(set) var state: VoiceState = .idle
    private(set) var partial = ""
    private(set) var exchanges: [Exchange] = []
    var error: String?
    var hotwordEnabled = false { didSet { syncHotword() } }
    let hotwordAvailable = Hotword.isConfigured

    private let recognizer = SpeechRecognizer()
    private let speaker = Speaker()
    private let hotword = Hotword()
    private var turn: Task<Void, Never>?
    private var permitted = false
    private var circleId: String?
    private var interruptionObserver: NSObjectProtocol?

    // MARK: Lifecycle

    func activate(circleId: String?) async {
        self.circleId = circleId
        permitted = await SpeechRecognizer.requestPermissions()
        guard permitted else {
            error = "Allow the microphone and speech recognition for Jarvis in Settings."
            return
        }
        do { try AudioSession.activate() } catch { self.error = error.localizedDescription }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            Task { @MainActor in self?.handleInterruption(note) }
        }
        syncHotword()
    }

    func deactivate() {
        turn?.cancel()
        turn = nil
        recognizer.cancel()
        speaker.stop()
        hotword.stop()
        if let o = interruptionObserver { NotificationCenter.default.removeObserver(o) }
        interruptionObserver = nil
        AudioSession.deactivate()
        state = .idle
    }

    // MARK: Interaction

    func tap() {
        switch state {
        case .idle:
            startTurn()
        case .listening:
            recognizer.finishNow()
        case .speaking:
            startTurn() // barge-in: cancels the current turn and listens again
        case .thinking:
            break
        }
    }

    private func startTurn() {
        guard permitted else { return }
        turn?.cancel()
        speaker.stop()
        turn = Task { await runTurn() }
    }

    private func runTurn() async {
        hotword.stop()
        state = .listening
        partial = ""
        error = nil

        let heard: String
        do {
            heard = try await recognizer.listen { [weak self] p in self?.partial = p }
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
            return settle()
        }
        guard !Task.isCancelled else { return }
        let text = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return settle() }
        exchanges.append(Exchange(role: .user, text: text))

        state = .thinking
        let reply: String
        do {
            reply = try await JarvisAPI.turn(text, circleId: circleId).speech
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
            return settle()
        }
        guard !Task.isCancelled else { return }
        exchanges.append(Exchange(role: .jarvis, text: reply))

        state = .speaking
        await speaker.speak(reply)
        guard !Task.isCancelled else { return } // barged in — the new turn owns the state

        // Jarvis asked something: keep the conversation going hands-free.
        if reply.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix("?") {
            await runTurn()
        } else {
            settle()
        }
    }

    private func settle() {
        state = .idle
        partial = ""
        syncHotword()
    }

    private func syncHotword() {
        guard hotwordEnabled, permitted, state == .idle else {
            hotword.stop()
            return
        }
        do {
            try hotword.start(
                onDetect: { [weak self] in Task { @MainActor in self?.wake() } },
                onError: { [weak self] e in Task { @MainActor in self?.error = e.localizedDescription } }
            )
        } catch {
            hotwordEnabled = false
            self.error = error.localizedDescription
        }
    }

    private func wake() {
        guard state == .idle else { return }
        startTurn()
    }

    private func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch type {
        case .began:
            turn?.cancel()
            recognizer.cancel()
            speaker.stop()
            hotword.stop()
            state = .idle
        case .ended:
            try? AudioSession.activate()
            syncHotword()
        @unknown default:
            break
        }
    }
}
