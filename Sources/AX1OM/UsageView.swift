import SwiftUI
import Charts

struct UsageView: View {
    @EnvironmentObject private var store: FleetStore
    @State private var period: UsagePeriod = .today
    @State private var selectedHeatDate: Date?
    @State private var distribution: UsageDistribution = .business
    private enum UsageDistribution: String, CaseIterable { case business = "业务", node = "节点" }
    private struct DistributionItem: Identifiable { var id: String; var title: String; var bytes: Double; var color: Color }
    private var distributionItems: [DistributionItem] {
        var items: [DistributionItem] = distribution == .business
            ? services.map { .init(id: $0.id, title: $0.service.title, bytes: $0.bytes, color: $0.service.color) }
            : store.usageNodes(period).enumerated().map { index, node in
                .init(id: node.id, title: node.name, bytes: node.bytes, color: nodeColor(node.id, index: index))
            }
        let unassigned = max(0, totals.total - items.reduce(0) { $0 + $1.bytes })
        if unassigned > 0 { items.append(.init(id: "unassigned", title: "未归属", bytes: unassigned, color: .secondary.opacity(0.5))) }
        return items
    }
    private var totals: UsageTotals { store.usageTotals(period) }
    private var services: [UsageServiceTotal] { store.usageServices(period).filter { $0.bytes > 0 }.sorted { $0.bytes > $1.bytes } }
    private var days: [UsageDay] {
        let today = Calendar.current.startOfDay(for: Date())
        let start: Date
        switch period {
        case .today: start = today
        case .week: start = Calendar.current.date(byAdding: .day, value: -6, to: today) ?? today
        case .month: start = Calendar.current.date(byAdding: .day, value: -29, to: today) ?? today
        case .all: start = .distantPast
        }
        let end = Calendar.current.date(byAdding: .day, value: 1, to: today) ?? Date()
        return store.usageDays.filter { $0.date >= start && $0.date < end }.sorted { $0.date < $1.date }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .top) {
                    PageHeading(title: "用量", subtitle: "流量记录与业务分布")
                    Picker("统计周期", selection: $period) {
                        Text("今日").tag(UsagePeriod.today)
                        Text("7 天").tag(UsagePeriod.week)
                        Text("30 天").tag(UsagePeriod.month)
                        Text("累计").tag(UsagePeriod.all)
                    }.pickerStyle(.segmented).frame(width: 310).padding(.top, 5)
                }
                FleetCard {
                    HStack(alignment: .center, spacing: 36) {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(spacing: 8) { Text(periodTitle + "总流量").font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary); Circle().fill(Color.fleetAccent).frame(width: 5, height: 5) }
                            Text(FleetFormat.bytes(totals.total)).font(.system(size: 48, weight: .semibold, design: .rounded)).monospacedDigit().contentTransition(.numericText()).lineLimit(1).minimumScaleFactor(0.7)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                        Divider().frame(height: 70)
                        usageMetric("下载", value: totals.download, symbol: "arrow.down", color: .fleetAccent)
                        usageMetric("上传", value: totals.upload, symbol: "arrow.up", color: ServiceKind.gpt.color)
                    }.padding(.vertical, 8)
                }
                FleetCard(title: "流量趋势") {
                    if days.isEmpty || totals.total <= 0 {
                        emptyState("尚无累计流量", symbol: "chart.bar.xaxis")
                    } else {
                        Chart(days) { day in
                            BarMark(x: .value("日期", day.date, unit: .day), y: .value("流量", day.download)).foregroundStyle(by: .value("方向", "下载"))
                            BarMark(x: .value("日期", day.date, unit: .day), y: .value("流量", day.upload)).foregroundStyle(by: .value("方向", "上传"))
                        }
                        .chartForegroundStyleScale(["下载": Color.fleetAccent, "上传": ServiceKind.gpt.color])
                        .chartYAxis {
                            AxisMarks(position: .leading) { value in
                                AxisGridLine().foregroundStyle(Color.secondary.opacity(0.1))
                                AxisValueLabel { if let bytes = value.as(Double.self) { Text(FleetFormat.bytes(bytes)).font(.system(size: 9)) } }
                            }
                        }
                        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 6)) { _ in AxisValueLabel(format: .dateTime.month(.twoDigits).day(.twoDigits)).font(.system(size: 10)); AxisTick() } }
                        .chartLegend(position: .top, alignment: .trailing, spacing: 10)
                        .frame(height: 220)
                    }
                }
                HStack(alignment: .top, spacing: 16) {
                    FleetCard(title: "流量热力图 · 近 12 周") {
                        heatmap
                    }.frame(maxWidth: .infinity)
                    FleetCard(title: distribution == .business ? "业务占比" : "节点用量") {
                        Picker("用量维度", selection: $distribution) {
                            Label("业务", systemImage: "square.stack.3d.up").tag(UsageDistribution.business)
                            Label("节点", systemImage: "server.rack").tag(UsageDistribution.node)
                        }.pickerStyle(.segmented).frame(width: 190).padding(.bottom, 8)
                        if distributionItems.isEmpty { emptyState("尚无流量记录", symbol: "chart.pie") }
                        else {
                            HStack(spacing: 20) {
                                Chart(distributionItems) { item in
                                    SectorMark(angle: .value("流量", item.bytes), innerRadius: .ratio(0.72), angularInset: 2).foregroundStyle(item.color).cornerRadius(4)
                                }.chartLegend(.hidden).frame(width: 130, height: 130)
                                ScrollView {
                                    VStack(alignment: .leading, spacing: 12) {
                                        ForEach(distributionItems) { item in
                                            VStack(alignment: .leading, spacing: 5) {
                                                HStack(spacing: 7) {
                                                    Circle().fill(item.color).frame(width: 6, height: 6)
                                                    Text(item.title).font(.system(size: 11)).lineLimit(1)
                                                    Spacer(minLength: 6)
                                                    Text(String(format: "%.1f%%", item.bytes / max(1, totals.total) * 100)).font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(.secondary)
                                                }
                                                Text(FleetFormat.bytes(item.bytes)).font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary).padding(.leading, 13)
                                            }
                                        }
                                    }
                                }.frame(maxWidth: .infinity).frame(height: 160)
                            }.padding(.vertical, 5)
                        }
                        Text(distribution == .business ? "按连接业务统计 · 上传与下载" : "按实际连接节点统计 · 上传与下载").font(.caption).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity)
                }
                HStack(spacing: 0) {
                    Text("记录始于 ")
                    Text(store.usageStartedAt, format: .dateTime.year().month(.twoDigits).day(.twoDigits))
                    Text(" · 本机核心流量")
                }.font(.caption).foregroundStyle(.secondary)
            }.padding(28)
        }
    }
    private func nodeColor(_ id: String, index: Int) -> Color {
        switch id { case "azure": return .fleetAccent; case "la-a": return ServiceKind.gpt.color; case "panda": return .orange
        default: let palette: [Color] = [.blue, .purple, .pink, .cyan, .mint, .indigo]; return palette[index % palette.count] }
    }
    private var periodTitle: String { switch period { case .today: return "今日"; case .week: return "7 天"; case .month: return "30 天"; case .all: return "累计" } }
    private func usageMetric(_ title: String, value: Double, symbol: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 12) { Label(title, systemImage: symbol).font(.system(size: 11)).foregroundStyle(color); Text(FleetFormat.bytes(value)).font(.system(size: 23, weight: .semibold, design: .rounded)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7) }.frame(minWidth: 115, alignment: .leading)
    }
    private var heatmap: some View {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let start = calendar.date(byAdding: .day, value: -83, to: today) ?? today
        let weekdayOffset = (calendar.component(.weekday, from: start) + 5) % 7
        let alignedStart = calendar.date(byAdding: .day, value: -weekdayOffset, to: start) ?? start
        let count = (calendar.dateComponents([.day], from: alignedStart, to: today).day ?? 0) + 1
        let dates = (0..<count).compactMap { calendar.date(byAdding: .day, value: $0, to: alignedStart) }
        let recorded = Dictionary(store.usageDays.map { (calendar.startOfDay(for: $0.date), $0.upload + $0.download) }, uniquingKeysWith: +)
        let maximum = max(1, dates.compactMap { recorded[$0] }.max() ?? 1)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 8) {
                VStack(spacing: 5) { ForEach(["一", "二", "三", "四", "五", "六", "日"], id: \.self) { Text($0).font(.system(size: 8)).foregroundStyle(.tertiary).frame(width: 12, height: 15) } }
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHGrid(rows: Array(repeating: GridItem(.fixed(15), spacing: 5), count: 7), spacing: 5) {
                        ForEach(dates, id: \.self) { date in
                            Button { selectedHeatDate = date } label: {
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(date < start ? Color.clear : heatColor(recorded[date], maximum: maximum))
                                    .frame(width: 15, height: 15)
                                    .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(selectedHeatDate == date ? Color.primary.opacity(0.8) : .clear))
                            }.buttonStyle(.plain).disabled(date < start)
                                .onHover { inside in if inside && date >= start { selectedHeatDate = date } }
                                .popover(isPresented: Binding(get: { selectedHeatDate == date }, set: { if !$0 && selectedHeatDate == date { selectedHeatDate = nil } }), arrowEdge: .bottom) {
                                    UsageDayPopover(date: date, day: store.usageDays.first { calendar.isDate($0.date, inSameDayAs: date) }, maximum: maximum)
                                }
                                .accessibilityLabel(heatDescription(date, value: recorded[date]))
                        }
                    }.frame(height: 135, alignment: .top)
                }
            }
            HStack(spacing: 5) {
                Text("少").font(.system(size: 9)).foregroundStyle(.secondary)
                ForEach([0.08, 0.22, 0.43, 0.68, 1.0], id: \.self) { opacity in RoundedRectangle(cornerRadius: 2).fill(Color.fleetAccent.opacity(opacity)).frame(width: 11, height: 11) }
                Text("多").font(.system(size: 9)).foregroundStyle(.secondary)
                Spacer()
                Text("空白：无记录").font(.system(size: 9)).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 8)
    }
    private func heatColor(_ value: Double?, maximum: Double) -> Color {
        guard let value else { return Color.secondary.opacity(0.06) }
        guard value > 0 else { return Color.fleetAccent.opacity(0.08) }
        return Color.fleetAccent.opacity(0.18 + min(1, value / maximum) * 0.82)
    }
    private func heatDescription(_ date: Date, value: Double?) -> String {
        date.formatted(.dateTime.month(.twoDigits).day(.twoDigits)) + " · " + (value.map(FleetFormat.bytes) ?? "无记录")
    }
    private func emptyState(_ title: String, symbol: String) -> some View {
        VStack(spacing: 10) { Image(systemName: symbol).font(.title2).foregroundStyle(.tertiary); Text(title).font(.subheadline).foregroundStyle(.secondary) }.frame(maxWidth: .infinity).frame(height: 155)
    }
}
