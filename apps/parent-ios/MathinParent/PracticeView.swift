import SwiftUI
import PhotosUI
import ImageIO

struct TasksHomeView: View {
    @Environment(ParentStore.self) private var store
    @State private var filter = "pending"
    var body: some View {
        ParentPage {
            ChildHeader()
            DataStatus()
            ParentCard {
                HStack(alignment: .top, spacing: 8) {
                    Shortcut(title: "practice", symbol: "pencil.and.list.clipboard", route: .practices, color: ParentTheme.sky)
                    Shortcut(title: "mistakes", symbol: "book.closed.fill", route: .mistakes, color: ParentTheme.rose)
                    Shortcut(title: "reading", symbol: "waveform.circle.fill", route: .reading)
                    Shortcut(title: "checkins", symbol: "flag.fill", route: .checkins, color: ParentTheme.leaf)
                }
            }
            HStack { SectionTitle(key: "my_tasks"); Spacer(); Text("\(store.pending) " + tr("tasks_pending")).font(.caption).foregroundStyle(ParentTheme.muted) }
            ChipPicker(keys: ["pending", "submitted", "all"], selection: $filter)
            PracticeRows(filter: filter, search: "")
            Text(tr("practice_encouragement")).font(.caption).foregroundStyle(ParentTheme.muted).frame(maxWidth: .infinity)
        }.navigationTitle(tr("tasks")).navigationBarTitleDisplayMode(.inline)
            .refreshable { await store.loadChild() }
    }
}

struct PracticeListView: View {
    @State private var filter = "all"
    @State private var search = ""
    var body: some View {
        ParentPage {
            ChildHeader()
            DataStatus()
            ChipPicker(keys: ["all", "pending", "submitted"], selection: $filter)
            PracticeRows(filter: filter, search: search)
        }.navigationTitle(tr("practice")).searchable(text: $search, prompt: tr("search_practice"))
    }
}

private struct PracticeRows: View {
    @Environment(ParentStore.self) private var store
    let filter: String
    let search: String
    private var rows: [ParentPractice] {
        ParentFilter.practices(store.practices, participantID: store.selectedChildID, state: filter)
            .filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }
    }
    var body: some View {
        ForEach(rows, id: \.identity) { practice in
            NavigationLink(value: ParentRoute.practice(practice.id)) {
                ParentCard {
                    HStack(alignment: .top, spacing: 12) {
                        SymbolTile(symbol: practice.submittedAt == nil ? "pencil.and.list.clipboard" : "checkmark.seal.fill", color: practice.submittedAt == nil ? ParentTheme.accent : ParentTheme.leaf)
                        VStack(alignment: .leading, spacing: 9) {
                            Text(practice.title).font(.headline)
                            if let due = practice.dueAt { Text(tr("due") + " " + parentDate(due)).font(.caption).foregroundStyle(ParentTheme.muted) }
                            Text(practice.instructions).font(.caption).foregroundStyle(ParentTheme.muted).lineLimit(2)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(ParentTheme.muted)
                    }
                    HStack {
                        ParentBadge(text: tr(practice.submittedAt == nil ? "pending" : "submitted"), color: practice.submittedAt == nil ? ParentTheme.accent : ParentTheme.leaf)
                        Spacer()
                        Text(tr(practice.submittedAt == nil ? "go_practice" : "view_submission")).font(.caption.bold()).foregroundStyle(ParentTheme.accent)
                    }
                }
            }.buttonStyle(.plain)
        }
        if rows.isEmpty, !store.loading, store.error == nil { EmptyState(title: "no_practices", detail: "no_practices_detail", symbol: "checklist") }
    }
}

private struct PracticePhoto: Identifiable {
    let id = UUID()
    let data: Data
    var uploaded: ParentMedia?
}

struct PracticeDetailView: View {
    @Environment(ParentStore.self) private var store
    let id: String
    @State private var note = ""
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var photos: [PracticePhoto] = []
    @State private var saved: ParentSubmission?
    @State private var editing = true
    @State private var loading = true
    @State private var busy = false
    @State private var importing = false
    @State private var uploadProgress = 0
    @State private var submissionID = UUID().uuidString
    @State private var error: String?
    @State private var success = false
    @State private var viewingMedia: MediaPreviewItem?
    private var practice: ParentPractice? { store.tasks.first { $0.id == id } }

