import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var store: FleetStore
    @State private var diagram = 0
    @AppStorage("usagePeriod") private var usagePeriod = "today"
    private var recordPeriod: UsagePeriod { UsagePeriod(rawValue: usagePeriod) ?? .today }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 21) {
                HStack(alignment: .top) {
                    PageHeading(title: "网络，尽在眼前。", subtitle: "")
                    if let at = store.lastRefresh { VStack(alignment: .trailing, spacing: 5) { Text("最近更新").foregroundStyle(.secondary); Text(at, style: .time).monospacedDigit() }.font(.system(size: 11)).padding(.top, 5) }
                }
                HStack(spacing: 14) {
                    MetricCard(title: "网络接管", value: store.snapshot.mihomoRunning ? "Mihomo" : "未启动", detail: store.snapshot.tunEnabled == true ? "TUN 已开启" : "TUN 未开启", symbol: "network", color: .fleetAccent)
                    MetricCard(title: "活动连接", value: "\(store.totalConnections)", detail: store.isStale ? "数据已过期" : "实时连接", symbol: "point.3.connected.trianglepath.dotted", color: ServiceKind.gpt.color)
                    MetricCard(title: "实时下载", value: store.hasCumulativeTraffic ? FleetFormat.rate(store.downloadRate) : "暂无总速率", detail: store.hasCumulativeTraffic ? "↑ " + FleetFormat.rate(store.uploadRate) : "连接统计", symbol: "arrow.down", color: .fleetAccent, points: store.rates.map(\.download))
                    MetricCard(title: "编排状态", value: store.ownsRunningCore ? "运行中" : "已保存", detail: "Azure / 洛杉矶 A 主用 · 潘达备用", symbol: "arrow.triangle.branch", color: .orange)
                }
                FleetCard(title: "流量记录") {
                    let usage = store.usageTotals(recordPeriod)
                    HStack(spacing: 28) {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(recordPeriod.title).font(.caption).foregroundStyle(.secondary)
                            Text(FleetFormat.bytes(usage.total)).font(.system(size: 28, weight: .semibold, design: .rounded)).monospacedDigit()
                        }
                        Spacer()
                        VStack(alignment: .leading, spacing: 7) { Label("上传", systemImage: "arrow.up").font(.caption).foregroundStyle(.secondary); Text(FleetFormat.bytes(usage.upload)).font(.system(size: 18, weight: .medium, design: .rounded)).foregroundStyle(ServiceKind.gpt.color) }
                        VStack(alignment: .leading, spacing: 7) { Label("下载", systemImage: "arrow.down").font(.caption).foregroundStyle(.secondary); Text(FleetFormat.bytes(usage.download)).font(.system(size: 18, weight: .medium, design: .rounded)).foregroundStyle(Color.fleetAccent) }
                    }
                    if let error = store.usagePersistenceError { Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange) }
                }
                FleetCard {
                    HStack {
                        VStack(alignment: .leading, spacing: 5) { Text("流向编排").font(.system(size: 17, weight: .semibold)); Text(diagram == 0 ? "当前连接" : "未应用").font(.system(size: 11)).foregroundStyle(.secondary) }
                        Spacer()
                        Picker("展示内容", selection: $diagram) { Text("运行流向").tag(0); Text("目标编排").tag(1) }.labelsHidden().pickerStyle(.segmented).frame(width: 210)
                    }
                    FlowDiagramView(planned: diagram == 1).frame(height: 390)
                    HStack(spacing: 15) {
                        ForEach([ServiceKind.google, .gpt, .claude, .xai, .slack], id: \.self) { service in HStack(spacing: 5) { Circle().fill(service.color).frame(width: 5, height: 5); Text(service.title).font(.system(size: 10)).foregroundStyle(.secondary) } }
                        Spacer()
                    }
                }
                HStack(alignment: .top, spacing: 16) {
                    FleetCard(title: "目标出口") {
                        ForEach(store.routes) { route in
                            HStack(spacing: 9) {
                                Image(systemName: route.service.symbol).foregroundStyle(route.service.color).frame(width: 19)
                                Text(route.title).font(.system(size: 12, weight: .medium))
                                Spacer(minLength: 10)
                                Text(FleetFormat.nodeName(route.primary)).font(.system(size: 11)).foregroundStyle(.secondary)
                                Image(systemName: "arrow.right").font(.system(size: 9)).foregroundStyle(.tertiary)
                            }.padding(.vertical, 3)
                        }
                        Divider()
                        Label("故障备用：潘达", systemImage: "shield.lefthalf.filled").font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                    FleetCard(title: "运行状态") {
                        evidenceRow("独立核心", store.ownsRunningCore ? "已连接" : "已停止", store.ownsRunningCore ? ServiceKind.gpt.color : .secondary)
                        evidenceRow("当前配置", store.snapshot.activeProfile ?? "待读取", .secondary)
                        evidenceRow("数据来源", "本机核心", .fleetAccent)
                        evidenceRow("模式", store.snapshot.tunEnabled == true ? "TUN" : "本地代理", .fleetAccent)
                    }
                }
                if let error = store.errorMessage { Label(error, systemImage: "exclamationmark.triangle").font(.system(size: 12)).foregroundStyle(.orange) }
                if !store.snapshot.errors.isEmpty { FleetCard(title: "采集提示") { ForEach(store.snapshot.errors, id: \.self) { Text($0).font(.system(size: 11)).foregroundStyle(.secondary) } } }
            }.padding(28)
        }
    }
    private func evidenceRow(_ title: String, _ value: String, _ color: Color) -> some View { HStack { Text(title).font(.system(size: 12)).foregroundStyle(.secondary); Spacer(); Text(value).font(.system(size: 11, weight: .medium)).foregroundStyle(color).lineLimit(1) }.padding(.vertical, 3) }
}

struct MetricCard: View {
    var title: String
    var value: String
    var detail: String
    var symbol: String
    var color: Color
    var points: [Double] = []
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text(title).font(.system(size: 11)).foregroundStyle(.secondary); Spacer(); Image(systemName: symbol).font(.system(size: 12)).foregroundStyle(color) }
            Text(value).font(.system(size: 24, weight: .semibold, design: .rounded)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            HStack { Text(detail).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1); if points.count > 1 { Sparkline(points: points, color: color).frame(width: 50, height: 16) } }
        }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(Color.fleetCard.opacity(0.75), in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.primary.opacity(0.06)))
    }
}
struct Sparkline: View {
    var points: [Double]
    var color: Color
    var body: some View { Canvas { context, size in
        guard points.count > 1 else { return }
        let maxValue = max(1, points.max() ?? 1)
        var path = Path()
        for (index, value) in points.enumerated() { let p = CGPoint(x: CGFloat(index) / CGFloat(points.count - 1) * size.width, y: size.height * (1 - CGFloat(value / maxValue))); if index == 0 { path.move(to: p) } else { path.addLine(to: p) } }
        context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
    } }
}
