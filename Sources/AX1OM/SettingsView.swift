import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: FleetStore
    @AppStorage("useTUN") private var useTUN = true
    @AppStorage("appearance") private var appearance = "dark"
    @AppStorage("animateFlow") private var animateFlow = true
    @AppStorage("refreshSeconds") private var refreshSeconds = 4.0
    @AppStorage("showHosts") private var showHosts = true
    @AppStorage("usagePeriod") private var usagePeriod = "today"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageHeading(title: "设置", subtitle: "偏好与网络状态")
                FleetCard(title: "界面与刷新") {
                    VStack(spacing: 0) {
                        settingRow("外观", subtitle: "跟随系统或独立选择主题", symbol: "circle.lefthalf.filled") {
                            Picker("外观", selection: $appearance) { Text("跟随系统").tag("system"); Text("浅色").tag("light"); Text("深色").tag("dark") }.labelsHidden().frame(width: 180)
                        }
                        Divider()
                        settingRow("流量粒子", subtitle: reduceMotion ? "跟随系统减少动态效果" : "控制台粒子效果", symbol: "sparkles") { Toggle("流量粒子", isOn: $animateFlow).labelsHidden().toggleStyle(.switch) }
                        Divider()
                        settingRow("显示连接目标", subtitle: "域名显示", symbol: "eye") { Toggle("显示连接目标", isOn: $showHosts).labelsHidden().toggleStyle(.switch) }
                        Divider()
                        settingRow("控制台流量周期", subtitle: "默认今日", symbol: "chart.bar") {
                            Picker("控制台流量周期", selection: $usagePeriod) { Text("今日").tag("today"); Text("7 天").tag("week"); Text("30 天").tag("month"); Text("累计").tag("all") }.labelsHidden().frame(width: 180)
                        }
                        Divider()
                        settingRow("状态刷新间隔", subtitle: "本地状态读取", symbol: "arrow.clockwise") {
                            Picker("状态刷新间隔", selection: $refreshSeconds) { Text("3 秒").tag(3.0); Text("4 秒").tag(4.0); Text("10 秒").tag(10.0); Text("30 秒").tag(30.0) }.labelsHidden().frame(width: 180)
                        }
                    }
                }
                FleetCard(title: "网络核心") {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack { Label(store.coreStatus?.running == true ? "运行中" : "已停止", systemImage: "network"); Spacer(); StatusPill(text: useTUN ? "TUN" : "独立代理", tone: .fleetAccent) }
                        settingRow("TUN 模式", subtitle: "默认开启 · 接管本机应用流量", symbol: "arrow.triangle.branch") {
                            Toggle("TUN 模式", isOn: $useTUN).labelsHidden().toggleStyle(.switch).disabled(store.coreStatus?.running == true)
                        }
                        Divider()
                        HStack {
                            Button("导入现有配置") { Task { await store.importExistingConfiguration() } }.disabled(store.isManagingCore || store.coreStatus?.running == true)
                            Button("生成配置") { Task { await store.generateCandidate() } }.disabled(store.isManagingCore || store.isBuildingCandidate)
                            Spacer()
                            if store.coreStatus?.running == true {
                                Button("停止内核") { Task { await store.stopCore() } }.disabled(store.isManagingCore)
                            } else {
                                Button(useTUN ? "启动 TUN" : "启动独立代理") { Task { await store.startCore(tun: useTUN) } }.buttonStyle(.borderedProminent).disabled(store.isManagingCore)
                            }
                        }
                        if let message = store.coreMessage { Text(message).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                        Text(useTUN ? "启动前请关闭旧代理的 TUN 并退出旧核心；首次启动需要管理员授权。" : "仅监听本机 17901；应用可显式使用此代理端口。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                FleetCard(title: "隐私与出口一致性") {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack { Image(systemName: "checkmark.shield").foregroundStyle(.blue); Text("配置与检测状态")
                            .font(.subheadline).foregroundStyle(.secondary); Spacer() }
                        if store.snapshot.privacy.isEmpty {
                            Text("检查结果未取得")
                                .font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 14)
                        }
                        ForEach(store.snapshot.privacy) { check in
                            VStack(alignment: .leading, spacing: 7) {
                                HStack { Text(check.title).font(.system(size: 13, weight: .semibold)); Spacer(); StatusPill(text: check.state, tone: privacyTone(check.state)) }
                                Text(check.detail.components(separatedBy: "；").prefix(2).joined(separator: "；")).font(.caption).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled).help(check.detail)
                            }
                            if check.id != store.snapshot.privacy.last?.id { Divider() }
                        }
                        Divider()
                        HStack { Text("读取时间").font(.caption).foregroundStyle(.secondary); Spacer(); Text(store.snapshot.capturedAt.isEmpty ? "尚未读取" : store.snapshot.capturedAt).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary) }
                    }
                }
                if !store.snapshot.errors.isEmpty || store.errorMessage != nil {
                    FleetCard(title: "读取诊断") {
                        VStack(alignment: .leading, spacing: 10) {
                            if let error = store.errorMessage { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).textSelection(.enabled) }
                            ForEach(Array(store.snapshot.errors.enumerated()), id: \.offset) { _, error in Text(error).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                            Button { Task { await store.refresh() } } label: { Label("重新读取", systemImage: "arrow.clockwise") }.disabled(store.isRefreshing)
                        }
                    }
                }
            }.padding(28)
        }
    }
    private func settingRow<Control: View>(_ title: String, subtitle: String, symbol: String, @ViewBuilder control: () -> Control) -> some View {
        HStack(spacing: 14) { Image(systemName: symbol).foregroundStyle(.secondary).frame(width: 26); VStack(alignment: .leading, spacing: 4) { Text(title).font(.system(size: 13, weight: .medium)); Text(subtitle).font(.caption).foregroundStyle(.secondary) }; Spacer(); control() }.padding(.vertical, 14)
    }
    private func readonlyRow(_ title: String, value: String, symbol: String, tone: Color) -> some View {
        HStack(spacing: 14) { Image(systemName: symbol).foregroundStyle(.secondary).frame(width: 26); Text(title).font(.subheadline); Spacer(); StatusPill(text: value, tone: tone) }.padding(.vertical, 13)
    }
    private func privacyTone(_ state: String) -> Color {
        if state.contains("未验证") || state.contains("未实测") || state.contains("未确认") || state.contains("待") || state.contains("未知") { return .orange }
        if state.contains("异常") || state.contains("失败") { return .red }
        if state.contains("配置") || state.contains("读取") || state == "Los Angeles" { return .blue }
        if state.contains("一致") { return .green }
        return .secondary
    }
}
