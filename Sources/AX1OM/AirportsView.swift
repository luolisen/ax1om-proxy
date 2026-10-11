import SwiftUI

struct AirportsView: View {
    @EnvironmentObject private var store: FleetStore
    @State private var showingAdd = false
    private var privateNodes: [NodeSummary] {
        let order = ["azure", "la-a", "panda"]
        return store.snapshot.nodes.filter(isPrivate).sorted { (order.firstIndex(of: $0.id) ?? 99) < (order.firstIndex(of: $1.id) ?? 99) }
    }
    private var subscriptions: [ProviderSummary] { store.snapshot.providers.filter { $0.id.hasPrefix("profile-") } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(alignment: .top) {
                    PageHeading(title: "订阅与专线", subtitle: "订阅来源与独立出口")
                    Button("添加订阅") { showingAdd = true }.padding(.top, 5)
                    Button { Task { await store.refresh() } } label: { Label("刷新状态", systemImage: "arrow.clockwise") }.disabled(store.isRefreshing).padding(.top, 5)
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text("自建专线").font(.title3.weight(.semibold))
                    if privateNodes.isEmpty {
                        emptyState("尚未读取到专线配置", detail: "等待读取", symbol: "server.rack")
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 14)], spacing: 14) {
                            ForEach(privateNodes) { node in privateCard(node) }
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("订阅来源").font(.title3.weight(.semibold))
                        Spacer()
                        Text("\(subscriptions.count) 份订阅")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if subscriptions.isEmpty {
                        emptyState("尚未读取到订阅来源", detail: "等待读取", symbol: "tray")
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 290), spacing: 14)], spacing: 14) {
                            ForEach(subscriptions) { provider in providerCard(provider) }
                        }
                    }
                }
            }.padding(28)
        }.sheet(isPresented: $showingAdd) { AddSubscriptionView().environmentObject(store) }
    }
    private func privateCard(_ node: NodeSummary) -> some View {
        FleetCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Image(systemName: "server.rack").foregroundStyle(node.id == "panda" ? Color.orange : Color.fleetAccent)
                    Text(FleetFormat.nodeName(node.id)).font(.headline)
                    Spacer()
                }
                HStack { StatusPill(text: node.state, tone: stateTone(node.state)); Spacer(); if let delay = node.delayMs { Text("\(Int(delay)) ms").font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary) } }
                VStack(alignment: .leading, spacing: 5) {
                    Text("本机累计用量").font(.caption).foregroundStyle(.secondary)
                    Text(FleetFormat.bytes(store.usageNodes(.all).first { $0.id == node.id }?.bytes ?? 0))
                        .font(.system(size: 24, weight: .semibold, design: .rounded)).monospacedDigit()
                }.help("本机记录的该节点上传与下载总量，非服务商账单；未记录的历史不会补算。")
                Divider()
                HStack { Text(node.kind.uppercased()).font(.caption).foregroundStyle(.secondary); Spacer(); if let cap = node.trafficCapBytes, cap > 0 { Text("最大 \(FleetFormat.bytes(cap))").font(.caption.weight(.medium)).foregroundStyle(.secondary) } }
            }
        }
    }
    private func providerCard(_ provider: ProviderSummary) -> some View {
        FleetCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack { Image(systemName: provider.kind.lowercased().contains("file") || provider.kind.contains("本地") ? "doc.text" : "cloud").foregroundStyle(.blue); Text(provider.name).font(.headline); Spacer()
                    if store.ownsRunningCore { Button { Task { await store.updateProvider(id: provider.id) } } label: { Image(systemName: "arrow.clockwise") }.buttonStyle(.plain).disabled(store.isManagingCore).help("更新此订阅") }
                }
                StatusPill(text: provider.state, tone: stateTone(provider.state))
                HStack { Text("\(provider.nodeCount) 个节点").font(.caption).foregroundStyle(.secondary); Spacer(); if let total = provider.totalBytes, total.isFinite, total > 0, provider.usedBytes == nil { Text("最大 \(FleetFormat.bytes(total))").font(.caption.weight(.medium)).foregroundStyle(.secondary) } }
                if let total = provider.totalBytes, let used = provider.usedBytes, total.isFinite, used.isFinite, total > 0, used >= 0 {
                    ProgressView(value: min(used / total, 1)).tint(used / total >= 0.9 ? Color.orange : Color.fleetAccent)
                    HStack { Text("已用 \(FleetFormat.bytes(used))"); Spacer(); Text("总量 \(FleetFormat.bytes(total))") }.font(.caption).foregroundStyle(.secondary)
                }
                if let updated = provider.updatedAt { Text("更新：\(updated)").font(.caption2).foregroundStyle(.tertiary) }
            }
        }
    }
    private func emptyState(_ title: String, detail: String, symbol: String) -> some View {
        VStack(spacing: 9) { Image(systemName: symbol).font(.title2).foregroundStyle(.tertiary); Text(title).font(.headline); Text(detail).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center) }.frame(maxWidth: .infinity).padding(24)
    }
    private func isPrivate(_ node: NodeSummary) -> Bool { ["azure", "la-a", "panda"].contains(node.id) || node.source == "自建专线" }
    private func stateTone(_ state: String) -> Color {
        let normalized = state.lowercased()
        if normalized.contains("失败") || normalized.contains("错误") || normalized.contains("timeout") || normalized.contains("不可") { return .orange }
        if normalized.contains("未测试") || normalized.contains("未加载") || normalized.contains("缓存") { return .secondary }
        if normalized.contains("可用") || normalized.contains("运行") || normalized.contains("已读取") || normalized == "ok" { return .green }
        return .secondary
    }
}
