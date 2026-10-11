import SwiftUI
import AppKit
import Darwin

struct IPDiagnosticsView: View {
    @EnvironmentObject private var store: FleetStore
    @AppStorage("hideDiagnosticIP") private var hideIP = false
    private let columns = Array(repeating: GridItem(.flexible(minimum: 220), spacing: 14, alignment: .top), count: 3)
    private var currentGroups: [ProxyGroupSummary] {
        let keys = ["chatgpt", "openai", "claude", "anthropic", "google", "gemini", "gpt", "潘达", "azure", "专线"]
        let groups = store.snapshot.proxyGroups ?? []
        let selected = groups.filter { group in keys.contains { group.name.localizedCaseInsensitiveContains($0) } && group.selected != nil }
        return Array((selected.isEmpty ? groups.filter { $0.selected != nil } : selected).prefix(5))
    }
    private func currentSelection(_ group: ProxyGroupSummary) -> (leaf: String, path: String, delay: Double?) {
        let groups = store.snapshot.proxyGroups ?? []
        var leaf = group.selected ?? "未提供"
        var path = [group.name, leaf]
        var visited: Set<String> = [group.name]
        for _ in 0..<8 {
            guard let nested = groups.first(where: { $0.name == leaf }) else {
                let delay = groups.flatMap(\.members).first(where: { $0.name == leaf })?.delayMs ?? store.snapshot.nodes.first(where: { $0.name == leaf })?.delayMs
                return (leaf, path.joined(separator: " → "), delay)
            }
            guard visited.insert(nested.name).inserted, let next = nested.selected else { return ("最终节点未取得", path.joined(separator: " → "), nil) }
            leaf = next
            path.append(next)
        }
        return ("最终节点未取得", path.joined(separator: " → "), nil)
    }
    private var liveConnectionPaths: [ConnectionRecord] {
        var seen: Set<String> = []
        return Array(store.snapshot.connections.filter { connection in
            guard connection.service != .other, !connection.chains.isEmpty else { return false }
            return seen.insert(connection.service.rawValue + "|" + connection.chains.joined(separator: "|")).inserted
        }.prefix(5))
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .top) {
                    PageHeading(title: "IP 检测", subtitle: "出口与隐私检查")
                    Toggle("隐藏 IP", isOn: $hideIP).toggleStyle(.switch).controlSize(.small).padding(.top, 7)
                    Button { Task { await store.checkIP() } } label: {
                        HStack(spacing: 7) { if store.isCheckingIP { ProgressView().controlSize(.small) }; Label(store.ipDiagnostics == nil ? "开始检测" : "重新检测", systemImage: "arrow.clockwise") }
                    }.buttonStyle(.borderedProminent).disabled(store.isCheckingIP).padding(.top, 4)
                }
                if let snapshot = store.ipDiagnostics {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
                        ForEach(snapshot.exits.filter { $0.ip != nil }, id: \.id) { item in exitCard(item) }
                    }
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
                        if snapshot.score != nil { scoreCard(snapshot) }
                        if !visibleFields(snapshot.attributes).isEmpty { fieldsCard("IP 属性", fields: visibleFields(snapshot.attributes)) }
                        if !visibleFields(snapshot.security).isEmpty { fieldsCard("安全检测 · 第三方", fields: visibleFields(snapshot.security)) }
                    }
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
                        if !snapshot.availability.isEmpty { availabilityCard(snapshot) }
                        if let probes = snapshot.dnsProbe, !probes.isEmpty { dnsRecordsCard(probes) }
                        ForEach((snapshot.checks ?? []).filter { $0.id != "dns-records" && hasResult($0.state) }) { item in
                            FleetCard(title: item.id == "ipv6" ? "出口协议探测" : masked(item.title)) {
                                VStack(alignment: .leading, spacing: 10) {
                                    StatusPill(text: masked(item.state), tone: stateColor(item.state))
                                    Text(masked(item.detail.components(separatedBy: "；").first ?? item.detail)).font(.caption).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
                            }
                        }
                    }
                    if let path = snapshot.path, hasResult(path.state) {
                        FleetCard(title: "检测入口") {
                            Text(masked(path.detail.components(separatedBy: "；").first ?? path.detail)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    HStack { Text("检测时间").foregroundStyle(.secondary); Spacer(); Text(masked(snapshot.capturedAt)).foregroundStyle(.secondary) }.font(.caption)
                    if !snapshot.errors.isEmpty {
                        FleetCard(title: "检测记录") { ForEach(Array(snapshot.errors.enumerated()), id: \.offset) { _, error in Text(masked(error.replacingOccurrences(of: "返回格式无法验证", with: "响应格式异常"))).font(.caption).foregroundStyle(.orange).textSelection(.enabled) } }
                    }
                } else {
                    FleetCard {
                        VStack(spacing: 12) {
                            Image(systemName: "globe.badge.magnifyingglass").font(.system(size: 34, weight: .light)).foregroundStyle(Color.fleetAccent)
                            Text(store.isCheckingIP ? "检测中" : "尚未检测").font(.headline)
                            Text("手动检查当前出口").font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity).padding(.vertical, 44)
                    }
                }
                if let error = store.ipCheckError { Label(masked(error), systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange) }
                deviceCard
                FleetCard(title: "检测网站") {
                    HStack(spacing: 12) {
                        websiteButton("Claude IP", "https://ip.net.coffee/claude/")
                        websiteButton("ping0.cc", "https://ping0.cc/")
                        websiteButton("ipip.la", "https://ipip.la/")
                        Spacer()
                    }
                }
                currentNodeCard
            }.padding(28)
        }
    }
    private func exitCard(_ item: IPExit) -> some View {
        FleetCard(title: item.id == "public" ? "网页查询出口" : item.id == "claude" ? "Claude trace 出口" : "Cloudflare 出口") {
            VStack(alignment: .leading, spacing: 12) {
                Text(item.ip.map { hideIP ? "•••.•••.•••.•••" : $0 } ?? "未取得").font(.system(size: 25, weight: .semibold, design: .rounded)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.65).textSelection(.enabled)
                Text(masked(item.detail.components(separatedBy: "；").first ?? item.detail)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                HStack { StatusPill(text: masked(item.state), tone: stateColor(item.state)); Spacer(); Text(masked(item.source)).font(.caption2).foregroundStyle(.tertiary).lineLimit(1) }
                if !hideIP, let source = item.sourceURL, let url = URL(string: source), ["https", "http"].contains(url.scheme ?? "") { Button("来源 ↗") { NSWorkspace.shared.open(url) }.font(.caption).buttonStyle(.plain).foregroundStyle(Color.fleetAccent) }
            }.frame(maxWidth: .infinity, minHeight: 113, alignment: .topLeading)
        }
    }
    private func scoreCard(_ snapshot: IPDiagnosticsSnapshot) -> some View {
        FleetCard(title: "信任参考") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .lastTextBaseline, spacing: 10) {
                    Text(snapshot.score.map { String(format: "%.0f", $0) } ?? "—").font(.system(size: 46, weight: .semibold, design: .rounded)).foregroundStyle(snapshot.score == nil ? Color.secondary : Color.fleetAccent)
                    Text(snapshot.score == nil ? "无数据" : "/ 100").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                }
                if let score = snapshot.score { ProgressView(value: min(100, max(0, score)), total: 100).tint(Color.fleetAccent) }
                Text(snapshot.scoreDetail?.contains("同网段") == true ? "Net.Coffee · 同网段样本参考" : "Net.Coffee · IP 参考").font(.caption).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, minHeight: 200, alignment: .topLeading)
        }
    }
    private func fieldsCard(_ title: String, fields: [IPField]) -> some View {
        FleetCard(title: title) {
            VStack(spacing: 8) {
                if fields.isEmpty { Text("未取得").font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                ForEach(Array(fields.enumerated()), id: \.offset) { index, field in
                    HStack(alignment: .top, spacing: 10) { Text(masked(field.label)).font(.caption).foregroundStyle(.secondary); Spacer(minLength: 12); Text(masked(field.value)).font(.system(size: 12, weight: .medium)).multilineTextAlignment(.trailing).lineLimit(2).textSelection(.enabled).help(masked(field.value)) }
                    if index < fields.count - 1 { Divider() }
                }
            }.frame(maxWidth: .infinity, minHeight: 200, alignment: .topLeading)
        }
    }
    private func availabilityCard(_ snapshot: IPDiagnosticsSnapshot) -> some View {
        FleetCard(title: "服务可用性") {
            VStack(spacing: 13) {
                if snapshot.availability.isEmpty { Text("未检测").font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                ForEach(Array(snapshot.availability.enumerated()), id: \.offset) { index, service in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) { Text(masked(service.label)).font(.system(size: 12)); Spacer(); StatusPill(text: masked(service.state), tone: stateColor(service.state)); if let latency = service.latencyMs { Text("\(Int(latency)) ms").font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary) } }
                        if let detail = service.detail, !detail.isEmpty { Text(masked(detail.components(separatedBy: "，").first ?? detail)).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
                    }
                    if index < snapshot.availability.count - 1 { Divider() }
                }
            }.frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
        }
    }
    private func hasResult(_ state: String) -> Bool {
        !["未实测", "未确认", "未获取", "未验证", "未知", "待验收", "路径未确认", "路径读取失败"].contains(state)
    }
    private func visibleFields(_ fields: [IPField]) -> [IPField] {
        fields.filter { $0.label != "说明" && !["未知", "未取得", "未获取完整属性"].contains($0.value) }
    }
    private func dnsRecordsCard(_ probes: [IPDNSProbe]) -> some View {
        FleetCard(title: "DNS 记录查询") {
            VStack(alignment: .leading, spacing: 10) {
                Text("本机解析器 · A / SVCB / HTTPS").font(.caption).foregroundStyle(.secondary)
                ForEach(Array(probes.enumerated()), id: \.offset) { _, probe in
                    HStack(spacing: 8) {
                        Text(probe.host).font(.caption)
                        Spacer()
                        Text(probe.type == 1 ? "A" : "Type \(probe.type)").font(.caption).foregroundStyle(.secondary)
                        Text(probe.rcode == 0 ? "\(probe.answerCount ?? 0) 条记录" : probe.state).font(.caption).foregroundStyle(probe.rcode == 0 ? Color.primary : .orange)
                    }
                }
            }.frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
        }
    }
    private var deviceCard: some View {
        FleetCard(title: "设备信息") {
            VStack(spacing: 12) {
                deviceRow("时区", TimeZone.current.identifier)
                Divider()
                deviceRow("本机语言", Locale.preferredLanguages.joined(separator: ", "))
                if let language = store.snapshot.privacy.first(where: { $0.id == "language" && hasResult($0.state) }) {
                    Divider()
                    HStack(alignment: .top) { Text("Chrome 语言配置").font(.caption).foregroundStyle(.secondary); Spacer(); VStack(alignment: .trailing, spacing: 6) { StatusPill(text: masked(language.state), tone: stateColor(language.state)); Text(masked(language.detail.components(separatedBy: "；").first ?? language.detail)).font(.caption).foregroundStyle(.secondary).help(masked(language.detail)) } }
                }
                Divider()
                deviceRow("操作系统", "macOS " + ProcessInfo.processInfo.operatingSystemVersionString)
            }
        }
    }
    private func deviceRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .top) { Text(title).font(.caption).foregroundStyle(.secondary); Spacer(); Text(masked(value)).font(.system(size: 12)).multilineTextAlignment(.trailing).textSelection(.enabled) }
    }
    private var currentNodeCard: some View {
        FleetCard(title: "当前使用节点检查") {
            VStack(alignment: .leading, spacing: 15) {
                HStack { StatusPill(text: masked(store.snapshot.mode), tone: .blue); if let profile = store.snapshot.activeProfile { Text(masked(profile)).font(.caption).foregroundStyle(.secondary).lineLimit(1) }; Spacer(); Button { Task { await store.refresh() } } label: { Label("刷新当前状态", systemImage: "arrow.clockwise") }.disabled(store.isRefreshing); Button { Task { await store.checkIP() } } label: { Label("检测当前路径", systemImage: "globe.badge.magnifyingglass") }.disabled(store.isCheckingIP) }
                ForEach(currentGroups) { group in
                    let selection = currentSelection(group)
                    HStack(spacing: 12) { Text(masked(group.name)).font(.system(size: 12, weight: .medium)); Spacer(); Text(masked(selection.leaf)).font(.system(size: 12)).foregroundStyle(.secondary).help(masked(selection.path)); if let delay = selection.delay, delay > 0 { Text("\(Int(delay)) ms").font(.system(.caption, design: .monospaced)).foregroundStyle(delay > 1000 ? Color.orange : .green).help("核心历史测速缓存") }; Image(systemName: "arrow.right").font(.caption2).foregroundStyle(.tertiary) }
                }
                if let diagnostics = store.ipDiagnostics {
                    Divider()
                    ForEach(diagnostics.exits.filter { $0.ip != nil }.prefix(3), id: \.id) { exit in
                        HStack { Text(masked(exit.title)).font(.caption).foregroundStyle(.secondary); Spacer(); Text(exit.ip.map { hideIP ? "•••.•••.•••.•••" : $0 } ?? "未取得").font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
                    }
                }
                if !liveConnectionPaths.isEmpty {
                    Divider()
                    Text("活动连接路径").font(.caption).foregroundStyle(.secondary)
                    ForEach(liveConnectionPaths) { connection in
                        HStack(spacing: 10) { Image(systemName: connection.service.symbol).foregroundStyle(connection.service.color).frame(width: 20); Text(connection.service.title).font(.caption); Spacer(); Text(masked(connection.chains.joined(separator: " → "))).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.trailing) }
                    }
                }
            }
        }
    }
    private func websiteButton(_ title: String, _ address: String) -> some View {
        Button { if let url = URL(string: address) { NSWorkspace.shared.open(url) } } label: { Label(title, systemImage: "arrow.up.right") }.controlSize(.small)
    }
    private func stateColor(_ state: String) -> Color {
        if state.contains("未") || state.contains("未知") || state.contains("待") { return .secondary }
        if state.contains("异常") || state.contains("失败") || state.lowercased().contains("timeout") { return .orange }
        if state.contains("正常") || state.contains("通过") || state.contains("无泄漏") { return .green }
        return .blue
    }
    private func masked(_ text: String) -> String {
        guard hideIP else { return text }
        var result = text
        let candidates = ["(?<![A-Za-z0-9])(?:[0-9]{1,3}\\.){3}[0-9]{1,3}(?![A-Za-z0-9])", "(?<![A-Za-z0-9])(?:[A-Fa-f0-9]{0,4}:){2,}[A-Fa-f0-9]{0,4}(?![A-Za-z0-9])"]
        for (index, pattern) in candidates.enumerated() {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let matches = regex.matches(in: result, range: NSRange(result.startIndex..., in: result))
            for match in matches.reversed() {
                guard let range = Range(match.range, in: result) else { continue }
                let candidate = String(result[range])
                let valid: Bool
                if index == 0 { var address = in_addr(); valid = candidate.withCString { inet_pton(AF_INET, $0, &address) } == 1 }
                else { var address = in6_addr(); valid = candidate.withCString { inet_pton(AF_INET6, $0, &address) } == 1 }
                if valid { result.replaceSubrange(range, with: "IP 已隐藏") }
            }
        }
        return result
    }
}
