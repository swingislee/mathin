import Foundation
import Observation

@MainActor @Observable
final class ParentStore {
    let api = ParentAPI()
    var account: ParentAccount?
    var learning: ParentLearning?
    var practices: [ParentPractice] = []
    var selectedChildID = ""
    var preview = false
    var loading = false
    var error: String?
    var signedIn = false
    private var requestVersion = 0
    var child: ParentParticipant? { account?.participants.first { $0.id == selectedChildID } }
    var children: [ParentParticipant] { account?.participants ?? [] }
    var courses: [LearningCourse] { learning?.courses ?? [] }
    var schedule: [LearningSession] { learning?.schedule ?? [] }
    var notifications: [LearningNotification] { learning?.notifications ?? [] }
    var reports: [ParentReport] { ParentFilter.reports(learning?.reports ?? [], participantID: selectedChildID) }
    var tasks: [ParentPractice] { ParentFilter.practices(practices, participantID: selectedChildID, state: "all") }
    var unread: Int { notifications.filter { $0.readAt == nil }.count }
    var pending: Int { tasks.filter { $0.submittedAt == nil }.count }

    func restore() async {
        guard api.hasSession else { return }
        signedIn = true
        await loadAccount()
    }
    func login(identifier: String, password: String) async throws {
        try await api.login(identifier: identifier, password: password)
        preview = false
        signedIn = true
        await loadAccount()
    }
    func startPreview() {
        requestVersion += 1
        preview = true
        signedIn = true
        account = PreviewCatalog.account
        selectedChildID = children.first?.id ?? ""
        learning = PreviewCatalog.learning(childID: selectedChildID)
        practices = PreviewCatalog.practices(childID: selectedChildID)
        error = nil
        loading = false
    }
    func loadAccount() async {
        if preview { return }
        requestVersion += 1
        let version = requestVersion
        loading = true
        error = nil
        do {
            let account: ParentAccount = try await api.get("account")
            guard requestVersion == version else { return }
            self.account = account
            if !account.participants.contains(where: { $0.id == selectedChildID }) { selectedChildID = account.participants.first?.id ?? "" }
            await loadChild()
        } catch {
            guard requestVersion == version else { return }
            handle(error)
            loading = false
        }
    }
    func selectChild(_ id: String) async {
        guard children.contains(where: { $0.id == id }), id != selectedChildID else { return }
        selectedChildID = id
        await loadChild()
    }
    func loadChild(from: Date? = nil, to: Date? = nil) async {
        requestVersion += 1
        let version = requestVersion
        let childID = selectedChildID
        learning = nil
        practices = []
        error = nil
        guard !childID.isEmpty else { loading = false; return }
        if preview {
            learning = PreviewCatalog.learning(childID: childID)
            practices = PreviewCatalog.practices(childID: childID)
            loading = false
            return
        }
        loading = true
        do {
            async let overview: ParentLearning = api.learning(participantID: childID, from: from, to: to)
            async let assignments: [ParentPractice] = api.get("practices")
            let (overviewValue, assignmentValue) = try await (overview, assignments)
            guard requestVersion == version, selectedChildID == childID else { return }
            guard overviewValue.participantId == childID else { throw ParentAPIError(code: "INVALID_RESPONSE") }
            learning = overviewValue
            practices = assignmentValue.filter { $0.participantId == childID }
        } catch {
            guard requestVersion == version else { return }
            handle(error)
        }
        if requestVersion == version { loading = false }
    }
    func readNotification(_ id: String) async throws {
        let version = requestVersion
        if !preview {
            let _: ParentOKResponse = try await api.post(["action": "readNotification", "id": id], path: "learning")
        }
        guard requestVersion == version, let index = learning?.notifications.firstIndex(where: { $0.id == id }) else { return }
        learning?.notifications[index].readAt = ParentDate.iso(Date())
    }
    func logout() async {
        requestVersion += 1
        let wasPreview = preview
        account = nil; learning = nil; practices = []; selectedChildID = ""; error = nil; loading = false
        signedIn = false; preview = false
        if !wasPreview { await api.logout() }
    }
    private func handle(_ failure: Error) {
        error = failure.localizedDescription
        if let code = (failure as? ParentAPIError)?.code, code == "UNAUTHENTICATED" || code == "ACCOUNT_SECURITY" {
            api.clearSession()
            signedIn = false
            account = nil; learning = nil; practices = []
        }
    }
}
