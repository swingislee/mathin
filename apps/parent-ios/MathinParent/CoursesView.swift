import SwiftUI

struct Shortcut: View {
    let title: String
    let symbol: String
    let route: ParentRoute
    var color: Color = ParentTheme.accent
    var body: some View {
        NavigationLink(value: route) {
            VStack(spacing: 9) {
                Image(systemName: symbol).font(.title2).foregroundStyle(color).frame(height: 30).accessibilityHidden(true)
                Text(tr(title)).font(.caption).multilineTextAlignment(.center).foregroundStyle(ParentTheme.ink)
            }.frame(maxWidth: .infinity, minHeight: 65)
        }.buttonStyle(.plain)
    }
}

struct CoursesHomeView: View {
    @Environment(ParentStore.self) private var store
    @State private var selectedDay = Date()
    var body: some View {
        ParentPage {
            ChildHeader()
            DataStatus()
            ParentCard {
                HStack(alignment: .top, spacing: 8) {
                    Shortcut(title: "all_courses", symbol: "books.vertical.fill", route: .courses, color: ParentTheme.sky)
                    Shortcut(title: "reports", symbol: "chart.bar.doc.horizontal.fill", route: .reports, color: ParentTheme.moon)
                    Shortcut(title: "assessments", symbol: "flag.checkered", route: .assessments, color: ParentTheme.leaf)
                    Shortcut(title: "growth", symbol: "sparkles", route: .growth)
                }
            }
            NavigationLink(value: ParentRoute.reports) {
                HStack {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(tr("report_banner_title")).font(.title3.bold())
                        Text(tr("report_banner_detail")).font(.caption).foregroundStyle(ParentTheme.muted)
                        Text(tr("view_reports") + "  →").font(.caption.bold()).padding(.top, 5)
                    }
                    Spacer(minLength: 10)
                    Image(systemName: "chart.bar.doc.horizontal.fill").font(.system(size: 60, weight: .light)).rotationEffect(.degrees(-8))
                        .foregroundStyle(ParentTheme.accent.opacity(0.6)).accessibilityHidden(true)
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                    .background(ParentTheme.lavender, in: RoundedRectangle(cornerRadius: 22))
            }.buttonStyle(.plain)
            ParentCard {
                HStack {
                    SectionTitle(key: "today_lessons")
                    Spacer()
                    NavigationLink(value: ParentRoute.schedule) { Text(tr("full_schedule") + " ›").font(.caption) }
                }
                WeekStrip(selected: $selectedDay, sessions: store.schedule)
                let lessons = ParentDate.lessons(store.schedule, on: selectedDay)
                if lessons.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "sun.horizon").font(.title).foregroundStyle(ParentTheme.moon).accessibilityHidden(true)
                        Text(tr("no_lessons_today")).font(.subheadline).foregroundStyle(ParentTheme.muted)
                    }.frame(maxWidth: .infinity).padding(.vertical, 22)
                } else { ForEach(lessons) { LessonRow(lesson: $0) } }
            }
            if store.pending > 0 {
                NavigationLink(value: ParentRoute.practices) {
                    ParentCard {
                        HStack {
                            SymbolTile(symbol: "pencil.and.list.clipboard", color: ParentTheme.leaf)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(tr("practice_together")).font(.headline)
                                Text("\(store.pending) " + tr("tasks_pending")).font(.caption).foregroundStyle(ParentTheme.muted)
                            }
                            Spacer()
                            Image(systemName: "arrow.right")
                        }
                    }
                }.buttonStyle(.plain)
            }
            Text(tr("encouragement")).font(.caption).foregroundStyle(ParentTheme.muted).frame(maxWidth: .infinity).padding(.top, 4)
        }.navigationTitle("Mathin").navigationBarTitleDisplayMode(.inline)
            .refreshable { await store.loadAccount() }
    }
}

struct WeekStrip: View {
    @Binding var selected: Date
    let sessions: [LearningSession]
    private var dates: [Date] {
        let start = ParentDate.calendar.dateInterval(of: .weekOfYear, for: Date())!.start
        return (0..<7).compactMap { ParentDate.calendar.date(byAdding: .day, value: $0, to: start) }
    }
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(dates, id: \.self) { date in
                    let active = ParentDate.calendar.isDate(selected, inSameDayAs: date)
                    Button { selected = date } label: {
                        VStack(spacing: 8) {
                            Text(parentDate(date, template: "EEEEE")).font(.caption2)
                            Text(ParentDate.calendar.isDateInToday(date) ? tr("today_short") : "\(ParentDate.calendar.component(.day, from: date))").font(.subheadline.bold())
                            Circle().fill(ParentDate.lessons(sessions, on: date).isEmpty ? .clear : (active ? .white : ParentTheme.accent)).frame(width: 4, height: 4)
                        }.frame(width: 40, height: 74).padding(.horizontal, 2)
                            .foregroundStyle(active ? .white : ParentTheme.ink)
                            .background(active ? ParentTheme.accent : ParentTheme.paper, in: Capsule())
                    }.buttonStyle(.plain).accessibilityLabel(parentDate(date)).accessibilityAddTraits(active ? [.isSelected] : [])
                }
            }
        }
    }
}

