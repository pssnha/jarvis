import Foundation
import Porcupine

/// "Hey Jarvis" wake word (Picovoice Porcupine). Foreground-only and owned by
/// the voice screen — it is never left running in the background.
final class Hotword {
    static var isConfigured: Bool { Config.picovoiceAccessKey != nil && Config.hotwordKeywordPath != nil }

    private var manager: PorcupineManager?

    func start(onDetect: @escaping () -> Void, onError: @escaping (Error) -> Void) throws {
        guard let key = Config.picovoiceAccessKey, let path = Config.hotwordKeywordPath else { return }
        stop()
        manager = try PorcupineManager(
            accessKey: key,
            keywordPath: path,
            onDetection: { _ in onDetect() },
            errorCallback: onError
        )
        try manager?.start()
    }

    func stop() {
        guard let m = manager else { return }
        try? m.stop()
        try? m.delete()
        manager = nil
    }
}
