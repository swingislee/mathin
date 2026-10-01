import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exportPlayground, validateOrigin } from "./export-playground.mjs";

test("development origin rejects credentials, production and insecure public hosts", () => {
  assert.equal(validateOrigin("http://192.168.50.10:3130").origin, "http://192.168.50.10:3130");
  assert.equal(validateOrigin("https://dev.example.test").protocol, "https:");
  for (const value of ["http://example.test", "http://192.168.5.183", "https://mathin.club", "https://supabase.mathin.club", "https://name:secret@dev.example.test", "https://dev.example.test?token=sample", "https://dev.example.test/api", "file:///tmp"]) {
    assert.throws(() => validateOrigin(value));
  }
});

const nativeManifest = `// swift-tools-version: 5.9
import PackageDescription
import AppleProductTypes
let package = Package(
    name: "我的 App",
    platforms: [.iOS("26.0")],
    products: [
        .iOSApplication(
            name: "我的 App",
            targets: ["AppModule"],
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .cloud),
            accentColor: .presetColor(.cyan),
            supportedDeviceFamilies: [.pad, .phone],
            supportedInterfaceOrientations: [
                .portrait
            ]
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: ".",
            swiftSettings: [
                .enableUpcomingFeature("BareSlashRegexLiterals")
            ]
        )
    ]
)
`;

test("export retains the working native entry, keeps real sign-in, and adds scoped LAN configuration", () => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = mkdtempSync(path.join(temporaryRoot, "mathin-playground-test-"));
  try {
    const template = path.join(directory, "我的 App.swiftpm");
    const metadata = path.join(template, ".swiftpm/playgrounds");
    mkdirSync(metadata, { recursive: true });
    const entry = "import SwiftUI\n@main struct MyApp: App { var body: some Scene { WindowGroup { ContentView() } } }\n";
    writeFileSync(path.join(template, "Package.swift"), nativeManifest);
    writeFileSync(path.join(template, "MyApp.swift"), entry);
    writeFileSync(path.join(template, "ContentView.swift"), "original content");
    writeFileSync(path.join(metadata, "Workspace.plist"), "original workspace");
    writeFileSync(path.join(metadata, "CachedManifest.plist"), "stale manifest cache");
    writeFileSync(path.join(template, "private.local"), "not for export");
    const output = path.join(directory, "V6");
    const { packageDirectory, report } = exportPlayground({ template, output, apiOrigin: "http://192.168.50.10:3130" });
    const read = (file) => readFileSync(path.join(packageDirectory, file), "utf8");
    assert.equal(path.basename(packageDirectory), "我的 App.swiftpm");
    assert.equal(read("MyApp.swift"), entry);
    assert.equal(readFileSync(path.join(template, "Package.swift"), "utf8"), nativeManifest);
    assert.equal(readFileSync(path.join(template, "ContentView.swift"), "utf8"), "original content");
    assert.equal(read(".swiftpm/playgrounds/Workspace.plist"), "original workspace");
    assert(!existsSync(path.join(packageDirectory, "private.local")));
    assert(!existsSync(path.join(packageDirectory, ".swiftpm/playgrounds/CachedManifest.plist")));
    assert(!existsSync(path.join(packageDirectory, "MathinParentApp.swift")));
    assert.match(read("Package.swift"), /\.iOS\("26.0"\)/);
    assert.match(read("Package.swift"), /additionalInfoPlistContentFilePath: "PlaygroundInfo.plist"/);
    assert.match(read("PlaygroundInfo.plist"), /<key>192.168.50.10<\/key>/);
    assert(!read("PlaygroundInfo.plist").includes("NSAllowsArbitraryLoads"));
    assert.match(read("ParentAPI.swift"), /forInfoDictionaryKey: "MathinAPIOrigin"/);
    assert.match(read("ParentRootView.swift"), /\.task \{ await store.restore\(\) \}/);
    assert.equal((read("ParentRootView.swift").match(/store.startPreview\(\)/g) ?? []).length, 1);
    const allSwift = readdirSync(packageDirectory).filter((file) => file.endsWith(".swift") && file !== "Package.swift").map(read).join("\n");
    assert.equal((allSwift.match(/@main/g) ?? []).length, 1);
    assert(!allSwift.includes("Bundle.module"));
    assert(read("ParentPlaygroundCopy.swift").includes('"app_feedback": "问题反馈"'));
    assert(report.nativeEntryPreserved && report.bilingualKeys >= 254);
    assert.throws(() => exportPlayground({ template, output, apiOrigin: "http://192.168.50.10:3130" }), /existing exports/);
    const secure = exportPlayground({ template, output: path.join(directory, "HTTPS"), apiOrigin: "https://dev.example.test" });
    assert(!readFileSync(path.join(secure.packageDirectory, "PlaygroundInfo.plist"), "utf8").includes("NSAppTransportSecurity"));
  } finally {
    assert(path.dirname(path.resolve(directory)) === temporaryRoot && path.basename(directory).startsWith("mathin-playground-test-"));
    rmSync(directory, { recursive: true });
  }
});