struct LessonRow: View {
    let lesson: LearningSession
    var body: some View {
        NavigationLink(value: ParentRoute.lesson(lesson)) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(parentDate(lesson.startsAt, template: "Hm")).font(.title3.weight(.semibold)).monospacedDigit()
                    if let minutes = lesson.durationMinutes { Text("\(minutes) " + tr("minutes")).font(.caption) }
                }.foregroundStyle(ParentTheme.accent)
                Rectangle().fill(ParentTheme.line).frame(width: 1, height: 52).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 7) {
                    Text(lesson.title).font(.subheadline.weight(.semibold))
                    Text(lesson.classroomName).font(.caption).foregroundStyle(ParentTheme.muted)
                    if let teacher = lesson.teacherName { Label(teacher, systemImage: "person").font(.caption).foregroundStyle(ParentTheme.muted) }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(ParentTheme.muted)
            }.padding(14).background(ParentTheme.paper, in: RoundedRectangle(cornerRadius: 16))
        }.buttonStyle(.plain)
    }
}

struct LessonDetailView: View {
    let lesson: LearningSession
    var body: some View {
        ParentPage {
            ParentCard {
                ParentBadge(text: tr("math_learning"), color: ParentTheme.leaf)
                Text(lesson.title).font(.title2.bold())
                Text(lesson.classroomName).font(.headline)
                Label(parentDate(lesson.startsAt, template: "yyyyMMMdEEEHm"), systemImage: "calendar").font(.subheadline)
                if let duration = lesson.durationMinutes { Text("\(duration) " + tr("minutes")).foregroundStyle(ParentTheme.muted) }
                if let teacher = lesson.teacherName { Label(teacher, systemImage: "person").foregroundStyle(ParentTheme.muted) }
            }
            Text(tr("device_timezone") + " · " + TimeZone.current.identifier).font(.caption).foregroundStyle(ParentTheme.muted)
        }.navigationTitle(tr("course_detail"))
    }
}

struct CourseListView: View {
    @Environment(ParentStore.self) private var store
    @State private var search = ""
    private var rows: [LearningCourse] { store.courses.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || ($0.teacherName ?? "").localizedCaseInsensitiveContains(search) } }
    var body: some View {
        ParentPage {
            ChildHeader()
            DataStatus()
            Text(tr("courses_scope")).font(.footnote).foregroundStyle(ParentTheme.muted)
            ForEach(rows) { course in
                NavigationLink(value: ParentRoute.course(course.id)) { CourseCard(course: course) }.buttonStyle(.plain)
            }
            if rows.isEmpty, !store.loading { EmptyState(title: "no_courses", symbol: "books.vertical") }
        }.navigationTitle(tr("all_courses")).searchable(text: $search, prompt: tr("search_courses"))
    }
}

struct CourseCard: View {
    let course: LearningCourse
    var body: some View {
        ParentCard {
            HStack(alignment: .top) {
                ParentBadge(text: tr("math_learning"), color: ParentTheme.leaf)
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(ParentTheme.muted)
            }
            Text(course.name).font(.headline)
            if let teacher = course.teacherName { Label(teacher, systemImage: "person").font(.subheadline).foregroundStyle(ParentTheme.muted) }
            HStack {
                Label(parentDate(course.nextSessionAt), systemImage: "clock").font(.caption).foregroundStyle(ParentTheme.accent)
                Spacer()
                Text("\(course.sessionCount) " + tr("scheduled_lessons")).font(.caption).foregroundStyle(ParentTheme.muted)
            }
        }
    }
}

