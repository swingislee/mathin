import SwiftUI
import UIKit

enum ParentTheme {
    // 色值沿用 docs/plan/01-design-system.md，动态颜色跟随系统外观。
    static let paper = adaptive(light: 0xFFFDF8, dark: 0x191D2B)
    static let ink = adaptive(light: 0x29251F, dark: 0xF2EDDF)
    static let muted = adaptive(light: 0x766F65, dark: 0x9BA0B0)

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
