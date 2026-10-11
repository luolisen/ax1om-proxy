import SwiftUI

struct UsageDayBreakdown {
    let day: UsageDay?
    let maximum: Double
    var total: Double { (day?.upload ?? 0) + (day?.download ?? 0) }
    var level: Int? { guard day != nil else { return nil }; return total > 0 ? min(4, max(1, Int(ceil(total / max(1, maximum) * 4)))) : 0 }
    var services: [UsageServiceTotal] {
        (day?.serviceBytes ?? [:]).compactMap { key, bytes in
            guard let kind = ServiceKind(rawValue: key), bytes > 0 else { return nil }
            return UsageServiceTotal(service: kind, bytes: bytes)
        }.sorted { $0.bytes > $1.bytes }
    }
    var unassigned: Double { max(0, total - services.reduce(0) { $0 + $1.bytes }) }
    func share(_ bytes: Double) -> Double { total > 0 ? min(1, max(0, bytes / total)) : 0 }
}

struct UsageDayPopover: View {
    let date: Date
    let day: UsageDay?
    let maximum: Double
    private var breakdown: UsageDayBreakdown { .init(day: day, maximum: maximum) }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(date.formatted(.dateTime.year().month(.twoDigits).day(.twoDigits))).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                if let level = breakdown.level { StatusPill(text: "等级 \(level)", tone: .fleetAccent) }
            }
            Divider()
            Text(day == nil ? "无记录" : FleetFormat.bytes(breakdown.total)).font(.system(size: 27, weight: .semibold, design: .rounded)).monospacedDigit()
            if let day {
                HStack { Label(FleetFormat.bytes(day.download), systemImage: "arrow.down"); Spacer(); Label(FleetFormat.bytes(day.upload), systemImage: "arrow.up") }.font(.caption).foregroundStyle(.secondary)
                if !breakdown.services.isEmpty || breakdown.unassigned > 0 {
                    Divider()
                    Text("业务细分").font(.caption).foregroundStyle(.secondary)
                    ForEach(breakdown.services) { item in
                        breakdownRow(item.service.title, bytes: item.bytes, color: item.service.color)
                    }
                    if breakdown.unassigned > 0 { breakdownRow("未归属", bytes: breakdown.unassigned, color: .secondary) }
                }
            }
        }.padding(18).frame(width: 285)
    }
    private func breakdownRow(_ title: String, bytes: Double, color: Color) -> some View {
        VStack(spacing: 6) {
            HStack {
                Text(title).font(.system(size: 11, weight: .medium))
                Spacer()
                Text(FleetFormat.bytes(bytes)).font(.system(size: 11, design: .monospaced))
                Text(String(format: "%.0f%%", breakdown.share(bytes) * 100)).font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary).frame(width: 30, alignment: .trailing)
            }
            GeometryReader { geometry in
                Capsule().fill(color.opacity(0.13))
                    .overlay(alignment: .leading) { Capsule().fill(color).frame(width: geometry.size.width * breakdown.share(bytes)) }
            }.frame(height: 4)
        }
    }
}
