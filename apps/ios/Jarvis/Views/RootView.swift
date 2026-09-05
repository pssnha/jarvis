import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            if model.signedIn {
                HomeView()
            } else {
                SignInView()
            }
        }
    }
}
