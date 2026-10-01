import SwiftUI
import UIKit

enum ParentTheme {
    // 本次截图参考增量采用淡紫色；墨色、纸白与星夜沿用 Mathin 基础主题。
    static let paper = adaptive(light: 0xF6F5FB, dark: 0x191D2B)
    static let ink = adaptive(light: 0x29251F, dark: 0xF2EDDF)
    static let muted = adaptive(light: 0x777585, dark: 0xABB0C1)
    static let card = adaptive(light: 0xFFFFFF, dark: 0x252A3D)
    static let accent = adaptive(light: 0x7164CC, dark: 0xB9ACFF)
    static let lavender = adaptive(light: 0xEBE7FC, dark: 0x34314F)
    static let line = adaptive(light: 0xEAE7F1, dark: 0x3D4357)
    static let rose = adaptive(light: 0xC94A4F, dark: 0xF49498)
    static let leaf = adaptive(light: 0x6F8B48, dark: 0xA9C284)
    static let moon = adaptive(light: 0xF4C35D, dark: 0xD9BE7E)
    static let sky = adaptive(light: 0x448BB9, dark: 0x87C6EB)
    static let night = Color(red: 0.15, green: 0.14, blue: 0.33)
    static let hero = LinearGradient(colors: [lavender, paper], startPoint: .topLeading, endPoint: .bottomTrailing)

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((rgb >> 16) & 0xff) / 255,
                green: CGFloat((rgb >> 8) & 0xff) / 255,
                blue: CGFloat(rgb & 0xff) / 255,
                alpha: 1
            )
        })
    }
}

struct ParentCard<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 16) { content }
            .padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(ParentTheme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

struct ParentPage<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) { content }
                .frame(maxWidth: 640).padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 28)
                .frame(maxWidth: .infinity)
        }.background(ParentTheme.hero).foregroundStyle(ParentTheme.ink)
    }
}

struct SectionTitle: View {
    let key: String
    var body: some View {
        HStack(spacing: 8) {
            Capsule().fill(ParentTheme.moon).frame(width: 4, height: 16).accessibilityHidden(true)
            Text(tr(key)).font(.headline)
        }.accessibilityAddTraits(.isHeader)
    }
}

struct ParentBadge: View {
    let text: String
    var color: Color = ParentTheme.accent
    var body: some View {
        Text(text).font(.caption.weight(.medium)).padding(.horizontal, 8).padding(.vertical, 4)
            .foregroundStyle(color).background(color.opacity(0.10), in: Capsule())
    }
}

struct SymbolTile: View {
    let symbol: String
    var color: Color = ParentTheme.accent
    var body: some View {
        Image(systemName: symbol).font(.title3.weight(.medium)).foregroundStyle(color)
            .frame(width: 48, height: 48).background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 15))
            .accessibilityHidden(true)
    }
}

struct PrimaryButton: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.body.weight(.semibold)).frame(maxWidth: .infinity).padding(.vertical, 15)
            .foregroundStyle(.white).background(ParentTheme.accent.opacity(enabled ? 1 : 0.4), in: Capsule())
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

struct EmptyState: View {
    let title: String
    var detail = "empty_detail"
    var symbol = "sparkles"
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol).font(.system(size: 42, weight: .light)).foregroundStyle(ParentTheme.accent)
                .frame(width: 96, height: 96).background(ParentTheme.lavender, in: Circle()).accessibilityHidden(true)
            Text(tr(title)).font(.headline)
            Text(tr(detail)).font(.subheadline).foregroundStyle(ParentTheme.muted).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity).padding(.vertical, 38)
    }
}

struct ChipPicker: View {
    let keys: [String]
    @Binding var selection: String
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(keys, id: \.self) { key in
                    Button { selection = key } label: {
                        Text(tr(key)).font(.subheadline.weight(selection == key ? .semibold : .regular))
                            .padding(.horizontal, 16).frame(minHeight: 44)
                            .background(selection == key ? ParentTheme.lavender : ParentTheme.card, in: Capsule())
                    }.foregroundStyle(selection == key ? ParentTheme.accent : ParentTheme.muted)
                        .accessibilityAddTraits(selection == key ? [.isSelected] : [])
                }
            }
        }
    }
}

func tr(_ key: String) -> String {
    let value = Bundle.main.localizedString(forKey: key, value: nil, table: "Parent")
    if value == key && key.hasPrefix("error_") { return tr("error_unavailable") }
    return value
}

func parentDate(_ raw: String?, template: String = "MMMdEEE") -> String {
    guard let raw, let date = ParentDate.parse(raw) else { return tr("date_pending") }
    return parentDate(date, template: template)
}

func parentDate(_ date: Date, template: String = "MMMdEEE") -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale.current
    formatter.calendar = ParentDate.calendar
    formatter.timeZone = ParentDate.calendar.timeZone
    formatter.setLocalizedDateFormatFromTemplate(template)
    return formatter.string(from: date)
}
