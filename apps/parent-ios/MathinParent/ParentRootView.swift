import SwiftUI

private enum ParentSection: String, CaseIterable, Identifiable {
    case courses, mistakes, homework, account
    var id: String { rawValue }
    var title: LocalizedStringKey { LocalizedStringKey("tab_" + rawValue) }
    var detail: LocalizedStringKey { LocalizedStringKey("description_" + rawValue) }
    var symbol: String {
        switch self {
        case .courses: "book"
        case .mistakes: "checkmark.circle"
        case .homework: "square.and.pencil"
        case .account: "person"
        }
    }
}

struct ParentRootView: View {
    var body: some View {
        TabView {
            ForEach(ParentSection.allCases) { section in
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            Text("Mathin")
                                .font(.subheadline)
                                .foregroundStyle(ParentTheme.muted)
                                .accessibilityLabel("Mathin")
                            Text(section.detail)
                                .font(.title3)
                            Divider()
                            Text("feature_availability")
                                .foregroundStyle(ParentTheme.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(24)
                    }
                    .background(ParentTheme.paper)
                    .foregroundStyle(ParentTheme.ink)
                    .navigationTitle(section.title)
                    .toolbarBackground(ParentTheme.paper, for: .navigationBar)
                }
                .tabItem { Label(section.title, systemImage: section.symbol) }
            }
        }
        .tint(ParentTheme.ink)
    }
}
