import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 72))
                .foregroundStyle(.tint)
            Text("Jarvis").font(.largeTitle.bold())
            Spacer()
            if let error = model.error {
                Text(error).foregroundStyle(.red).font(.footnote).multilineTextAlignment(.center)
            }
            Button {
                Task { await model.signIn() }
            } label: {
                Text("Sign in with Google").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.busy)
        }
        .padding(24)
    }
}
