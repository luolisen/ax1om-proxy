import SwiftUI

struct ConnectionsView: View {
    @EnvironmentObject private var store: FleetStore
    @AppStorage("showHosts") private var showHosts = true
    @State private var query = ""
    @State private var serviceFilter = "all"
    @State private var selectedID: String?
    private var records: [ConnectionRecord] {
        store.snapshot.connections.filter { record in
            (serviceFilter == "all" || record.service.rawValue == serviceFilter) && (query.isEmpty || [record.host, record.process, record.rule, record.chains.joined(separator: " ")].joined(separator: " ").localizedCaseInsensitiveContains(query))
        }.sorted { $0.download + $0.upload > $1.download + $1.upload }
    }
    private var selection: ConnectionRecord? { store.snapshot.connections.first { $0.id == selectedID } }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            PageHeading(title: "连接", subtitle: "按业务查看流量与出口")
            HStack(spacing: 14) {
                TextField("搜索域名、进程或规则", text: $query).textFieldStyle(.roundedBorder).frame(width: 270)
                Spacer()
                Label("\(store.snapshot.connections.count) 条连接", systemImage: "point.3.connected.trianglepath.dotted").font(.subheadline).foregroundStyle(.secondary)
                Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise") }.help("刷新连接").disabled(store.isRefreshing).accessibilityLabel("刷新连接")
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    filterButton("全部", id: "all", color: .secondary)
                    ForEach(ServiceKind.allCases) { service in filterButton(service.title, id: service.rawValue, color: service.color) }
                }.padding(.vertical, 2)
            }
            if let receipt = store.connectionCloseReceipt {
                Label(receipt.message, systemImage: receipt.success ? "checkmark.circle" : "exclamationmark.circle")
                    .font(.caption).foregroundStyle(receipt.success ? .green : .orange)
            }
            HStack(alignment: .top, spacing: 16) {
                FleetCard {
                    VStack(spacing: 0) {
                        HStack { Text("业务 / 目标").frame(maxWidth: .infinity, alignment: .leading); Text("路径").frame(width: 170, alignment: .leading); Text("接收 / 发送").frame(width: 125, alignment: .trailing) }.font(.caption.weight(.medium)).foregroundStyle(.secondary).padding(.bottom, 12)
                        Divider()
                        if records.isEmpty {
                            VStack(spacing: 10) {
                                Image(systemName: "point.3.filled.connected.trianglepath.dotted").font(.largeTitle).foregroundStyle(.tertiary)
                                Text(store.snapshot.connections.isEmpty ? "当前没有可展示的连接" : "没有匹配的连接").font(.headline)
                                Text(store.snapshot.connections.isEmpty ? "等待读取核心" : "更换业务分类或搜索条件。")
                                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(36)
                        } else {
                            ScrollView {
                                LazyVStack(spacing: 2) {
                                    ForEach(records) { connection in
                                        Button { selectedID = connection.id } label: { connectionRow(connection) }.buttonStyle(.plain)
                                    }
                                }.padding(.top, 8)
                            }
                        }
                    }.frame(maxHeight: .infinity)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
                if let connection = selection { connectionInspector(connection).frame(width: 280) }
            }.frame(maxHeight: .infinity)
            HStack { Circle().fill(store.isStale ? .orange : .green).frame(width: 6, height: 6); Text(store.isStale ? "状态已过期" : "实时连接"); Spacer(); if let date = store.lastRefresh { Text(date, style: .time) } }.font(.caption).foregroundStyle(.secondary)
        }.padding(28)
    }
    private func filterButton(_ title: String, id: String, color: Color) -> some View {
        Button { serviceFilter = id } label: {
            HStack(spacing: 7) { Circle().fill(color).frame(width: 6, height: 6); Text(title).font(.system(size: 12, weight: serviceFilter == id ? .semibold : .regular)) }
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(serviceFilter == id ? color.opacity(0.15) : Color.secondary.opacity(0.055), in: Capsule())
                .overlay(Capsule().strokeBorder(serviceFilter == id ? color.opacity(0.45) : .clear, lineWidth: 1))
        }.buttonStyle(.plain).accessibilityLabel("筛选 \(title) 连接").accessibilityAddTraits(serviceFilter == id ? .isSelected : [])
    }
    private func connectionRow(_ connection: ConnectionRecord) -> some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(connection.service.color).frame(width: 3, height: 35)
            VStack(alignment: .leading, spacing: 5) {
                Text(showHosts ? connection.host : "目标已隐藏").font(.system(size: 13, weight: .medium)).lineLimit(1)
                HStack(spacing: 6) { Text(connection.service.title).foregroundStyle(connection.service.color); Text("·"); Text(connection.process.isEmpty ? connection.network.uppercased() : connection.process) }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }.frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 5) { Text(connection.chains.joined(separator: " → ")).lineLimit(1); Text(connection.rule).foregroundStyle(.secondary).lineLimit(1) }.font(.caption).frame(width: 170, alignment: .leading)
            VStack(alignment: .trailing, spacing: 5) { Text("↓ " + FleetFormat.bytes(connection.download)); Text("↑ " + FleetFormat.bytes(connection.upload)).foregroundStyle(.secondary) }.font(.system(.caption, design: .monospaced)).frame(width: 125, alignment: .trailing)
        }.padding(.horizontal, 9).padding(.vertical, 11).background(selectedID == connection.id ? connection.service.color.opacity(0.095) : .clear, in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
    }
    private func connectionInspector(_ connection: ConnectionRecord) -> some View {
        FleetCard {
            VStack(alignment: .leading, spacing: 20) {
                HStack { Label(connection.service.title, systemImage: connection.service.symbol).font(.headline).foregroundStyle(connection.service.color); Spacer(); Button { selectedID = nil } label: { Image(systemName: "xmark") }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("关闭连接详情") }
                inspectorField("目标", value: showHosts ? connection.host : "目标已隐藏")
                inspectorField("进程", value: connection.process.isEmpty ? "未提供" : connection.process)
                inspectorField("网络", value: connection.network.uppercased())
                inspectorField("命中规则", value: connection.rule)
                VStack(alignment: .leading, spacing: 9) {
                    Text("实际路径").font(.caption).foregroundStyle(.secondary)
                    if connection.chains.isEmpty { Text("未提供").font(.subheadline) }
                    ForEach(Array(connection.chains.enumerated()), id: \.offset) { index, chain in
                        HStack(spacing: 9) { Text("\(index + 1)").font(.system(.caption2, design: .monospaced)).frame(width: 20, height: 20).background(connection.service.color.opacity(0.14), in: Circle()); Text(chain).font(.subheadline).textSelection(.enabled) }
                    }
                }
                Divider()
                HStack { inspectorField("接收", value: FleetFormat.bytes(connection.download)); Spacer(); inspectorField("发送", value: FleetFormat.bytes(connection.upload)) }
                if let start = connection.start { inspectorField("建立时间", value: start) }
                Button(role: .destructive) {
                    Task { await store.closeConnection(id: connection.id) }
                } label: {
                    HStack { if store.closingConnectionID == connection.id { ProgressView().controlSize(.small) }; Label("终结连接", systemImage: "stop.circle") }.frame(maxWidth: .infinity)
                }.buttonStyle(.bordered).disabled(store.closingConnectionID != nil)
                    .help("关闭这一条连接；应用可能自动重新连接。")
            }
        }
    }
    private func inspectorField(_ title: String, value: String) -> some View { VStack(alignment: .leading, spacing: 5) { Text(title).font(.caption).foregroundStyle(.secondary); Text(value).font(.subheadline).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) } }
}
