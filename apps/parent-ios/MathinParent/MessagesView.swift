import SwiftUI

func notificationTitle(_ type: String) -> String {
    switch type {
    case "session_review_published", "review.insert", "review.update", "learning_result.published": tr("notice_report")
    case "assignment.published", "assignment.submitted", "assignment.graded": tr("notice_practice")
    case "session_reminder", "class_reminder": tr("notice_class")
    case "leave_request.submitted", "leave_request.approved", "leave_request.rejected", "session_change.makeup": tr("notice_leave")
    default: tr("notification_center")
    }
}

struct MessagesView: View {
    @Environment(ParentStore.self) private var store
    @State private var query = ""
    @State private var filter = "all"
    @State private var showFilters = false
    private var rows: [LearningNotification] {
        store.notifications.filter { notice in
            (filter != "unread" || notice.readAt == nil)
            && (filter != "selected_child" || notice.participantId == store.selectedChildID)
            && (query.isEmpty || [notificationTitle(notice.type), notice.studentName ?? "", notice.classroomName ?? "", notice.sessionTitle ?? ""].joined(separator: " ").localizedCaseInsensitiveContains(query))
        }
    }
    var body: some View {
        ParentPage {
            DataStatus()
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(ParentTheme.muted)
                TextField(tr("search_messages"), text: $query).autocorrectionDisabled()
                if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }.accessibilityLabel(tr("clear")) }
            }.padding(13).background(ParentTheme.card, in: RoundedRectangle(cornerRadius: 12))
            HStack(spacing: 4) {
                ChipPicker(keys: ["all", "unread", "selected_child"], selection: $filter)
                Button { showFilters = true } label: { Image(systemName: "line.3.horizontal.decrease").frame(width: 44, height: 44) }
                    .accessibilityLabel(tr("message_groups"))
            }
            if !store.loading, store.error == nil {
                if rows.isEmpty { EmptyState(title: "no_messages", detail: "no_messages_detail", symbol: "bubble.left.and.bubble.right") }
                else {
                    VStack(spacing: 0) {
                        ForEach(rows) { notice in
                            NavigationLink(value: ParentRoute.notification(notice.id)) { MessageRow(notice: notice) }.buttonStyle(.plain)
                        }
                    }.padding(.horizontal, 14).background(ParentTheme.card, in: RoundedRectangle(cornerRadius: 22))
                }
            }
            Text(tr("messages_scope")).font(.caption).foregroundStyle(ParentTheme.muted)
        }
        .navigationTitle(tr("messages")).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                NavigationLink(value: ParentRoute.calls) { Image(systemName: "phone") }.accessibilityLabel(tr("calls"))
                NavigationLink(value: ParentRoute.contacts) { Image(systemName: "person.crop.square") }.accessibilityLabel(tr("contacts"))
            }
        }
        .refreshable { await store.loadAccount() }
        .sheet(isPresented: $showFilters) {
            NavigationStack {
                ParentPage {
                    SectionTitle(key: "by_type")
                    ChipPicker(keys: ["all", "unread"], selection: $filter)
                    SectionTitle(key: "by_child")
                    ChildHeader()
                    ChipPicker(keys: ["all", "selected_child"], selection: $filter)
                }.navigationTitle(tr("message_groups")).navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button(tr("done")) { showFilters = false } } }
            }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        }
    }
}

private struct MessageRow: View {
    let notice: LearningNotification
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            SymbolTile(symbol: notice.type.contains("assignment") ? "pencil.and.list.clipboard" : "bell.fill", color: notice.readAt == nil ? ParentTheme.accent : ParentTheme.sky)
            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .firstTextBaseline) {
                    Text(notificationTitle(notice.type)).font(.subheadline.weight(.semibold))
                    Spacer(minLength: 4)
                    Text(parentDate(notice.occurredAt, template: "Md")).font(.caption2).foregroundStyle(ParentTheme.muted)
                }
                if let name = notice.studentName { ParentBadge(text: name) }
                Text(notice.sessionTitle ?? notice.classroomName ?? tr("notice_open"))
                    .font(.subheadline).foregroundStyle(ParentTheme.muted).lineLimit(2)
            }
            if notice.readAt == nil {
                Circle().fill(ParentTheme.rose).frame(width: 8, height: 8).padding(.top, 8).accessibilityLabel(tr("unread"))
            }
        }.padding(.vertical, 16).contentShape(Rectangle())
    }
}

struct NotificationDetailView: View {
    @Environment(ParentStore.self) private var store
    let id: String
    @State private var error: String?
    private var notice: LearningNotification? { store.notifications.first { $0.id == id } }
    var body: some View {
        ParentPage {
            DataStatus()
            if let notice {
                ParentCard {
                    SymbolTile(symbol: "bell.badge.fill")
                    Text(notificationTitle(notice.type)).font(.title2.bold())
                    Text(parentDate(notice.occurredAt, template: "yyyyMMMdHm")).font(.caption).foregroundStyle(ParentTheme.muted)
                    if let name = notice.studentName { ParentBadge(text: name) }
                    if let title = notice.sessionTitle { Text(title).font(.headline) }
                    if let classroom = notice.classroomName { Text(classroom).foregroundStyle(ParentTheme.muted) }
                    Text(tr("notice_open"))
                    if let error { Text(error).font(.footnote).foregroundStyle(ParentTheme.rose) }
                    if notice.readAt == nil {
                        Button(tr("mark_read")) { Task { await markRead() } }.buttonStyle(PrimaryButton())
                    } else { Label(tr("read"), systemImage: "checkmark.circle").foregroundStyle(ParentTheme.leaf) }
                }
                NavigationLink(value: ParentRoute.reports) { Label(tr("reports"), systemImage: "chart.bar.doc.horizontal") }
                NavigationLink(value: ParentRoute.practices) { Label(tr("practice"), systemImage: "pencil.and.list.clipboard") }
                if !store.preview, let path = notice.link, path.hasPrefix("/"), !path.hasPrefix("//"),
                   let base = store.api.origin, let url = URL(string: path, relativeTo: base)?.absoluteURL, url.host == base.host {
                    Link(destination: url) { Label(tr("open_web"), systemImage: "arrow.up.right.square") }
                }
            } else { EmptyState(title: "not_found") }
        }.navigationTitle(tr("notification_center"))
            .task(id: id) { if notice?.readAt == nil { await markRead() } }
    }
    private func markRead() async {
        do { try await store.readNotification(id); error = nil }
        catch { self.error = error.localizedDescription }
    }
}

struct ContactsView: View {
    @Environment(ParentStore.self) private var store
    private var teachers: [String] { Array(Set(store.courses.compactMap(\.teacherName))).sorted() }
    var body: some View {
        ParentPage {
            ChildHeader()
            DataStatus()
            if teachers.isEmpty { EmptyState(title: "no_contacts", symbol: "person.crop.square") }
            ForEach(teachers, id: \.self) { teacher in
                ParentCard {
                    HStack {
                        SymbolTile(symbol: "person.crop.square.fill", color: ParentTheme.sky)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(teacher).font(.headline)
                            Text(store.courses.filter { $0.teacherName == teacher }.map(\.name).joined(separator: " · "))
                                .font(.caption).foregroundStyle(ParentTheme.muted)
                        }
                    }
                }
            }
            Text(tr("contacts_detail")).font(.footnote).foregroundStyle(ParentTheme.muted)
        }.navigationTitle(tr("contacts"))
    }
}
