package club.mathin.parent

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

private enum class ParentSection(
    @param:StringRes val title: Int,
    @param:StringRes val description: Int,
    val icon: ImageVector,
) {
    Courses(R.string.tab_courses, R.string.description_courses, Icons.Outlined.Home),
    Mistakes(R.string.tab_mistakes, R.string.description_mistakes, Icons.AutoMirrored.Outlined.List),
    Homework(R.string.tab_homework, R.string.description_homework, Icons.Outlined.Edit),
    Account(R.string.tab_account, R.string.description_account, Icons.Outlined.Person),
}

@Composable
fun ParentApp() {
    var selectedName by rememberSaveable { mutableStateOf(ParentSection.Courses.name) }
    val selected = ParentSection.valueOf(selectedName)
    Scaffold(
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                ParentSection.entries.forEach { section ->
                    NavigationBarItem(
                        selected = section == selected,
                        onClick = { selectedName = section.name },
                        icon = { Icon(section.icon, contentDescription = null) },
                        label = { Text(stringResource(section.title)) },
                    )
                }
            }
        },
    ) { insets ->
        Column(
            modifier = Modifier.fillMaxSize().padding(insets)
                .verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Text(stringResource(R.string.app_name), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(stringResource(selected.title), style = MaterialTheme.typography.headlineLarge)
            Text(stringResource(selected.description), style = MaterialTheme.typography.bodyLarge)
            HorizontalDivider()
            Text(stringResource(R.string.feature_availability), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
