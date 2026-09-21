# Android 原生家长端

使用 Kotlin + Jetpack Compose。Java 17+、Android SDK 36；最低 Android 8（API 26）。

1. Android Studio 打开当前文件夹，等待 Gradle 同步。
2. 安装 SDK Platform 36 与 Build Tools 35.0.0（若缺失，按 IDE 提示安装）。
3. 选择模拟器或已开启调试的手机运行 app。当前无需后端和账号。

Windows 命令行：

```powershell
# 未加入 PATH 时，JAVA_HOME 指向 Android Studio 的 jbr；ANDROID_HOME 指向 SDK。
.\gradlew.bat :app:assembleDebug :app:lintDebug
```

macOS/Linux：

```sh
./gradlew :app:assembleDebug :app:lintDebug
```

本机 SDK 路径由 Android Studio 写入忽略的 `local.properties`，或参照 local.properties.example。Gradle Wrapper 固定 8.13 并校验发行包 SHA-256；首次运行下载 Gradle 和 Maven 依赖。

输出：`app/build/outputs/apk/debug/app-debug.apk`。Debug ID 为 `club.mathin.parent.dev`，可与未来正式包共存；正式 ID 暂定 `club.mathin.parent`，发布签名尚未配置。

文案默认中文，系统语言为英文时切换英文，主题跟随系统。外壳离线运行，当前无需网络、相机或存储权限；业务接入时添加实际所需权限和环境配置。

工具链版本依据：[AGP 8.13 兼容表](https://developer.android.com/build/releases/agp-8-13-0-release-notes)、[Compose 2025.12 稳定版](https://developer.android.com/blog/posts/whats-new-in-the-jetpack-compose-december-release)。
