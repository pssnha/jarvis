import AppIntents
import Foundation

/// Shared plumbing: every intent is one server turn whose spoken reply becomes
/// the Siri dialog. Auth/network failures surface as a short spoken sentence.
enum IntentTurn {
    static func speak(_ text: String) async throws -> IntentDialog {
        do {
            return IntentDialog(stringLiteral: try await JarvisAPI.turn(text).speech)
        } catch let e as LocalizedError {
            throw IntentError.spoken(e.errorDescription ?? "Something went wrong.")
        }
    }
}

enum IntentError: Error, CustomLocalizedStringResourceConvertible {
    case spoken(String)
    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .spoken(let s): return "\(s)"
        }
    }
}

/// "Hey Siri, ask Jarvis …" — the open natural-language intent (spec R1).
struct AskJarvisIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Jarvis"
    static let description = IntentDescription("Ask about or change the family calendar.")
    static let openAppWhenRun = false

    @Parameter(title: "Question", requestValueDialog: "What would you like to ask Jarvis?")
    var query: String

    static var parameterSummary: some ParameterSummary {
        Summary("Ask Jarvis \(\.$query)")
    }

    func perform() async throws -> some ProvidesDialog {
        .result(dialog: try await IntentTurn.speak(query))
    }
}

/// "Hey Siri, what's on today in Jarvis" (spec R2).
struct CalendarTodayIntent: AppIntent {
    static let title: LocalizedStringResource = "What's On Today"
    static let description = IntentDescription("Hear today's family calendar.")
    static let openAppWhenRun = false

    func perform() async throws -> some ProvidesDialog {
        .result(dialog: try await IntentTurn.speak("What's on the calendar today?"))
    }
}

/// "Hey Siri, add a reminder in Jarvis" (spec R3).
struct AddReminderIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a Reminder"
    static let description = IntentDescription("Add a reminder or event to the family calendar.")
    static let openAppWhenRun = false

    @Parameter(title: "Reminder", requestValueDialog: "What should I add, and when?")
    var reminder: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$reminder)")
    }

    func perform() async throws -> some ProvidesDialog {
        .result(dialog: try await IntentTurn.speak("Add to the calendar: \(reminder)"))
    }
}

/// "Hey Siri, cancel an event in Jarvis" — the agent reads back what it found
/// and Siri asks for confirmation before anything is removed (spec R4).
struct CancelEventIntent: AppIntent {
    static let title: LocalizedStringResource = "Cancel an Event"
    static let description = IntentDescription("Cancel a calendar item after confirming which one.")
    static let openAppWhenRun = false

    @Parameter(title: "Event", requestValueDialog: "Which event should I cancel?")
    var what: String

    static var parameterSummary: some ParameterSummary {
        Summary("Cancel \(\.$what)")
    }

    func perform() async throws -> some ProvidesDialog {
        // The voice prompt guarantees this first turn only *describes* the match
        // and asks — it never cancels before a spoken yes.
        let question = try await IntentTurn.speak("Cancel \(what)")
        do {
            try await requestConfirmation(actionName: .do, dialog: question)
        } catch {
            // Declined: close the agent's pending question so the next turn starts clean.
            _ = try? await JarvisAPI.turn("No, leave it as it is.")
            throw error
        }
        return .result(dialog: try await IntentTurn.speak("Yes, cancel it."))
    }
}

struct JarvisShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskJarvisIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Talk to \(.applicationName)",
                "Hey \(.applicationName)",
            ],
            shortTitle: "Ask Jarvis",
            systemImageName: "waveform.circle"
        )
        AppShortcut(
            intent: CalendarTodayIntent(),
            phrases: [
                "What's on today in \(.applicationName)",
                "What's on the \(.applicationName) calendar today",
                "\(.applicationName) today",
            ],
            shortTitle: "Today",
            systemImageName: "calendar"
        )
        AppShortcut(
            intent: AddReminderIntent(),
            phrases: [
                "Add a reminder in \(.applicationName)",
                "Add an event in \(.applicationName)",
                "Remind us in \(.applicationName)",
            ],
            shortTitle: "Add",
            systemImageName: "plus.circle"
        )
        AppShortcut(
            intent: CancelEventIntent(),
            phrases: [
                "Cancel an event in \(.applicationName)",
                "Cancel a reminder in \(.applicationName)",
            ],
            shortTitle: "Cancel",
            systemImageName: "xmark.circle"
        )
    }
}
