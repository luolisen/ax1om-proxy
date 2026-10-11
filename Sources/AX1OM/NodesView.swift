import SwiftUI

struct NodesView: View {
    @EnvironmentObject private var store: FleetStore
    @State private var expandedGroups: Set<String> = []
    @State private var draftSelections: [String: String] = [:]
    @State private var search = ""
    private var groups: [ProxyGroupSummary] { store.snapshot.proxyGroups ?? [] }
    private var visibleGroups: [ProxyGroupSummary] {
        groups.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || $0.members.contains { $0.name.localizedCaseInsensitiveContains(search) } }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top) {
                    PageHeading(title: "代理组与节点", subtitle: "跨订阅选择 · 同时可用")
                    Button { Task { await store.refresh() } } label: { Label("刷新状态", systemImage: "arrow.clockwise") }.disabled(store.isRefreshing).padding(.top, 5)
                }
                HStack {
                    TextField("搜索代理组或节点", text: $search).textFieldStyle(.roundedBorder).frame(width: 280)
                    Spacer()
                    Text("\(groups.count) 个代理组").font(.caption).foregroundStyle(.secondary)
                    if !draftSelections.isEmpty { Button("清除待应用选择") { draftSelections.removeAll() }.font(.caption) }
                }
                if !draftSelections.isEmpty {
                    HStack(spacing: 9) { Image(systemName: "square.and.pencil").foregroundStyle(.orange); Text("\(draftSelections.count) 个待应用选择").font(.caption).foregroundStyle(.secondary); Spacer() }.padding(12).background(Color.orange.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                }
                if visibleGroups.isEmpty {
                    FleetCard {
                        VStack(spacing: 10) { Image(systemName: "square.grid.2x2").font(.title).foregroundStyle(.tertiary); Text(groups.isEmpty ? "尚未取得代理组" : "没有匹配代理组").font(.headline); Text(groups.isEmpty ? "等待读取核心" : "尝试其他代理组或节点名称。").font(.caption).foregroundStyle(.secondary) }.frame(maxWidth: .infinity).padding(28)
                    }
                } else {
                    LazyVStack(spacing: 14) {
                        ForEach(visibleGroups) { group in
                            FleetCard {
                                DisclosureGroup(isExpanded: Binding(get: { expandedGroups.contains(group.id) }, set: { if $0 { expandedGroups.insert(group.id) } else { expandedGroups.remove(group.id) } })) {
                                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 205), spacing: 10)], spacing: 10) {
                                        ForEach(group.members.filter { search.isEmpty || group.name.localizedCaseInsensitiveContains(search) || $0.name.localizedCaseInsensitiveContains(search) }) { member in
                                            memberCard(member, group: group)
                                        }
                                    }.padding(.top, 17)
                                } label: { groupHeader(group) }
                            }
                        }
                    }
                }
                Text("缓存延迟")
                    .font(.caption).foregroundStyle(.secondary).padding(.top, 4)
            }.padding(28)
        }.onAppear { if expandedGroups.isEmpty, let group = groups.first { expandedGroups.insert(group.id) } }
        .onChange(of: groups.count) { _, _ in if expandedGroups.isEmpty, let group = groups.first { expandedGroups.insert(group.id) } }
    }
    private func groupHeader(_ group: ProxyGroupSummary) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 7) {
                Text(group.name).font(.system(size: 15, weight: .semibold))
                HStack(spacing: 8) {
                    Text(group.kind).font(.system(size: 10, weight: .medium)).foregroundStyle(Color.fleetAccent).padding(.horizontal, 7).padding(.vertical, 3).background(Color.fleetAccent.opacity(0.09), in: RoundedRectangle(cornerRadius: 5))
                    Text(group.selected.map { "当前：" + $0 } ?? "当前选择未提供").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            if let draft = draftSelections[group.id], draft != group.selected {
                StatusPill(text: "待应用：" + draft, tone: .orange).lineLimit(1).frame(maxWidth: 230)
            }
            Text("\(group.members.count)").font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary).padding(.horizontal, 9).padding(.vertical, 5).background(Color.secondary.opacity(0.08), in: Capsule())
        }.padding(.vertical, 2)
    }
    private func memberCard(_ member: ProxyMemberSummary, group: ProxyGroupSummary) -> some View {
        let isActive = group.selected == member.name
        let isDraft = draftSelections[group.id] == member.name && !isActive
        let failed = isTimeout(member)
        return Button {
            if store.ownsRunningCore && group.kind.lowercased() == "selector" {
                Task { await store.selectNode(group: group.name, node: member.name) }
            } else if isActive { draftSelections.removeValue(forKey: group.id) } else { draftSelections[group.id] = member.name }
        } label: {
            VStack(alignment: .leading, spacing: 13) {
                HStack(alignment: .top, spacing: 7) {
                    Text(member.name).font(.system(size: 12, weight: isActive ? .semibold : .medium)).foregroundStyle(.primary).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                    if isActive { Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.fleetAccent).accessibilityLabel("当前运行选择") }
                    else if isDraft { Image(systemName: "pencil.circle.fill").foregroundStyle(.orange).accessibilityLabel("待应用") }
                }
                HStack(spacing: 6) {
                    Text(member.kind.uppercased()).font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
                    if member.udp == true { Text("UDP").font(.system(size: 9)).foregroundStyle(.tertiary) }
                    Spacer(minLength: 4)
                    if failed { Text("Timeout").font(.system(size: 11, weight: .medium)).foregroundStyle(.red) }
                    else if let delay = member.delayMs, delay > 0 { Text("\(Int(delay)) ms").font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(.green) }
                    else { Text(member.state).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1) }
                }
            }.padding(14).frame(maxWidth: .infinity, minHeight: 82, alignment: .topLeading)
                .background(isActive ? Color.fleetAccent.opacity(0.12) : Color.secondary.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(isDraft ? Color.orange.opacity(0.75) : isActive ? Color.fleetAccent.opacity(0.65) : Color.primary.opacity(0.055), style: StrokeStyle(lineWidth: isDraft || isActive ? 1.3 : 1, dash: isDraft ? [4, 3] : [])))
                .contentShape(RoundedRectangle(cornerRadius: 10))
        }.buttonStyle(.plain).disabled(store.isManagingCore).help(isActive ? "当前运行选择" : store.ownsRunningCore ? "切换此策略组节点" : "选择为待应用节点")
        .accessibilityLabel("\(member.name)，\(member.kind)，\(isActive ? "当前运行选择" : isDraft ? "待应用" : "可选择")")
    }
    private func isTimeout(_ member: ProxyMemberSummary) -> Bool {
        let state = member.state.lowercased()
        return state.contains("timeout") || state.contains("超时") || state.contains("不可达") || state.contains("失败")
    }
}
