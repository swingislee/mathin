import Foundation

struct ParentParticipant: Codable, Identifiable, Hashable { let id: String; let name: String }
struct ParentAccount: Codable { let id: String; let displayName: String; let participants: [ParentParticipant] }
struct ParentPractice: Codable, Identifiable, Hashable {
    let id: String
    let participantId: String
    let participantName: String
    let title: String
    let instructions: String
    let dueAt: String?
    var submittedAt: String?
    // 同一作业可分配给多个孩子，列表及草稿使用复合身份。
    var identity: String { participantId + ":" + id }
}
struct ParentMedia: Codable, Identifiable { let id: String; let kind: String; let name: String; let bytes: Int; let url: String? }
struct ParentSubmission: Codable { let id: String; let submittedAt: String; let note: String; let media: [ParentMedia] }
struct ParentReport: Codable, Identifiable, Hashable {
    let id: String
    let participantId: String?
    let kind: String
    let title: String
    let participantName: String
    let date: String
    let summary: String
    let strengths: String
    let focusAreas: String
    let recommendation: String
    let score: Double?
    let totalScore: Double?
}
struct ParentLearning: Codable {
    let participantId: String
    let generatedAt: String
    let range: LearningRange
    let summary: LearningSummary?
    let courses: [LearningCourse]
    let schedule: [LearningSession]
    let attendance: [LearningAttendance]
    var notifications: [LearningNotification]
    let leaveRequests: [LearningLeaveRequest]
    let reports: [ParentReport]
    let unassignedReportCount: Int
    let capabilities: LearningCapabilities
}
struct LearningRange: Codable { let from: String; let to: String }
struct LearningSummary: Codable { let grade: Int?; let nextSessionAt: String?; let weekSessionCount: Int; let starTotal: Int }
struct LearningCourse: Codable, Identifiable, Hashable {
    let id: String; let name: String; let teacherName: String?; let nextSessionAt: String?; let sessionCount: Int
}
struct LearningSession: Codable, Identifiable, Hashable {
    let id: String; let participantId: String; let classroomId: String; let classroomName: String
    let title: String; let startsAt: String; let durationMinutes: Int?; let teacherName: String?
}
struct LearningAttendance: Codable, Identifiable {
    let sessionId: String; let participantId: String; let classroomName: String; let title: String
    let startsAt: String; let status: String; let note: String
    var id: String { participantId + ":" + sessionId }
}
struct LearningNotification: Codable, Identifiable, Hashable {
    let id: String; let type: String; let occurredAt: String; var readAt: String?; let link: String?
    let participantId: String?; let studentName: String?; let classroomName: String?; let sessionTitle: String?
}
struct LearningLeaveRequest: Codable, Identifiable {
    let id: String; let sessionId: String; let participantId: String; let sessionTitle: String; let reason: String
    let status: String; let createdAt: String; let decidedAt: String?; let makeupSessionId: String?
    let makeupSessionTitle: String?; let makeupClassroomName: String?; let makeupStartsAt: String?; let makeupStatus: String?
}
struct LearningCapabilities: Codable {
    let leaveRequests: Bool; let notificationRead: Bool; let chat: Bool; let rescheduling: Bool
    let wrongAnswers: Bool; let profileEditing: Bool; let payments: Bool
}
struct ParentIDResponse: Decodable { let id: String }
struct ParentOKResponse: Decodable { let ok: Bool }
struct SubmitPractice: Encodable {
    let action = "submit"
    let id: String
    let assignmentId: String
    let participantId: String
    let note: String
    let uploadIds: [String]
}

enum ParentDate {
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        calendar.firstWeekday = 2
        return calendar
    }
    static func parse(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
    static func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
    static func lessons(_ sessions: [LearningSession], on date: Date) -> [LearningSession] {
        sessions.filter { session in
            guard let start = parse(session.startsAt) else { return false }
            return calendar.isDate(start, inSameDayAs: date)
        }.sorted { $0.startsAt < $1.startsAt }
    }
    static func monthDays(_ month: Date) -> [Date?] {
        guard let start = calendar.dateInterval(of: .month, for: month)?.start,
              let days = calendar.range(of: .day, in: .month, for: month) else { return [] }
        let padding = (calendar.component(.weekday, from: start) - calendar.firstWeekday + 7) % 7
        return Array(repeating: nil, count: padding) + days.map { calendar.date(byAdding: .day, value: $0 - 1, to: start) }
    }
}

enum ParentFilter {
    static func practices(_ rows: [ParentPractice], participantID: String, state: String) -> [ParentPractice] {
        rows.filter { $0.participantId == participantID && (state == "all" || ($0.submittedAt == nil ? state == "pending" : state == "submitted")) }
    }
    static func reports(_ rows: [ParentReport], participantID: String) -> [ParentReport] {
        // 旧服务缺稳定 ID 时不回退姓名匹配，防止同名孩子混读。
        rows.filter { $0.participantId == participantID }
    }
}

enum ParentValidation {
    // HTTP 合同采用 JavaScript/Zod 字符串长度，按 UTF-16 单元计算。
    static func textLength(_ value: String) -> Int { value.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count }
    static func uncertainWrite(_ code: String?) -> Bool { ["NETWORK", "INVALID_RESPONSE", "UNAVAILABLE"].contains(code ?? "UNAVAILABLE") }
}

enum ParentEndpoint {
    static func origin(_ raw: String, allowLocalHTTP: Bool) -> URL? {
        guard let parts = URLComponents(string: raw), let host = parts.host,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { return nil }
        if parts.scheme == "https" { return parts.url }
        let pieces = host.split(separator: ".", omittingEmptySubsequences: false)
        let octets = pieces.compactMap { Int($0) }
        let privateIP = pieces.count == 4 && octets.count == 4 && pieces.allSatisfy { !$0.isEmpty && $0.allSatisfy(\.isNumber) }
            && octets.allSatisfy { (0...255).contains($0) }
            && (octets[0] == 10 || octets[0] == 127 || (octets[0] == 192 && octets[1] == 168)
                || (octets[0] == 172 && (16...31).contains(octets[1])))
        if allowLocalHTTP, parts.scheme == "http", privateIP || host == "localhost" || host == "[::1]" || host == "::1" { return parts.url }
        return nil
    }
}
