import SwiftUI

struct ReportsView: View {
    @Environment(ParentStore.self) private var store
    let assessmentsOnly: Bool
    @State private var category = "all"
    private var rows: [ParentReport] {
        store.reports.filter { (assessmentsOnly ? $0.kind == "assessment" : true) && (category == "all" || $0.kind == category) }
    }
    var body: some View {
        ParentPage {
            ChildHeader()
            DataStatus()
            if !assessmentsOnly { ChipPicker(keys: ["all", "feedback", "assessment"], selection: $category) }
            if (store.learning?.unassignedReportCount ?? 0) > 0 {
                Label(tr("legacy_reports_notice"), systemImage: "info.circle").font(.footnote).foregroundStyle(ParentTheme.muted)
            }
            ForEach(rows) { report in
                NavigationLink(value: ParentRoute.report(report.id)) {
                    ParentCard {
                        HStack {
                            ParentBadge(text: tr(report.kind), color: report.kind == "assessment" ? ParentTheme.leaf : ParentTheme.accent)
                            Spacer()
                            Text(parentDate(report.date)).font(.caption).foregroundStyle(ParentTheme.muted)
                        }
                        HStack(alignment: .top, spacing: 16) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(report.title).font(.headline)
                                Text(report.summary.isEmpty ? tr("view_report") : report.summary).font(.subheadline).foregroundStyle(ParentTheme.muted).lineLimit(3)
                            }
                            Spacer(minLength: 0)
                            SymbolTile(symbol: "chart.bar.doc.horizontal.fill")
                        }
                    }
                }.buttonStyle(.plain)
            }
            if rows.isEmpty, !store.loading { EmptyState(title: "no_reports", detail: "no_reports_detail", symbol: "chart.bar.doc.horizontal") }
            Text(tr("report_scope")).font(.caption).foregroundStyle(ParentTheme.muted)
        }.navigationTitle(tr(assessmentsOnly ? "assessments" : "reports"))
    }
}

struct ReportDetailView: View {
    @Environment(ParentStore.self) private var store
    let id: String
    private var report: ParentReport? { store.reports.first { $0.id == id } }
    var body: some View {
        ParentPage {
            DataStatus()
            if let report {
                VStack(alignment: .leading, spacing: 16) {
                    ParentBadge(text: tr(report.kind))
                    Text(report.title).font(.largeTitle.bold())
                    Text(report.participantName + " · " + parentDate(report.date)).font(.subheadline).foregroundStyle(ParentTheme.muted)
                    Image(systemName: "sparkles.rectangle.stack").font(.system(size: 68, weight: .light))
                        .foregroundStyle(ParentTheme.accent.opacity(0.6)).frame(maxWidth: .infinity, alignment: .trailing).accessibilityHidden(true)
                }.padding(8)
                if let score = report.score {
                    ParentCard {
                        SectionTitle(key: "learning_result")
                        HStack(alignment: .firstTextBaseline) {
                            Text(score.formatted()).font(.system(size: 44, weight: .bold, design: .rounded)).foregroundStyle(ParentTheme.accent)
                            if let total = report.totalScore, total > 0 { Text("/ " + total.formatted()).font(.title3).foregroundStyle(ParentTheme.muted) }
                        }
                        if let total = report.totalScore, total > 0 {
                            ProgressView(value: min(max(score / total, 0), 1)).tint(ParentTheme.accent)
                        }
                    }
                }
                section("teacher_observation", text: report.summary)
                section("strengths", text: report.strengths)
                section("focus_areas", text: report.focusAreas)
                section("home_suggestion", text: report.recommendation)
                Text(tr("published_content")).font(.caption).foregroundStyle(ParentTheme.muted)
            } else { EmptyState(title: "not_found") }
        }.navigationTitle(tr("report_detail"))
    }
    @ViewBuilder private func section(_ title: String, text: String) -> some View {
        if !text.isEmpty { ParentCard { SectionTitle(key: title); Text(text).font(.body).lineSpacing(6).textSelection(.enabled) } }
    }
}

struct GrowthView: View {
    @Environment(ParentStore.self) private var store
    var body: some View {
        ParentPage {
            ChildHeader()
            DataStatus()
            ParentCard {
                HStack {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(tr("growth_title")).font(.title2.bold())
                        Text(tr("growth_detail")).font(.subheadline).foregroundStyle(ParentTheme.muted)
                    }
                    Spacer()
                    Image(systemName: "star.circle.fill").font(.system(size: 70)).foregroundStyle(ParentTheme.moon).accessibilityHidden(true)
                }
                Text("\(store.learning?.summary?.starTotal ?? 0)").font(.system(size: 48, weight: .bold, design: .rounded)).foregroundStyle(ParentTheme.accent)
                Text(tr("learning_stars")).font(.caption).foregroundStyle(ParentTheme.muted)
            }
            ParentCard {
                SectionTitle(key: "attendance_record")
                if store.learning?.attendance.isEmpty != false { Text(tr("no_attendance")).foregroundStyle(ParentTheme.muted) }
                ForEach(store.learning?.attendance ?? []) { row in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(row.title).font(.subheadline.weight(.medium))
                            Text(parentDate(row.startsAt)).font(.caption).foregroundStyle(ParentTheme.muted)
                            if !row.note.isEmpty { Text(row.note).font(.caption).foregroundStyle(ParentTheme.muted) }
                        }
                        Spacer()
                        ParentBadge(text: tr("attendance_" + row.status), color: row.status == "absent" ? ParentTheme.rose : ParentTheme.leaf)
                    }.padding(.vertical, 5)
                }
            }
            NavigationLink(value: ParentRoute.reports) { Label(tr("view_reports"), systemImage: "chart.bar.doc.horizontal") }.buttonStyle(PrimaryButton())
            Text(tr("growth_scope")).font(.caption).foregroundStyle(ParentTheme.muted)
        }.navigationTitle(tr("growth"))
    }
}
