import SwiftUI

struct ParentAccountView: View {
    @Environment(ParentStore.self) private var store
    var body: some View {
        ParentPage {
            HStack(spacing: 12) {
                SymbolTile(symbol: "person.crop.circle.fill", color: ParentTheme.moon)
                VStack(alignment: .leading, spacing: 6) {
                    Text(store.account?.displayName ?? tr("parent")).font(.title3.bold())
                    Text(tr("family_companion")).font(.caption).foregroundStyle(ParentTheme.muted)
                }
                Spacer()
                NavigationLink(value: ParentRoute.contacts) { Text(tr("contacts")).font(.caption).padding(10).background(ParentTheme.card, in: Capsule()) }
            }.padding(.vertical, 8)
            DataStatus()
            HStack(alignment: .top, spacing: 12) {
                NavigationLink(value: ParentRoute.mailbox) {
                    VStack(alignment: .leading, spacing: 10) {
                        Image(systemName: "envelope.open.fill").font(.title2)
                        Text(tr("mailbox")).font(.headline)
                        Text(tr("mailbox_subtitle")).font(.caption)
                    }.frame(maxWidth: .infinity, minHeight: 105, alignment: .leading).padding(16)
                        .foregroundStyle(ParentTheme.accent).background(ParentTheme.lavender, in: RoundedRectangle(cornerRadius: 22))
                }.buttonStyle(.plain)
                NavigationLink(value: ParentRoute.children) {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack { Text(tr("my_children")).font(.headline); Spacer(); Image(systemName: "chevron.right").font(.caption) }
                        ForEach(store.children.prefix(2)) { child in
                            Label(child.name, systemImage: child.id == store.selectedChildID ? "sun.max.fill" : "moon.stars.fill").font(.subheadline)
                        }
                    }.frame(maxWidth: .infinity, minHeight: 105, alignment: .topLeading).padding(16)
                        .background(ParentTheme.card, in: RoundedRectangle(cornerRadius: 22))
                }.buttonStyle(.plain)
            }
            ParentCard {
                SectionTitle(key: "course_services")
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 22) {
                    Shortcut(title: "all_courses", symbol: "books.vertical", route: .courses, color: ParentTheme.sky)
                    Shortcut(title: "reports", symbol: "text.bubble", route: .reports)
                    Shortcut(title: "leave", symbol: "calendar.badge.clock", route: .service("leave"), color: ParentTheme.rose)
                    Shortcut(title: "reschedule", symbol: "arrow.triangle.2.circlepath", route: .service("reschedule"), color: ParentTheme.leaf)
                    Shortcut(title: "transfer", symbol: "arrow.left.arrow.right", route: .service("transfer"))
                    Shortcut(title: "shipping", symbol: "shippingbox", route: .service("shipping"), color: ParentTheme.moon)
                    Shortcut(title: "assessments", symbol: "chart.bar.xaxis", route: .assessments, color: ParentTheme.sky)
                    Shortcut(title: "growth", symbol: "leaf", route: .growth, color: ParentTheme.leaf)
                }
                SectionTitle(key: "everyday_tools")
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 22) {
                    Shortcut(title: "address", symbol: "mappin.and.ellipse", route: .address, color: ParentTheme.rose)
                    Shortcut(title: "invite", symbol: "person.badge.plus", route: .invite, color: ParentTheme.leaf)
                    Shortcut(title: "feedback", symbol: "bubble.left", route: .feedback)
                    Shortcut(title: "settings", symbol: "gearshape", route: .settings, color: ParentTheme.muted)
                }
            }
            Text(tr("encouragement")).font(.caption).foregroundStyle(ParentTheme.muted).frame(maxWidth: .infinity)
        }.navigationTitle(tr("parent")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { NavigationLink(value: ParentRoute.settings) { Image(systemName: "gearshape") }.accessibilityLabel(tr("settings")) } }
    }
}

