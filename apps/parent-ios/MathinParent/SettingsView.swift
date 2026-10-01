import SwiftUI
import PhotosUI
import UIKit
import ImageIO

struct ParentSettingsView: View {
    @Environment(ParentStore.self) private var store
    @AppStorage("parent.messageBadges") private var messageBadges = true
    @State private var confirmLogout = false
    @State private var confirmCache = false
    @State private var cacheCleared = false
    @State private var cacheBytes = URLCache.shared.currentMemoryUsage + URLCache.shared.currentDiskUsage

    var body: some View {
        List {
            Section {
                NavigationLink(value: ParentRoute.accountSecurity) {
                    SettingsRow(title: "account_security", value: store.account?.displayName)
                }
                Toggle(isOn: $messageBadges) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(tr("notifications_settings"))
                        Text(tr("message_badges_detail")).font(.caption).foregroundStyle(ParentTheme.muted)
                    }
                }.tint(ParentTheme.accent)
            }
            Section {
                NavigationLink(value: ParentRoute.permissions) { Text(tr("permissions_settings")) }
                Button { confirmCache = true } label: {
                    SettingsRow(title: "clear_cache", value: ByteCountFormatter.string(fromByteCount: Int64(cacheBytes), countStyle: .file))
                }.foregroundStyle(ParentTheme.ink)
            }
            Section {
                NavigationLink(value: ParentRoute.about) {
                    SettingsRow(title: "about", value: tr("current_version") + " " + ParentAppInfo.version)
                }
                NavigationLink(value: ParentRoute.feedback) { Text(tr("app_feedback")) }
                NavigationLink(value: ParentRoute.privacy) { Text(tr("privacy_related")) }
            }
            Section {
                Button(tr(store.preview ? "exit_preview" : "logout")) { confirmLogout = true }
                    .frame(maxWidth: .infinity).foregroundStyle(ParentTheme.ink)
            }
        }.listStyle(.insetGrouped).scrollContentBackground(.hidden)
            .background(ParentTheme.paper).navigationTitle(tr("settings"))
            .confirmationDialog(tr(store.preview ? "exit_preview" : "logout"), isPresented: $confirmLogout, titleVisibility: .visible) {
                Button(tr("confirm"), role: .destructive) { Task { await store.logout() } }
                Button(tr("cancel"), role: .cancel) { }
            } message: { Text(tr("logout_detail")) }
            .confirmationDialog(tr("clear_cache"), isPresented: $confirmCache, titleVisibility: .visible) {
                Button(tr("confirm")) {
                    URLCache.shared.removeAllCachedResponses()
                    cacheBytes = URLCache.shared.currentMemoryUsage + URLCache.shared.currentDiskUsage
                    cacheCleared = true
                }
                Button(tr("cancel"), role: .cancel) { }
            } message: { Text(tr("clear_cache_detail")) }
            .alert(tr("cache_cleared"), isPresented: $cacheCleared) { Button(tr("done"), role: .cancel) { } }
    }
}

private struct SettingsRow: View {
    let title: String
    var value: String?
    var body: some View {
        HStack(spacing: 14) {
            Text(tr(title))
            Spacer(minLength: 8)
            if let value { Text(value).font(.subheadline).foregroundStyle(ParentTheme.muted).multilineTextAlignment(.trailing) }
        }.padding(.vertical, 6)
    }
}

enum ParentAppInfo {
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—" }
    static var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—" }
}

struct ParentAccountSecurityView: View {
    @Environment(ParentStore.self) private var store
    var body: some View {
        List {
            Section {
                SettingsRow(title: "current_account", value: store.account?.displayName ?? tr("parent"))
                NavigationLink(value: ParentRoute.web("account_security", "dashboard/account-security")) { Text(tr("manage_account_security")) }
                NavigationLink(value: ParentRoute.web("third_party_accounts", "dashboard/account-security?section=identities")) { Text(tr("third_party_accounts")) }
            } footer: { Text(tr("account_web_detail")) }
        }.listStyle(.insetGrouped).scrollContentBackground(.hidden).background(ParentTheme.paper)
            .navigationTitle(tr("account_security"))
    }
}

