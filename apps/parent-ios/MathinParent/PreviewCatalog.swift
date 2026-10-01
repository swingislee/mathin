import Foundation

// 仅由登录页的“体验界面”显式进入。示例不会发送到业务接口或写入 Supabase。
enum PreviewCatalog {
    static let firstChild = "00000000-0000-4000-8000-000000000001"
    static let secondChild = "00000000-0000-4000-8000-000000000002"
    static func copy(_ zh: String, _ en: String) -> String { Locale.preferredLanguages.first?.hasPrefix("zh") == true ? zh : en }
    static var account: ParentAccount {
        ParentAccount(id: "preview", displayName: copy("小满家长", "Momo’s family"), participants: [
            ParentParticipant(id: firstChild, name: copy("小满", "Momo")),
            ParentParticipant(id: secondChild, name: copy("星野", "Luna"))
        ])
    }
    static func date(_ offset: Int, hour: Int = 16) -> String {
        let day = ParentDate.calendar.date(byAdding: .day, value: offset, to: Date())!
        return ParentDate.iso(ParentDate.calendar.date(bySettingHour: hour, minute: 30, second: 0, of: day)!)
    }
    static func learning(childID: String) -> ParentLearning {
        let older = childID == firstChild
        let name = account.participants.first { $0.id == childID }!.name
        let title = older ? copy("三年级 · 数学探索", "Grade 3 · Math explorers") : copy("一年级 · 数感启蒙", "Grade 1 · Number sense")
        let teacher = copy("林老师", "Teacher Lin")
        let classID = "class-" + childID
        let lessons = [-7, 0, 3, 7, 14].enumerated().map { index, offset in
            LearningSession(id: "session-\(childID)-\(index)", participantId: childID, classroomId: classID,
                            classroomName: title, title: older ? copy("第 \(index + 1) 讲 · 图形里的秘密", "Lesson \(index + 1) · Secrets of shapes") : copy("第 \(index + 1) 讲 · 数字好朋友", "Lesson \(index + 1) · Number friends"),
                            startsAt: date(offset), durationMinutes: 90, teacherName: teacher)
        }
        let reports = [ParentReport(id: "report-" + childID, participantId: childID, kind: "feedback", title: lessons[0].title,
                                    participantName: name, date: date(-7),
                                    summary: copy("今天主动分享了两种解题方法，还用图画清楚地解释了自己的思路。", "Shared two approaches today and explained the reasoning clearly with a drawing."),
                                    strengths: copy("善于观察，愿意表达。", "Observant and willing to explain."),
                                    focusAreas: copy("继续练习按顺序检查每一步。", "Keep practising checking each step in order."),
                                    recommendation: copy("和孩子一起找一找家里的对称图形。", "Explore symmetrical shapes around your home together."), score: 9, totalScore: 10)]
        return ParentLearning(participantId: childID, generatedAt: ParentDate.iso(Date()), range: LearningRange(from: date(-30), to: date(90)),
                              summary: LearningSummary(grade: older ? 3 : 1, nextSessionAt: date(0), weekSessionCount: 2, starTotal: older ? 72 : 24),
                              courses: [LearningCourse(id: classID, name: title, teacherName: teacher, nextSessionAt: date(0), sessionCount: lessons.count)],
                              schedule: lessons, attendance: [LearningAttendance(sessionId: lessons[0].id, participantId: childID, classroomName: title, title: lessons[0].title, startsAt: date(-7), status: "present", note: "")],
                              notifications: [
                                LearningNotification(id: "notice-1-" + childID, type: "session_review_published", occurredAt: date(-1), readAt: nil, link: nil, participantId: childID, studentName: name, classroomName: title, sessionTitle: lessons[0].title),
                                LearningNotification(id: "notice-2-" + childID, type: "assignment.published", occurredAt: date(-2), readAt: nil, link: nil, participantId: childID, studentName: name, classroomName: title, sessionTitle: copy("第 4 讲 · 课后练习", "Lesson 4 · Practice")),
                                LearningNotification(id: "notice-3-" + childID, type: "session_reminder", occurredAt: date(-3), readAt: date(-3), link: nil, participantId: childID, studentName: name, classroomName: title, sessionTitle: lessons[1].title)
                              ], leaveRequests: [], reports: reports, unassignedReportCount: 0,
                              capabilities: LearningCapabilities(leaveRequests: true, notificationRead: true, chat: false, rescheduling: false, wrongAnswers: false, profileEditing: false, payments: false))
    }
    static func practices(childID: String) -> [ParentPractice] {
        let name = account.participants.first { $0.id == childID }!.name
        return [
            ParentPractice(id: "practice-1-" + childID, participantId: childID, participantName: name,
                           title: copy("第 4 讲 · 图形与周长", "Lesson 4 · Shapes and perimeter"),
                           instructions: copy("用 12 根同样长的小棒拼成长方形。你能拼出几种不同的长方形？画出你的发现，并拍照上传。", "Use 12 equal sticks to make rectangles. How many different rectangles can you make? Draw your findings and upload a photo."), dueAt: date(3), submittedAt: nil),
            ParentPractice(id: "practice-2-" + childID, participantId: childID, participantName: name,
                           title: copy("第 3 讲 · 寻找规律", "Lesson 3 · Finding patterns"),
                           instructions: copy("观察 2、5、8、11，写出接下来的三个数，说明规律。", "Look at 2, 5, 8, 11. Write the next three numbers and explain the pattern."), dueAt: date(-2), submittedAt: date(-3))
        ]
    }
}
