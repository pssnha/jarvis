import SwiftUI

struct MoreView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            if let ctx = model.context {
                if ctx.circles.count > 1 {
                    Section("Circle") {
                        Picker("Circle", selection: Binding(
                            get: { ctx.circleId },
                            set: { id in Task { await model.selectCircle(id) } }
                        )) {
                            ForEach(ctx.circles) { c in Text(c.name).tag(c.id) }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                }
                if ctx.siteAdmin || ctx.circleAdmin {
                    Section("Admin") {
                        NavigationLink("Circles") { WebScreen(hash: "#/circles") }
                        NavigationLink("Billing") { WebScreen(hash: "#/billing") }
                        if ctx.siteAdmin {
                            NavigationLink("Sign-ups") { WebScreen(hash: "#/signups") }
                            NavigationLink("Permissions") { WebScreen(hash: "#/permissions") }
                            NavigationLink("Maintenance") { WebScreen(hash: "#/maintenance") }
                        }
                    }
                }
                Section("Account") {
                    Text(ctx.email).foregroundStyle(.secondary)
                    Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                }
            } else {
                if let error = model.error { Text(error).foregroundStyle(.red) }
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            }
        }
        .navigationTitle("More")
        .refreshable { await model.refresh() }
    }
}
