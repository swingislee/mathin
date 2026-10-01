import SwiftUI

enum ParentRoute: Hashable {
    case notification(String), contacts, calls, courses, course(String), lesson(LearningSession), schedule, reports, report(String)
    case assessments, levels, practices, practice(String), mistakes, reading, checkins
    case children, settings, service(String), feedback, mailbox, address, invite, support, growth
}

struct ParentRootView: View {
    @State private var store = ParentStore()
    @State private var selectedTab = 1
    var body: some View {
        Group {
            if store.signedIn {
                TabView(selection: $selectedTab) {
                    tab("messages", symbol: "bubble.left.and.bubble.right", tag: 0) { MessagesView() }.badge(store.unread)
                    tab("courses", symbol: "book.closed", tag: 1) { CoursesHomeView() }
                    tab("tasks", symbol: "checklist", tag: 2) { TasksHomeView() }.badge(store.pending)
                    tab("parent", symbol: "person.crop.circle", tag: 3) { ParentAccountView() }
                }
            } else { ParentLoginView() }
        }.environment(store).tint(ParentTheme.accent)
            .task { await store.restore() }
    }
    private func tab<Content: View>(_ key: String, symbol: String, tag: Int, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack {
            content()
                .navigationDestination(for: ParentRoute.self) { route in ParentDestination(route: route) }
                .toolbarBackground(ParentTheme.paper, for: .navigationBar)
                .toolbarBackground(ParentTheme.card, for: .tabBar)
                .toolbarBackground(.visible, for: .tabBar)
        }
        // 清空切换前的详情及填写状态，防止把另一个孩子的草稿留在导航栈。
        .id("\(tag)-\(store.selectedChildID)-\(store.preview)")
        .tabItem { Label(tr(key), systemImage: symbol) }.tag(tag)
    }
}

struct ParentDestination: View {
    let route: ParentRoute
    var body: some View {
        Group {
            switch route {
            case .notification(let id): NotificationDetailView(id: id)
            case .contacts: ContactsView()
            case .calls: ServiceAvailabilityView(kind: "calls")
            case .courses: CourseListView()
            case .course(let id): CourseDetailView(id: id)
            case .lesson(let lesson): LessonDetailView(lesson: lesson)
            case .schedule: ScheduleView()
            case .reports: ReportsView(assessmentsOnly: false)
            case .report(let id): ReportDetailView(id: id)
            case .assessments: ReportsView(assessmentsOnly: true)
            case .levels: ServiceAvailabilityView(kind: "levels")
            case .practices: PracticeListView()
            case .practice(let id): PracticeDetailView(id: id)
            case .mistakes: ServiceAvailabilityView(kind: "mistakes")
            case .reading: ServiceAvailabilityView(kind: "reading")
            case .checkins: ServiceAvailabilityView(kind: "checkins")
            case .children: ChildrenView()
            case .settings: ParentSettingsView()
            case .service(let kind): CourseServiceView(kind: kind)
            case .feedback: ServiceAvailabilityView(kind: "feedback")
            case .mailbox: ServiceAvailabilityView(kind: "mailbox")
            case .address: ServiceAvailabilityView(kind: "address")
            case .invite: ServiceAvailabilityView(kind: "invite")
            case .support: ContactsView()
            case .growth: GrowthView()
            }
        }.navigationBarTitleDisplayMode(.inline)
    }
}