struct ParentPermissionsView: View {
    @Environment(\.openURL) private var openURL
    var body: some View {
        List {
            Section {
                permission("photo_permission", detail: "photo_permission_detail", symbol: "photo")
                permission("local_network", detail: "local_network_detail", symbol: "network")
                permission("notifications_settings", detail: "notification_permission_detail", symbol: "bell")
            }
            Section {
                Button(tr("open_system_settings")) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
            }
        }.listStyle(.insetGrouped).scrollContentBackground(.hidden).background(ParentTheme.paper)
            .navigationTitle(tr("permissions_settings"))
    }
    private func permission(_ title: String, detail: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(tr(title), systemImage: symbol)
            Text(tr(detail)).font(.footnote).foregroundStyle(ParentTheme.muted)
        }.padding(.vertical, 8)
    }
}

struct ParentAboutView: View {
    var body: some View {
        ParentPage {
            VStack(spacing: 16) {
                Image(systemName: "sparkles").font(.system(size: 50)).foregroundStyle(ParentTheme.accent)
                Text("Mathin").font(.largeTitle.bold())
                Text(tr("family_companion")).foregroundStyle(ParentTheme.muted)
                Text(tr("current_version") + " " + ParentAppInfo.version + " (" + ParentAppInfo.build + ")").font(.footnote)
            }.frame(maxWidth: .infinity).padding(.vertical, 40)
            ParentCard {
                Text(tr("about_detail")).font(.subheadline)
                NavigationLink(value: ParentRoute.privacy) { Label(tr("privacy_related"), systemImage: "hand.raised") }
                NavigationLink(value: ParentRoute.feedback) { Label(tr("app_feedback"), systemImage: "bubble.left") }
            }
        }.navigationTitle(tr("about"))
    }
}

struct ParentPrivacyView: View {
    var body: some View {
        List {
            Section {
                NavigationLink(value: ParentRoute.web("privacy_policy", "privacy")) { Text(tr("privacy_policy")) }
                NavigationLink(value: ParentRoute.web("children_privacy", "children-privacy")) { Text(tr("children_privacy")) }
                NavigationLink(value: ParentRoute.thirdPartyServices) { Text(tr("third_party_services")) }
                NavigationLink(value: ParentRoute.permissions) { Text(tr("permissions_settings")) }
            } footer: { Text(tr("privacy_detail")) }
        }.listStyle(.insetGrouped).scrollContentBackground(.hidden).background(ParentTheme.paper)
            .navigationTitle(tr("privacy_related"))
    }
}

struct ParentThirdPartyServicesView: View {
    var body: some View {
        ParentPage {
            ParentCard {
                Text(tr("system_services")).font(.headline)
                Text(tr("system_services_detail")).font(.subheadline).foregroundStyle(ParentTheme.muted)
            }
            ParentCard {
                Text(tr("account_data_service")).font(.headline)
                Text(tr("account_data_service_detail")).font(.subheadline).foregroundStyle(ParentTheme.muted)
            }
            NavigationLink(value: ParentRoute.web("privacy_policy", "privacy")) { Text(tr("privacy_policy")) }
        }.navigationTitle(tr("third_party_services"))
    }
}

struct ParentWebPageView: View {
    @Environment(ParentStore.self) private var store
    let title: String
    let path: String
    private var isAccount: Bool { path.hasPrefix("dashboard/") }
    private var destination: URL? {
        guard let origin = store.api.origin else { return nil }
        let language = Locale.preferredLanguages.first?.hasPrefix("zh") == true ? "zh" : "en"
        return URL(string: language + "/" + path, relativeTo: origin.appendingPathComponent("/"))?.absoluteURL
    }
    var body: some View {
        ParentPage {
            ParentCard {
                Label(tr(title), systemImage: isAccount ? "person.crop.circle.badge.checkmark" : "hand.raised").font(.headline)
                Text(tr(isAccount ? "account_web_detail" : "privacy_web_detail")).font(.subheadline).foregroundStyle(ParentTheme.muted)
                if store.preview && isAccount { Text(tr("preview_no_write")).font(.footnote).foregroundStyle(ParentTheme.muted) }
                if let destination {
                    Link(tr("open_web_page"), destination: destination).buttonStyle(PrimaryButton()).disabled(store.preview && isAccount)
                } else { Text(tr("error_config_required")).font(.footnote).foregroundStyle(ParentTheme.muted) }
            }
        }.navigationTitle(tr(title))
    }
}

