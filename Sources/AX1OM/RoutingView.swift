import SwiftUI
import AppKit

struct RoutingView: View {
    @EnvironmentObject private var store: FleetStore
    @State private var expandedSupplemental: Set<String> = ["国内应用"]
    private var supplementalSections: [String] {
        store.supplementalRoutes.reduce(into: [String]()) { result, route in if !result.contains(route.section) { result.append(route.section) } }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PageHeading(title: "编排", subtitle: "业务主线路与故障备用")
                FleetCard(title: "业务编排") {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 10) {
                            Image(systemName: "square.and.pencil").foregroundStyle(.blue)
                            Text("本地策略")
                            Spacer()
                            StatusPill(text: "业务策略", tone: .fleetAccent)
                        }.font(.subheadline).padding(.bottom, 18)
                        ForEach(store.routes) { route in
                            HStack(spacing: 14) {
                                Image(systemName: route.service.symbol).font(.title3).foregroundStyle(route.service.color).frame(width: 30)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(route.title).font(.system(size: 13, weight: .semibold))
                                    Text("故障备用：潘达").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Picker("\(route.title) 主线路", selection: Binding(get: { route.primary }, set: { store.updatePrimary(routeID: route.id, nodeID: $0) })) {
                                    ForEach(["la-a", "azure", "panda"], id: \.self) { id in Text(FleetFormat.nodeName(id)).tag(id) }
                                }.labelsHidden().frame(width: 220)
                            }.padding(.vertical, 12)
                            if route.id != store.routes.last?.id { Divider() }
                        }
                        Divider().padding(.vertical, 16)
                        HStack {
                            Text("统一配置")
                                .font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Button { Task { await store.generateCandidate() } } label: {
                                HStack { if store.isBuildingCandidate { ProgressView().controlSize(.small) }; Label(store.ownsRunningCore ? "应用编排" : "保存编排", systemImage: "checkmark.shield") }
                            }.buttonStyle(.borderedProminent).disabled(store.isBuildingCandidate)
                        }
                        if let receipt = store.candidateReceipt {
                            VStack(alignment: .leading, spacing: 8) {
                                Label(receipt.success ? "校验通过" : "校验未通过", systemImage: receipt.success ? "checkmark.circle" : "exclamationmark.triangle").foregroundStyle(receipt.success ? Color.green : Color.orange)
                                Text(receipt.notes.first ?? "配置已保存。")
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
                                HStack {
                                    if let path = receipt.path { Button("查看配置文件") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) } }
                                    if let path = receipt.reportPath { Button("查看校验报告") { NSWorkspace.shared.open(URL(fileURLWithPath: path)) } }
                                }
                            }.padding(14).frame(maxWidth: .infinity, alignment: .leading).background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10)).padding(.top, 16)
                        }
                    }
                }
                if !store.supplementalRoutes.isEmpty {
                    FleetCard(title: "应用编排") {
                        VStack(spacing: 14) {
                            ForEach(supplementalSections, id: \.self) { section in
                                if section == "默认策略" {
                                    VStack(spacing: 0) { supplementalHeader(section); supplementalRows(section) }
                                } else {
                                    DisclosureGroup(isExpanded: Binding(get: { expandedSupplemental.contains(section) }, set: { if $0 { expandedSupplemental.insert(section) } else { expandedSupplemental.remove(section) } })) {
                                        supplementalRows(section)
                                    } label: { supplementalHeader(section) }
                                }
                                if section != supplementalSections.last { Divider() }
                            }
                        }
                    }
                }
                Label("DNS · WebRTC：设置管理", systemImage: "checkmark.shield").font(.caption).foregroundStyle(.secondary)
            }.padding(28)
        }
    }
    private func supplementalHeader(_ section: String) -> some View {
        HStack { Text(section).font(.system(size: 13, weight: .semibold)); Spacer(); Text("\(store.supplementalRoutes.filter { $0.section == section }.count)").font(.caption).foregroundStyle(.secondary) }
    }
    private func supplementalRows(_ section: String) -> some View {
        VStack(spacing: 0) {
            ForEach(store.supplementalRoutes.filter { $0.section == section }) { route in
                HStack(spacing: 12) {
                    Image(systemName: route.symbol).foregroundStyle(Color.fleetAccent).frame(width: 24)
                    Text(route.title).font(.system(size: 13, weight: .medium))
                    Spacer()
                    Picker("\(route.title) 线路", selection: Binding(get: { route.primary }, set: { store.updateSupplemental(routeID: route.id, nodeID: $0) })) {
                        ForEach(SupplementaryRoute.allowed, id: \.self) { target in Text(SupplementaryRoute.targetTitle(target)).tag(target) }
                    }.labelsHidden().frame(width: 220)
                }.padding(.vertical, 10)
                if route.id != store.supplementalRoutes.last(where: { $0.section == section })?.id { Divider() }
            }
        }.padding(.top, 10)
    }
}