struct CourseDetailView: View {
    @Environment(ParentStore.self) private var store
    let id: String
    private var course: LearningCourse? { store.courses.first { $0.id == id } }
    var body: some View {
        ParentPage {
            DataStatus()
            if let course {
                CourseCard(course: course)
                SectionTitle(key: "lesson_plan")
                ForEach(store.schedule.filter { $0.classroomId == id }) { lesson in
                    ParentCard {
                        HStack { Text(parentDate(lesson.startsAt)).font(.caption).foregroundStyle(ParentTheme.accent); Spacer(); Text(parentDate(lesson.startsAt, template: "Hm")).font(.caption) }
                        Text(lesson.title).font(.headline)
                        if let attendance = store.learning?.attendance.first(where: { $0.sessionId == lesson.id }) {
                            ParentBadge(text: tr("attendance_" + attendance.status), color: ParentTheme.leaf)
                        }
                    }
                }
                NavigationLink(value: ParentRoute.service("leave")) { Label(tr("leave"), systemImage: "calendar.badge.clock") }.buttonStyle(PrimaryButton())
                Text(tr("courses_scope")).font(.caption).foregroundStyle(ParentTheme.muted)
            } else { EmptyState(title: "not_found") }
        }.navigationTitle(tr("course_detail"))
    }
}

struct ScheduleView: View {
    @Environment(ParentStore.self) private var store
    @State private var month = Date()
    @State private var selected = Date()
    @State private var monthSessions: [LearningSession] = []
    @State private var calendarLoading = false
    @State private var calendarError: String?
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 7)
    var body: some View {
        ParentPage {
            ChildHeader()
            DataStatus()
            ParentCard {
                HStack {
                    Text(parentDate(month, template: "yyyyMMMM")).font(.headline)
                    Spacer()
                    Button { move(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }.accessibilityLabel(tr("previous_month"))
                    Button { move(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }.accessibilityLabel(tr("next_month"))
                }
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(0..<7) { index in
                        Text(tr(["mon", "tue", "wed", "thu", "fri", "sat", "sun"][index])).font(.caption).foregroundStyle(ParentTheme.muted)
                    }
                    ForEach(Array(ParentDate.monthDays(month).enumerated()), id: \.offset) { _, date in
                        if let date {
                            let active = ParentDate.calendar.isDate(date, inSameDayAs: selected)
                            Button { selected = date } label: {
                                VStack(spacing: 5) {
                                    Text("\(ParentDate.calendar.component(.day, from: date))").font(.subheadline)
                                    Circle().fill(ParentDate.lessons(monthSessions, on: date).isEmpty ? .clear : (active ? .white : ParentTheme.accent)).frame(width: 4, height: 4)
                                }.frame(maxWidth: .infinity, minHeight: 44)
                                    .foregroundStyle(active ? .white : ParentTheme.ink)
                                    .background(active ? ParentTheme.accent : .clear, in: RoundedRectangle(cornerRadius: 14))
                            }.buttonStyle(.plain).accessibilityLabel(parentDate(date)).accessibilityAddTraits(active ? [.isSelected] : [])
                        } else { Color.clear.frame(height: 44).accessibilityHidden(true) }
                    }
                }
            }
            HStack { SectionTitle(key: "day_lessons"); Spacer(); Text(parentDate(selected)).font(.caption).foregroundStyle(ParentTheme.muted) }
            if calendarLoading { ProgressView(tr("loading")) }
            if let calendarError { Text(calendarError).font(.footnote).foregroundStyle(ParentTheme.rose) }
            let lessons = ParentDate.lessons(monthSessions, on: selected)
            if lessons.isEmpty, !store.loading, !calendarLoading, calendarError == nil { EmptyState(title: "no_lessons_today", symbol: "sun.horizon") }
            else { ForEach(lessons) { LessonRow(lesson: $0) } }
            Text(tr("device_timezone") + " · " + TimeZone.current.identifier).font(.caption2).foregroundStyle(ParentTheme.muted)
        }.navigationTitle(tr("schedule"))
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(tr("today")) { month = Date(); selected = Date() } } }
            .task(id: month) { await loadMonth() }
    }
    private func move(_ delta: Int) {
        if let date = ParentDate.calendar.date(byAdding: .month, value: delta, to: month) {
            month = date
            selected = ParentDate.calendar.dateInterval(of: .month, for: date)!.start
        }
    }
    private func loadMonth() async {
        guard let range = ParentDate.calendar.dateInterval(of: .month, for: month) else { return }
        let requestedMonth = month
        calendarLoading = true; calendarError = nil; monthSessions = []
        do {
            if store.preview { monthSessions = store.schedule }
            else {
                let result: ParentLearning = try await store.api.learning(participantID: store.selectedChildID, from: range.start, to: range.end)
                guard !Task.isCancelled, month == requestedMonth else { return }
                guard result.participantId == store.selectedChildID else { throw ParentAPIError(code: "INVALID_RESPONSE") }
                monthSessions = result.schedule
            }
        } catch { if !Task.isCancelled, month == requestedMonth { calendarError = error.localizedDescription } }
        if !Task.isCancelled, month == requestedMonth { calendarLoading = false }
    }
}
