import AVFoundation

/// One playAndRecord session for the voice screen: mic for recognition and the
/// hotword, speaker for replies, other audio ducked while we talk.
enum AudioSession {
    static func activate() throws {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.playAndRecord, mode: .spokenAudio,
                          options: [.defaultToSpeaker, .allowBluetoothHFP, .duckOthers])
        try s.setActive(true)
    }

    static func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