struct ParentLoginView: View {
    @Environment(ParentStore.self) private var store
    @State private var identifier = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            ParentPage {
                VStack(alignment: .leading, spacing: 18) {
                    Image(systemName: "sparkles").font(.system(size: 44)).foregroundStyle(ParentTheme.accent).accessibilityHidden(true)
                    Text("Mathin").font(.system(size: 42, weight: .bold, design: .rounded))
                    Text(tr("login_title")).font(.title2.bold())
                    Text(tr("login_detail")).foregroundStyle(ParentTheme.muted)
                }.padding(.vertical, 32)
                ParentCard {
                    TextField(tr("identifier"), text: $identifier).textContentType(.username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.emailAddress)
                        .padding(14).background(ParentTheme.paper, in: RoundedRectangle(cornerRadius: 12))
                    SecureField(tr("password"), text: $password).textContentType(.password)
                        .padding(14).background(ParentTheme.paper, in: RoundedRectangle(cornerRadius: 12))
                    if let error = error ?? store.error { Text(error).font(.subheadline).foregroundStyle(ParentTheme.rose) }
                    Button {
                        busy = true; error = nil
                        Task {
                            do { try await store.login(identifier: identifier, password: password); password = "" }
                            catch { self.error = error.localizedDescription }
                            busy = false
                        }
                    } label: { if busy { ProgressView().tint(.white) } else { Text(tr("login")) } }
                        .buttonStyle(PrimaryButton()).disabled(busy || identifier.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty || store.api.origin == nil)
                    if store.api.origin == nil { Text(tr("configuration_detail")).font(.footnote).foregroundStyle(ParentTheme.muted) }
                }
                Button(tr("preview_action")) { store.startPreview() }.frame(maxWidth: .infinity, minHeight: 44)
                Text(tr("preview_detail")).font(.caption).foregroundStyle(ParentTheme.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity)
            }.navigationTitle(tr("parent_app")).navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct ChildHeader: View {
    @Environment(ParentStore.self) private var store
    @State private var choosing = false
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "sun.max.fill").font(.title2).foregroundStyle(ParentTheme.moon)
                .frame(width: 52, height: 52).background(ParentTheme.card, in: Circle()).accessibilityHidden(true)
            Button { choosing = true } label: {
                VStack(alignment: .leading, spacing: 5) {
                    HStack { Text(store.child?.name ?? tr("no_child")).font(.title3.bold()); Image(systemName: "chevron.down").font(.caption) }
                    Text(store.learning?.summary?.grade.map { tr("grade") + " \($0)" } ?? tr("family_learning"))
                        .font(.caption).foregroundStyle(ParentTheme.muted)
                }
            }.foregroundStyle(ParentTheme.ink).disabled(store.children.isEmpty)
                .accessibilityLabel(tr("switch_child") + " " + (store.child?.name ?? ""))
            Spacer()
            NavigationLink(value: ParentRoute.schedule) {
                Label(tr("schedule"), systemImage: "calendar").font(.caption.weight(.semibold))
                    .padding(10).background(ParentTheme.card, in: Capsule())
            }
        }.padding(.vertical, 8)
            .sheet(isPresented: $choosing) { ChildPicker().presentationDetents([.medium]).presentationDragIndicator(.visible) }
    }
}

struct ChildPicker: View {
    @Environment(ParentStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ParentPage {
                Text(tr("child_switch_detail")).font(.subheadline).foregroundStyle(ParentTheme.muted)
                ForEach(store.children) { child in
                    Button {
                        dismiss()
                        Task { await store.selectChild(child.id) }
                    } label: {
                        ParentCard {
                            HStack {
                                SymbolTile(symbol: "person.crop.circle")
                                Text(child.name).font(.headline)
                                Spacer()
                                if child.id == store.selectedChildID { Image(systemName: "checkmark.circle.fill").foregroundStyle(ParentTheme.accent) }
                            }
                        }
                    }.buttonStyle(.plain)
                }
            }.navigationTitle(tr("switch_child")).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(tr("done")) { dismiss() } } }
        }
    }
}

struct DataStatus: View {
    @Environment(ParentStore.self) private var store
    var body: some View {
        if store.preview {
            Label(tr("demo_label"), systemImage: "sparkle").font(.caption).foregroundStyle(ParentTheme.accent)
        }
        if store.loading { ProgressView(tr("loading")).frame(maxWidth: .infinity).padding() }
        if let error = store.error {
            ParentCard {
                Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(ParentTheme.rose)
                Button(tr("retry")) { Task { await store.loadAccount() } }
            }
        }
        if !store.loading, store.error == nil, store.children.isEmpty {
            EmptyState(title: "no_child", detail: "no_child_detail", symbol: "person.crop.circle.badge.plus")
        }
    }
}

#Preview { ParentRootView() }
