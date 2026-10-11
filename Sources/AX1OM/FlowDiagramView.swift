import SwiftUI

private struct FlowLane: Identifiable {
    let service: ServiceKind
    let destination: String
    let count: Int
    var id: String { service.rawValue }
}

struct FlowDiagramView: View {
    @EnvironmentObject var store: FleetStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("animateFlow") private var animateFlow = true
    var planned: Bool
    private var lanes: [FlowLane] {
        let services: [ServiceKind] = [.gpt, .claude, .google, .xai, .slack]
        return services.map { service in
            let records = store.snapshot.connections.filter { $0.service == service }
            let destinations = Dictionary(grouping: records, by: { $0.chains.first ?? "未知出口" }).mapValues(\.count)
            let current = destinations.sorted { a, b in a.value == b.value ? a.key < b.key : a.value > b.value }.first?.key
            let route = store.routes.first { $0.service == service }
            return FlowLane(service: service, destination: planned ? FleetFormat.nodeName(route?.primary ?? "未知") : (current ?? "无活动连接"), count: records.count)
        }
    }
    private var animate: Bool { !planned && animateFlow && !reduceMotion && scenePhase == .active && !store.isStale && (store.uploadRate + store.downloadRate) > 0 }
    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let centerX = size.width * 0.37
            let rightX = size.width * 0.79
            let origin = CGPoint(x: size.width * 0.1, y: 167)
            TimelineView(.animation(minimumInterval: 1.0 / 24, paused: !animate)) { timeline in
                Canvas { context, canvasSize in
                    let time = timeline.date.timeIntervalSinceReferenceDate
                    for x in stride(from: CGFloat(8), to: canvasSize.width, by: 23) {
                        for y in stride(from: CGFloat(8), to: canvasSize.height, by: 23) { context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 1.1, height: 1.1)), with: .color(.secondary.opacity(0.13))) }
                    }
                    for (index, lane) in lanes.enumerated() {
                        let y = CGFloat(45 + index * 61)
                        let servicePoint = CGPoint(x: centerX, y: y)
                        let destination = CGPoint(x: rightX, y: y)
                        let active = planned || lane.count > 0
                        drawLink(context: &context, from: origin, to: CGPoint(x: servicePoint.x - 55, y: y), color: lane.service.color, opacity: active ? 0.45 : 0.12, time: time, seed: index, particles: animate && lane.count > 0)
                        drawLink(context: &context, from: CGPoint(x: servicePoint.x + 55, y: y), to: CGPoint(x: destination.x - 84, y: y), color: lane.service.color, opacity: active ? 0.5 : 0.12, time: time, seed: index + 5, particles: animate && lane.count > 0)
                    }
                    if planned {
                        var backup = Path(); backup.move(to: CGPoint(x: centerX + 55, y: 335)); backup.addLine(to: CGPoint(x: rightX - 84, y: 335))
                        context.stroke(backup, with: .color(.secondary.opacity(0.36)), style: StrokeStyle(lineWidth: 1, dash: [4, 5]))
                    }
                }
            }
            flowOrigin.position(origin)
            ForEach(Array(lanes.enumerated()), id: \.element.id) { index, lane in
                let y = CGFloat(45 + index * 61)
                HStack(spacing: 8) { Image(systemName: lane.service.symbol); Text(lane.service.title).lineLimit(1) }.font(.system(size: 11, weight: .semibold)).foregroundStyle(lane.service.color).frame(width: 120, height: 34).background(Color.fleetCard, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(lane.service.color.opacity(0.24))).position(x: centerX, y: y)
                VStack(alignment: .leading, spacing: 5) {
                    Text(lane.destination).font(.system(size: 11, weight: .semibold)).lineLimit(1).truncationMode(.middle)
                    HStack(spacing: 5) { Circle().fill(planned ? .orange : lane.count > 0 && !store.isStale ? lane.service.color : .secondary).frame(width: 4, height: 4); Text(planned ? "未应用" : "\(lane.count) 个活动连接" + (store.isStale ? " · 已过期" : "")) }.font(.system(size: 9)).foregroundStyle(.secondary)
                }.padding(.horizontal, 12).frame(width: 177, height: 45, alignment: .leading).background(Color.fleetCard.opacity(0.98), in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.primary.opacity(0.08))).position(x: rightX, y: y)
            }
            if planned {
                Label("潘达 · 仅故障备用", systemImage: "shield.lefthalf.filled").font(.system(size: 10)).foregroundStyle(.secondary).frame(width: 177, height: 34).background(Color.fleetCard, in: RoundedRectangle(cornerRadius: 10)).position(x: rightX, y: 335)
                Text("备用尚未启用").font(.system(size: 10)).foregroundStyle(.tertiary).position(x: centerX, y: 335)
            }
            if !planned && store.snapshot.connections.isEmpty { Text(store.isStale ? "等待核心连接数据" : "当前没有活动连接").font(.system(size: 10)).foregroundStyle(.secondary).position(x: size.width * 0.5, y: 354) }
        }.accessibilityElement(children: .contain).accessibilityLabel(planned ? "目标编排，尚未应用" : "当前连接流向")
    }
    private var flowOrigin: some View {
        VStack(spacing: 9) { Image(systemName: "laptopcomputer").font(.system(size: 25, weight: .light)).foregroundStyle(Color.fleetAccent); Text("这台 Mac").font(.system(size: 11, weight: .medium)); Text(planned ? "目标策略" : "现有接管").font(.system(size: 9)).foregroundStyle(.secondary) }
            .frame(width: 105, height: 112).background(Color.fleetCard, in: RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.fleetAccent.opacity(0.2)))
    }
    private func drawLink(context: inout GraphicsContext, from: CGPoint, to: CGPoint, color: Color, opacity: Double, time: Double, seed: Int, particles: Bool) {
        let c1 = CGPoint(x: from.x + (to.x - from.x) * 0.48, y: from.y)
        let c2 = CGPoint(x: from.x + (to.x - from.x) * 0.52, y: to.y)
        var path = Path(); path.move(to: from); path.addCurve(to: to, control1: c1, control2: c2)
        context.stroke(path, with: .color(color.opacity(opacity)), style: StrokeStyle(lineWidth: 1.25, lineCap: .round))
        guard particles else { return }
        for index in 0..<3 {
            let t = CGFloat((time * 0.19 + Double(index) / 3 + Double(seed) * 0.071).truncatingRemainder(dividingBy: 1))
            let u = 1 - t
            let p = CGPoint(x: u*u*u*from.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*to.x, y: u*u*u*from.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*to.y)
            context.fill(Path(ellipseIn: CGRect(x: p.x - 6, y: p.y - 6, width: 12, height: 12)), with: .color(color.opacity(0.1)))
            context.fill(Path(ellipseIn: CGRect(x: p.x - 2, y: p.y - 2, width: 4, height: 4)), with: .color(color.opacity(0.92)))
        }
    }
}
