package club.mathin.parent

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// 色值沿用 docs/plan/01-design-system.md。
private val LightColors = lightColorScheme(
    primary = Color(0xFF29251F),
    onPrimary = Color(0xFFFFFDF8),
    secondaryContainer = Color(0xFFFEEDB9),
    onSecondaryContainer = Color(0xFF29251F),
    background = Color(0xFFFFFDF8),
    surface = Color(0xFFFFFDF8),
    onBackground = Color(0xFF29251F),
    onSurface = Color(0xFF29251F),
    onSurfaceVariant = Color(0xFF766F65),
    outlineVariant = Color(0xFFE8E1D5),
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFFF2EDDF),
    onPrimary = Color(0xFF191D2B),
    secondaryContainer = Color(0xFFD9BE7E),
    onSecondaryContainer = Color(0xFF191D2B),
    background = Color(0xFF191D2B),
    surface = Color(0xFF191D2B),
    onBackground = Color(0xFFF2EDDF),
    onSurface = Color(0xFFF2EDDF),
    onSurfaceVariant = Color(0xFF9BA0B0),
    outlineVariant = Color(0xFF333A4E),
)

@Composable
fun ParentTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content,
    )
}
