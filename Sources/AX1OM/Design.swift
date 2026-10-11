import SwiftUI

extension Color {
    static let fleetBackground = Color(nsColor: .windowBackgroundColor)
    static let fleetCard = Color(nsColor: .controlBackgroundColor)
    static let fleetAccent = Color(red: 0.33, green: 0.75, blue: 0.95)
}

struct FleetCard<Content: View>: View {
    var title: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let title { Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary) }
            content
        }
        .padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.fleetCard.opacity(0.78), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(.primary.opacity(0.065)))
    }
}
struct StatusPill: View {
    var text: String
    var tone: Color = .secondary
    var body: some View { HStack(spacing: 5) { Circle().fill(tone).frame(width: 5, height: 5); Text(text).font(.system(size: 11, weight: .medium)) }.padding(.horizontal, 9).padding(.vertical, 5).foregroundStyle(tone).background(tone.opacity(0.12), in: Capsule()) }
}
struct PageHeading: View {
    var title: String
    var subtitle: String
    var body: some View { VStack(alignment: .leading, spacing: 7) { Text(title).font(.system(size: 28, weight: .bold, design: .rounded)); Text(subtitle).font(.system(size: 12)).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading) }
}
struct ServiceBadge: View {
    var service: ServiceKind
    var body: some View { Label(service.title, systemImage: service.symbol).font(.system(size: 11, weight: .medium)).foregroundStyle(service.color).padding(.horizontal, 9).padding(.vertical, 5).background(service.color.opacity(0.1), in: Capsule()) }
}