struct ChildrenView: View {
    @Environment(ParentStore.self) private var store
    var body: some View {
        ParentPage {
            ForEach(store.children) { child in
                Button { Task { await store.selectChild(child.id) } } label: {
                    ParentCard {
                        HStack {
                            SymbolTile(symbol: "person.crop.circle.fill", color: ParentTheme.moon)
                            Text(child.name).font(.headline)
                            Spacer()
                            if child.id == store.selectedChildID { ParentBadge(text: tr("selected_child")) }
                        }
                    }
                }.buttonStyle(.plain)
            }
            if store.children.isEmpty { EmptyState(title: "no_child", detail: "no_child_detail", symbol: "person.crop.circle.badge.plus") }
            Text(tr("family_record_detail")).font(.footnote).foregroundStyle(ParentTheme.muted)
            NavigationLink(value: ParentRoute.invite) { Label(tr("invite"), systemImage: "person.badge.plus") }
        }.navigationTitle(tr("my_children"))
    }
}

struct ParentSettingsView: View {
    @Environment(ParentStore.self) private var store
    @State private var confirmLogout = false
    var body: some View {
        ParentPage {
            ParentCard {
                SectionTitle(key: "account_security")
                Text(store.account?.displayName ?? tr("parent"))
                Text(tr("account_security_detail")).font(.footnote).foregroundStyle(ParentTheme.muted)
            }
            ParentCard {
                SectionTitle(key: "notifications_settings")
                Text(tr("notifications_detail")).font(.subheadline).foregroundStyle(ParentTheme.muted)
            }
            ParentCard {
                SectionTitle(key: "privacy")
                Text(tr("privacy_detail")).font(.subheadline).foregroundStyle(ParentTheme.muted)
                Button(tr("refresh_data")) { Task { await store.loadAccount() } }.disabled(store.loading)
            }
            ParentCard {
                HStack { Text(tr("about")); Spacer(); Text("Mathin · 0.2.0").foregroundStyle(ParentTheme.muted) }
                Text(tr("about_detail")).font(.footnote).foregroundStyle(ParentTheme.muted)
                #if DEBUG
                Text(store.api.origin?.host ?? tr("preview_mode")).font(.caption).foregroundStyle(ParentTheme.muted)
                #endif
            }
            Button(tr(store.preview ? "exit_preview" : "logout")) { confirmLogout = true }.buttonStyle(PrimaryButton())
        }.navigationTitle(tr("settings"))
            .confirmationDialog(tr(store.preview ? "exit_preview" : "logout"), isPresented: $confirmLogout, titleVisibility: .visible) {
                Button(tr("confirm"), role: .destructive) { Task { await store.logout() } }
                Button(tr("cancel"), role: .cancel) { }
            } message: { Text(tr("logout_detail")) }
    }
}

struct ServiceAvailabilityView: View {
    let kind: String
    var body: some View {
        ParentPage {
            EmptyState(title: "service_pending", detail: "availability_" + kind, symbol: symbol)
            NavigationLink(value: ParentRoute.contacts) { Label(tr("find_teacher"), systemImage: "person.crop.square") }.buttonStyle(PrimaryButton())
        }.navigationTitle(tr(kind))
    }
    private var symbol: String {
        switch kind {
        case "mistakes": "book.closed"
        case "mailbox", "feedback": "envelope.open"
        case "invite": "person.badge.plus"
        case "address": "mappin.and.ellipse"
        case "reading": "waveform"
        case "calls": "phone"
        default: "sparkles"
        }
    }
}

