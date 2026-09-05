import AVFoundation
import Speech

/// One utterance at a time: starts the mic, streams partials, and resolves when
/// the speaker pauses (or the recognizer finalizes). On-device when supported.
final class SpeechRecognizer {
    enum RecognizerError: LocalizedError {
        case unavailable
        var errorDescription: String? { "Speech recognition isn't available right now." }
    }

    private let recognizer: SFSpeechRecognizer?
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?
    private var continuation: CheckedContinuation<String, Error>?
    private var latest = ""
    private let lock = NSLock()

    init() {
        recognizer = SFSpeechRecognizer(locale: .current) ?? SFSpeechRecognizer()
    }

    static func requestPermissions() async -> Bool {
        guard await AVAudioApplication.requestRecordPermission() else { return false }
        let status = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
        }
        return status == .authorized
    }

    /// Listens until the user pauses. `onPartial` is called on the main thread.
    func listen(onPartial: @escaping (String) -> Void) async throws -> String {
        guard let recognizer, recognizer.isAvailable else { throw RecognizerError.unavailable }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request
        latest = ""

        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        try engine.start()

        return try await withCheckedThrowingContinuation { cont in
            lock.withLock { continuation = cont }
            armSilenceTimer(initial: true)
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self else { return }
                if let result {
                    let text = result.bestTranscription.formattedString
                    if text != self.latest {
                        self.latest = text
                        DispatchQueue.main.async { onPartial(text) }
                        self.armSilenceTimer(initial: false)
                    }
                    if result.isFinal { self.finish(.success(text)) }
                } else if let error {
                    self.finish(.failure(error))
                }
            }
        }
    }

    /// Stop early and use whatever has been heard so far (tap while listening).
    func finishNow() { finish(.success(latest)) }

    func cancel() { finish(.failure(CancellationError())) }

    // Wait ~6s for the user to start, then end 1.4s after they stop talking.
    private func armSilenceTimer(initial: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.silenceTimer?.invalidate()
            self.silenceTimer = Timer.scheduledTimer(withTimeInterval: initial ? 6 : 1.4, repeats: false) { [weak self] _ in
                self?.finishNow()
            }
        }
    }

    private func finish(_ result: Result<String, Error>) {
        let cont: CheckedContinuation<String, Error>? = lock.withLock {
            defer { continuation = nil }
            return continuation
        }
        guard let cont else { return } // already finished
        DispatchQueue.main.async { [weak self] in
            self?.silenceTimer?.invalidate()
            self?.silenceTimer = nil
        }
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        cont.resume(with: result)
    }
}