struct ParentFeedbackView: View {
    var body: some View {
        ParentPage {
            EmptyState(title: "feedback_history", detail: "feedback_channel_detail", symbol: "text.bubble")
            NavigationLink(value: ParentRoute.feedbackCompose) { Label(tr("compose_feedback"), systemImage: "plus") }.buttonStyle(PrimaryButton())
            NavigationLink(value: ParentRoute.contacts) { Label(tr("find_teacher"), systemImage: "person.crop.square") }
        }.navigationTitle(tr("app_feedback"))
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: ParentRoute.feedbackCompose) { Image(systemName: "plus") }.accessibilityLabel(tr("compose_feedback"))
            } }
    }
}

struct ParentFeedbackComposeView: View {
    @State private var category = "feedback_problem"
    @State private var draft = ""
    @State private var selection: [PhotosPickerItem] = []
    @State private var photos: [UIImage] = []
    @State private var loadingPhotos = false
    @State private var photoError = false
    @State private var sharing = false
    private var length: Int { ParentValidation.textLength(draft) }

    var body: some View {
        ParentPage {
            Picker(tr("feedback_category"), selection: $category) {
                Text(tr("feedback_problem")).tag("feedback_problem")
                Text(tr("feedback_suggestion")).tag("feedback_suggestion")
            }.pickerStyle(.segmented)
            ParentCard {
                Text(tr("feedback_prompt")).font(.subheadline).foregroundStyle(ParentTheme.muted)
                TextEditor(text: $draft).frame(minHeight: 200).scrollContentBackground(.hidden).accessibilityLabel(tr("feedback_prompt"))
                Text("\(length)/1000").font(.caption).foregroundStyle(length > 1000 ? ParentTheme.rose : ParentTheme.muted).frame(maxWidth: .infinity, alignment: .trailing)
                PhotosPicker(selection: $selection, maxSelectionCount: 3, matching: .images) {
                    Label(tr("feedback_photos"), systemImage: "photo.badge.plus")
                }.disabled(loadingPhotos)
                if loadingPhotos { ProgressView() }
                if photoError { Text(tr("feedback_photo_error")).font(.footnote).foregroundStyle(ParentTheme.rose) }
                HStack {
                    ForEach(Array(photos.enumerated()), id: \.offset) { _, photo in
                        Image(uiImage: photo).resizable().scaledToFill().frame(width: 72, height: 72).clipped().clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
            Text(tr("feedback_share_detail")).font(.footnote).foregroundStyle(ParentTheme.muted)
            Button(tr("share_feedback")) { sharing = true }.buttonStyle(PrimaryButton())
                .disabled(length == 0 || length > 1000 || loadingPhotos)
        }.navigationTitle(tr("compose_feedback"))
            .task(id: selection) { await loadPhotos() }
            .sheet(isPresented: $sharing) {
                ParentFeedbackShare(items: [tr(category) + "\n\n" + draft.trimmingCharacters(in: .whitespacesAndNewlines)] + photos.map { $0 as Any })
            }
    }
    @MainActor private func loadPhotos() async {
        loadingPhotos = true
        var loaded: [UIImage] = []
        var failed = false
        for item in selection {
            if let data = try? await item.loadTransferable(type: Data.self), data.count <= 12 * 1024 * 1024,
               let source = CGImageSourceCreateWithData(data as CFData, nil),
               let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1600
               ] as CFDictionary) { loaded.append(UIImage(cgImage: image)) }
            else { failed = true }
            if Task.isCancelled { return }
        }
        photos = loaded
        photoError = failed
        loadingPhotos = false
    }
}

private struct ParentFeedbackShare: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) { }
}

struct ParentMailboxView: View {
    var body: some View {
        ParentPage {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: "envelope.open.fill").font(.system(size: 42)).foregroundStyle(ParentTheme.accent)
                Text(tr("mailbox")).font(.largeTitle.bold())
                Text(tr("mailbox_subtitle")).font(.headline).foregroundStyle(ParentTheme.muted)
            }.padding(.vertical, 24)
            ParentCard {
                EmptyState(title: "mailbox_ready", detail: "mailbox_channel_detail", symbol: "tray")
                NavigationLink(value: ParentRoute.contacts) { Label(tr("find_teacher"), systemImage: "person.crop.square") }.buttonStyle(PrimaryButton())
            }
        }.navigationTitle(tr("mailbox"))
    }
}