struct CourseServiceView: View {
    @Environment(ParentStore.self) private var store
    let kind: String
    @State private var sessionID = ""
    @State private var reason = ""
    @State private var busy = false
    @State private var status: String?
    @State private var error: String?
    @State private var uncertain = false
    private var sessions: [LearningSession] { store.schedule.filter { (ParentDate.parse($0.startsAt) ?? .distantPast) > Date() } }
    var body: some View {
        if kind != "leave" { ServiceAvailabilityView(kind: kind) }
        else {
            ParentPage {
                ChildHeader()
                DataStatus()
                ParentCard {
                    SectionTitle(key: "leave_notice")
                    Text(tr("leave_detail")).font(.subheadline).foregroundStyle(ParentTheme.muted)
                }
                ParentCard {
                    Picker(tr("choose_lesson"), selection: $sessionID) {
                        Text(tr("please_select")).tag("")
                        ForEach(sessions) { lesson in Text(parentDate(lesson.startsAt) + " · " + lesson.title).tag(lesson.id) }
                    }.pickerStyle(.menu).disabled(busy || uncertain)
                    Text(tr("leave_reason")).font(.subheadline.weight(.medium))
                    TextEditor(text: $reason).frame(minHeight: 110).padding(8).scrollContentBackground(.hidden)
                        .background(ParentTheme.paper, in: RoundedRectangle(cornerRadius: 12)).accessibilityLabel(tr("leave_reason"))
                        .disabled(busy || uncertain)
                    HStack { Spacer(); Text("\(ParentValidation.textLength(reason))/1000").font(.caption).foregroundStyle(ParentValidation.textLength(reason) > 1000 ? ParentTheme.rose : ParentTheme.muted) }
                    if let error { Text(error).font(.footnote).foregroundStyle(ParentTheme.rose) }
                    if let status { Label(status, systemImage: "checkmark.circle").font(.footnote).foregroundStyle(ParentTheme.leaf) }
                    if uncertain {
                        Text(tr("leave_uncertain")).font(.footnote).foregroundStyle(ParentTheme.muted)
                        Button(tr("refresh_requests")) { Task { await store.loadChild() } }
                        Button(tr("new_request_after_check")) { uncertain = false; reason = ""; sessionID = ""; error = nil }
                            .disabled(store.loading || store.error != nil)
                    }
                    Button { Task { await submit() } } label: {
                        if busy { ProgressView().tint(.white) } else { Text(tr("submit_leave")) }
                    }.buttonStyle(PrimaryButton())
                        .disabled(busy || uncertain || store.preview || store.learning?.capabilities.leaveRequests != true || sessionID.isEmpty || ParentValidation.textLength(reason) == 0 || ParentValidation.textLength(reason) > 1000)
                    if store.preview { Text(tr("preview_no_write")).font(.caption).foregroundStyle(ParentTheme.muted) }
                }
                SectionTitle(key: "leave_records")
                if store.learning?.leaveRequests.isEmpty != false { Text(tr("no_leave_requests")).font(.subheadline).foregroundStyle(ParentTheme.muted) }
                ForEach(store.learning?.leaveRequests ?? []) { request in
                    ParentCard {
                        HStack { Text(request.sessionTitle).font(.headline); Spacer(); ParentBadge(text: tr("leave_" + request.status)) }
                        Text(request.reason).font(.subheadline)
                        Text(parentDate(request.createdAt)).font(.caption).foregroundStyle(ParentTheme.muted)
                        if let makeup = request.makeupStartsAt { Label(tr("makeup") + " · " + parentDate(makeup), systemImage: "calendar") }
                    }
                }
            }.navigationTitle(tr("leave"))
        }
    }
    private func submit() async {
        guard !busy, !uncertain, !store.preview, sessions.contains(where: { $0.id == sessionID }) else { return }
        busy = true; error = nil; status = nil
        let childID = store.selectedChildID
        do {
            let _: ParentIDResponse = try await store.api.post(["action": "leave", "sessionId": sessionID, "participantId": childID, "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines)], path: "learning")
            status = tr("leave_saved")
            reason = ""; sessionID = ""
            await store.loadChild()
        } catch {
            self.error = error.localizedDescription
            if ParentValidation.uncertainWrite((error as? ParentAPIError)?.code) {
                uncertain = true
                await store.loadChild()
            }
        }
        busy = false
    }
}