    var body: some View {
        ParentPage {
            DataStatus()
            if let practice {
                ParentCard {
                    HStack { ParentBadge(text: tr("practice"), color: ParentTheme.leaf); Spacer(); Text(practice.participantName).font(.caption).foregroundStyle(ParentTheme.muted) }
                    Text(practice.title).font(.title2.bold())
                    if let due = practice.dueAt { Label(tr("due") + " " + parentDate(due, template: "MMMdHm"), systemImage: "clock").font(.caption).foregroundStyle(ParentTheme.muted) }
                    Text(practice.instructions.isEmpty ? tr("instructions_pending") : practice.instructions).lineSpacing(6).textSelection(.enabled)
                    ShareLink(item: practice.title + "\n\n" + practice.instructions) { Label(tr("share_print"), systemImage: "square.and.arrow.up") }.font(.subheadline)
                }
                if loading { ProgressView(tr("loading")).frame(maxWidth: .infinity) }
                if let error { Label(error, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(ParentTheme.rose) }
                if success { Label(tr("practice_saved"), systemImage: "checkmark.circle.fill").foregroundStyle(ParentTheme.leaf) }
                if let saved, !editing {
                    ParentCard {
                        SectionTitle(key: "my_submission")
                        Text(parentDate(saved.submittedAt, template: "yyyyMMMdHm")).font(.caption).foregroundStyle(ParentTheme.muted)
                        if !saved.note.isEmpty { Text(saved.note) }
                        ForEach(saved.media) { media in
                            Button { Task { await showMedia(media) } } label: {
                                HStack { Image(systemName: media.kind == "video" ? "play.rectangle" : "photo"); Text(media.name).lineLimit(1); Spacer(); Image(systemName: "arrow.up.right") }
                                    .padding(12).background(ParentTheme.paper, in: RoundedRectangle(cornerRadius: 12))
                            }
                        }
                        Button(tr("submit_again")) { editing = true; submissionID = UUID().uuidString; success = false; note = ""; photos = [] }
                    }
                }
                if editing {
                    ParentCard {
                        SectionTitle(key: "my_answer")
                        Text(tr("practice_photo_detail")).font(.footnote).foregroundStyle(ParentTheme.muted)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 84))], spacing: 12) {
                            ForEach(photos) { photo in
                                ZStack(alignment: .topTrailing) {
                                    if let uiImage = UIImage(data: photo.data) {
                                        Image(uiImage: uiImage).resizable().scaledToFill().frame(width: 84, height: 100).clipped()
                                            .clipShape(RoundedRectangle(cornerRadius: 12))
                                    }
                                    Button {
                                        photos.removeAll { $0.id == photo.id }; submissionID = UUID().uuidString
                                    } label: { Image(systemName: "xmark.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.white, ParentTheme.ink).frame(width: 44, height: 44) }
                                        .disabled(busy).accessibilityLabel(tr("remove_photo"))
                                }
                            }
                            if photos.count < 9 {
                                PhotosPicker(selection: $selectedPhotos, maxSelectionCount: 9 - photos.count, matching: .images) {
                                    VStack(spacing: 8) { Image(systemName: "camera").font(.title2); Text(tr("add_photo")).font(.caption) }
                                        .frame(width: 84, height: 100).background(ParentTheme.lavender, in: RoundedRectangle(cornerRadius: 12))
                                }.disabled(busy || importing)
                            }
                        }
                        if importing { ProgressView(tr("importing")) }
                        TextEditor(text: $note).frame(minHeight: 100).padding(8).scrollContentBackground(.hidden)
                            .background(ParentTheme.paper, in: RoundedRectangle(cornerRadius: 12)).accessibilityLabel(tr("answer_note"))
                            .disabled(busy).onChange(of: note) { _, _ in submissionID = UUID().uuidString }
                        Text(tr("answer_note") + " · \(ParentValidation.textLength(note))/2000").font(.caption).foregroundStyle(ParentValidation.textLength(note) > 2000 ? ParentTheme.rose : ParentTheme.muted)
                    }
                    if busy { ProgressView(value: Double(uploadProgress), total: Double(max(photos.count, 1))).tint(ParentTheme.accent) }
                    Button { Task { await submit(practice) } } label: {
                        if busy { ProgressView().tint(.white) } else { Text(tr("submit_practice")) }
                    }.buttonStyle(PrimaryButton()).disabled(busy || loading || importing || photos.isEmpty || ParentValidation.textLength(note) > 2000 || store.preview)
                    if store.preview { Text(tr("preview_no_write")).font(.caption).foregroundStyle(ParentTheme.muted) }
                }
            } else if !store.loading { EmptyState(title: "not_found") }
        }.navigationTitle(tr("practice_detail"))
            .task(id: id) { await load() }
            .onChange(of: selectedPhotos) { _, picks in if !picks.isEmpty { Task { await importPhotos(picks) } } }
            .sheet(item: $viewingMedia) { item in MediaPreview(item: item) }
    }

    private func load() async {
        guard let practice else { loading = false; return }
        loading = true
        do {
            if store.preview {
                saved = practice.submittedAt.map { ParentSubmission(id: "preview-submission", submittedAt: $0, note: PreviewCatalog.copy("规律是每次加 3，下三个数是 14、17、20。", "Add 3 each time. The next numbers are 14, 17 and 20."), media: []) }
            } else {
                saved = try await store.api.get("submission", query: [URLQueryItem(name: "id", value: id), URLQueryItem(name: "participant", value: practice.participantId)])
            }
            editing = saved == nil
            error = nil
        } catch { self.error = error.localizedDescription }
        loading = false
    }

    private func importPhotos(_ picks: [PhotosPickerItem]) async {
        importing = true
        error = nil
        for pick in picks.prefix(max(9 - photos.count, 0)) {
            do {
                guard let data = try await pick.loadTransferable(type: Data.self), data.count <= 40 * 1024 * 1024,
                      let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: 2048
                      ] as CFDictionary), let jpeg = UIImage(cgImage: thumbnail).jpegData(compressionQuality: 0.85), jpeg.count <= 12 * 1024 * 1024
                else { throw ParentAPIError(code: "FILE_TYPE") }
                photos.append(PracticePhoto(data: jpeg))
                submissionID = UUID().uuidString
            } catch { self.error = error.localizedDescription }
        }
        selectedPhotos = []
        importing = false
    }

    private func submit(_ practice: ParentPractice) async {
        guard !busy, !store.preview, !photos.isEmpty, photos.count <= 9, ParentValidation.textLength(note) <= 2000 else { return }
        busy = true; error = nil; uploadProgress = 0
        do {
            for index in photos.indices {
                if photos[index].uploaded == nil {
                    photos[index].uploaded = try await store.api.upload(photos[index].data, assignmentID: practice.id, participantID: practice.participantId)
                }
                uploadProgress += 1
            }
            let body = SubmitPractice(id: submissionID, assignmentId: practice.id, participantId: practice.participantId,
                                      note: note.trimmingCharacters(in: .whitespacesAndNewlines), uploadIds: photos.compactMap { $0.uploaded?.id })
            let _: ParentIDResponse = try await store.api.post(body)
            success = true
            photos = []
            await load()
            await store.loadChild()
        } catch { self.error = error.localizedDescription }
        busy = false
    }

    private func showMedia(_ media: ParentMedia) async {
        do { viewingMedia = MediaPreviewItem(url: try await store.api.mediaURL(id: media.id), kind: media.kind) }
        catch { self.error = error.localizedDescription }
    }
}

private struct MediaPreviewItem: Identifiable { let id = UUID(); let url: URL; let kind: String }
private struct MediaPreview: View {
    let item: MediaPreviewItem
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Group {
                if item.kind == "image" {
                    AsyncImage(url: item.url) { phase in
                        switch phase {
                        case .success(let image): image.resizable().scaledToFit()
                        case .failure: Text(tr("media_failed"))
                        default: ProgressView()
                        }
                    }
                } else { Link(tr("open_video"), destination: item.url) }
            }.frame(maxWidth: .infinity, maxHeight: .infinity).background(ParentTheme.paper)
                .navigationTitle(tr("my_submission")).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(tr("done")) { dismiss() } } }
        }
    }
}
