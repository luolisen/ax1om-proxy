import SwiftUI
import AppKit

@main struct AX1OMApp: App {
    @StateObject private var store = FleetStore()
    @AppStorage("appearance") private var appearance = "dark"
    var body: some Scene {
        WindowGroup("AX1OM Network") {
            RootView().environmentObject(store).preferredColorScheme(appearance == "system" ? nil : appearance == "light" ? .light : .dark)
                .frame(minWidth: 1080, minHeight: 720)
                .task { await store.startPolling() }
        }
        .defaultSize(width: 1340, height: 870)
        .windowStyle(.hiddenTitleBar)
        .commands { CommandGroup(after: .newItem) { Button("刷新运行状态") { Task { await store.refresh() } }.keyboardShortcut("r") } }
        MenuBarExtra {
            Text("AX1OM Network · 网络编排台")
            Text(store.snapshot.mihomoRunning ? "当前接管：Mihomo" : "接管状态待核实")
            Text("连接 \(store.totalConnections) · ↓ \(FleetFormat.rate(store.downloadRate))")
            Divider()
            Button("显示控制台") { NSApp.activate(ignoringOtherApps: true); NSApp.windows.first(where: { $0.canBecomeMain })?.makeKeyAndOrderFront(nil) }
            Button("刷新状态") { Task { await store.refresh() } }
            Divider()
            Button("退出 AX1OM Network") { NSApp.terminate(nil) }
        } label: { BrandMark(menuBar: true).frame(width: 20, height: 20) }
    }
}

struct RootView: View {
    @EnvironmentObject var store: FleetStore
    @State private var page: FleetPage? = .dashboard
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 25) {
                HStack(spacing: 11) {
                    BrandMark().frame(width: 43, height: 43)
                    VStack(alignment: .leading, spacing: 3) { Text("AX1OM").font(.system(size: 19, weight: .bold, design: .rounded)); Text("NETWORK").font(.system(size: 10, weight: .semibold)).tracking(2.2).foregroundStyle(.secondary) }
                }.padding(.horizontal, 17).padding(.top, 30)
                List(selection: $page) {
                    ForEach(FleetPage.allCases) { item in Label(item.title, systemImage: item.symbol).font(.system(size: 14, weight: .medium)).padding(.vertical, 7).tag(item) }
                }.listStyle(.sidebar).scrollContentBackground(.hidden)
                VStack(alignment: .leading, spacing: 11) {
                    HStack(spacing: 7) { Circle().fill(store.snapshot.mihomoRunning && !store.isStale ? ServiceKind.gpt.color : .orange).frame(width: 6, height: 6); Text(store.snapshot.mihomoRunning ? "Mihomo 已连接" : "未启动").font(.system(size: 11, weight: .medium)) }
                }.padding(18)
            }.background(.ultraThinMaterial)
            .navigationSplitViewColumnWidth(min: 190, ideal: 205, max: 240)
        } detail: {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Text((page ?? .dashboard).title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                    Spacer()
                    StatusPill(text: "Mac · 当前设备", tone: .fleetAccent)
                    StatusPill(text: store.ownsRunningCore ? (store.snapshot.tunEnabled == true ? "TUN 运行中" : "独立代理") : "未启动", tone: store.ownsRunningCore ? .green : .secondary)
                    Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise").rotationEffect(.degrees(store.isRefreshing ? 90 : 0)) }.buttonStyle(.plain).help("刷新真实运行状态").disabled(store.isRefreshing)
                }.padding(.horizontal, 28).padding(.top, 20).padding(.bottom, 13)
                Divider().opacity(0.4)
                Group {
                    switch page ?? .dashboard {
                    case .dashboard: DashboardView()
                    case .usage: UsageView()
                    case .airports: AirportsView()
                    case .nodes: NodesView()
                    case .routing: RoutingView()
                    case .connections: ConnectionsView()
                    case .ipCheck: IPDiagnosticsView()
                    case .settings: SettingsView()
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }.background(Color.fleetBackground)
        }.tint(.fleetAccent)
    }
}
