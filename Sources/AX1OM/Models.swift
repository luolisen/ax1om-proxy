import Foundation
import SwiftUI

enum FleetPage: String, CaseIterable, Identifiable {
    case dashboard, usage, airports, nodes, routing, connections, ipCheck, settings
    var id: String { rawValue }
    var title: String { switch self { case .dashboard: return "控制台"; case .usage: return "用量"; case .airports: return "订阅"; case .nodes: return "节点"; case .routing: return "编排"; case .connections: return "连接"; case .ipCheck: return "IP 检测"; case .settings: return "设置" } }
    var symbol: String { switch self { case .dashboard: return "square.grid.2x2"; case .usage: return "chart.bar.xaxis"; case .airports: return "cloud"; case .nodes: return "server.rack"; case .routing: return "arrow.triangle.branch"; case .connections: return "point.3.connected.trianglepath.dotted"; case .ipCheck: return "globe"; case .settings: return "slider.horizontal.3" } }
}
enum ServiceKind: String, Codable, CaseIterable, Identifiable {
    case google, gpt, claude, xai, slack, other
    var id: String { rawValue }
    var title: String { switch self { case .google: return "Google"; case .gpt: return "GPT / OpenAI"; case .claude: return "Claude"; case .xai: return "X / Grok"; case .slack: return "Slack"; case .other: return "其他" } }
    var color: Color { switch self { case .google: return Color(red: 0.32, green: 0.66, blue: 1); case .gpt: return Color(red: 0.23, green: 0.82, blue: 0.65); case .claude: return Color(red: 0.94, green: 0.61, blue: 0.40); case .xai: return Color(red: 0.72, green: 0.57, blue: 0.96); case .slack: return Color(red: 0.94, green: 0.49, blue: 0.71); case .other: return .secondary } }
    var symbol: String { switch self { case .google: return "globe"; case .gpt: return "sparkles"; case .claude: return "sun.max"; case .xai: return "xmark"; case .slack: return "number"; case .other: return "network" } }
}
struct RoutePlan: Codable, Identifiable, Equatable {
    var id: String
    var title: String
    var service: ServiceKind
    var primary: String
    var backup: String
    static let defaults: [RoutePlan] = [
        .init(id: "openai", title: "OpenAI · ChatGPT · Codex", service: .gpt, primary: "la-a", backup: "panda"),
        .init(id: "anthropic", title: "Claude · Anthropic", service: .claude, primary: "la-a", backup: "panda"),
        .init(id: "google", title: "Google · Gemini · 云盘", service: .google, primary: "azure", backup: "panda"),
        .init(id: "xai", title: "X · Grok", service: .xai, primary: "azure", backup: "panda"),
        .init(id: "slack", title: "Slack", service: .slack, primary: "azure", backup: "panda")
    ]
}
struct SupplementaryRoute: Codable, Identifiable {
    var id: String
    var title: String
    var section: String
    var primary: String
    var symbol: String
    static let allowed = ["DIRECT", "GENERAL", "DOWNLOAD", "azure", "la-a"]
    static func targetTitle(_ id: String) -> String {
        ["DIRECT": "直连", "GENERAL": "常规代理", "DOWNLOAD": "下载线路", "azure": "Azure", "la-a": "洛杉矶 A"][id] ?? id
    }
    static let defaults: [Self] = [
        .init(id:"xiaohongshu",title:"小红书",section:"国内应用",primary:"DIRECT",symbol:"book"),
        .init(id:"douyin",title:"抖音",section:"国内应用",primary:"DIRECT",symbol:"music.note"),
        .init(id:"bilibili",title:"Bilibili",section:"国内应用",primary:"DIRECT",symbol:"play.tv"),
        .init(id:"kuaishou",title:"快手",section:"国内应用",primary:"DIRECT",symbol:"video"),
        .init(id:"bambu",title:"Bambu Handy",section:"国内应用",primary:"DIRECT",symbol:"printer"),
        .init(id:"telegram",title:"Telegram",section:"社交",primary:"GENERAL",symbol:"paperplane"),
        .init(id:"discord",title:"Discord",section:"社交",primary:"GENERAL",symbol:"bubble.left.and.bubble.right"),
        .init(id:"facebook",title:"Facebook",section:"社交",primary:"GENERAL",symbol:"person.2"),
        .init(id:"tiktok",title:"TikTok",section:"社交",primary:"GENERAL",symbol:"music.note"),
        .init(id:"spotify",title:"Spotify",section:"影音",primary:"GENERAL",symbol:"waveform"),
        .init(id:"netflix",title:"Netflix",section:"影音",primary:"GENERAL",symbol:"film"),
        .init(id:"youtube",title:"YouTube",section:"影音",primary:"azure",symbol:"play.rectangle"),
        .init(id:"github",title:"GitHub",section:"服务与下载",primary:"GENERAL",symbol:"chevron.left.forwardslash.chevron.right"),
        .init(id:"steam",title:"Steam",section:"服务与下载",primary:"DOWNLOAD",symbol:"gamecontroller"),
        .init(id:"apple",title:"Apple",section:"服务与下载",primary:"DIRECT",symbol:"apple.logo"),
        .init(id:"microsoft",title:"Microsoft",section:"服务与下载",primary:"DIRECT",symbol:"square.grid.2x2"),
        .init(id:"fcm",title:"Google FCM",section:"服务与下载",primary:"azure",symbol:"bell"),
        .init(id:"download",title:"大型下载",section:"默认策略",primary:"DOWNLOAD",symbol:"arrow.down.circle"),
        .init(id:"catchall",title:"漏网之鱼",section:"默认策略",primary:"GENERAL",symbol:"line.3.horizontal.decrease.circle")
    ]
}
struct NodeSummary: Codable, Identifiable {
    var id: String
    var name: String
    var source: String
    var kind: String
    var state: String
    var address: String?
    var delayMs: Double?
    var detail: String?
    var trafficCapBytes: Double? = nil
}
struct ProviderSummary: Codable, Identifiable {
    var id: String
    var name: String
    var kind: String
    var nodeCount: Int
    var state: String
    var usedBytes: Double?
    var totalBytes: Double?
    var updatedAt: String?
    var detail: String?
}
struct ConnectionRecord: Codable, Identifiable {
    var id: String
    var service: ServiceKind
    var host: String
    var process: String
    var network: String
    var rule: String
    var chains: [String]
    var upload: Double
    var download: Double
    var start: String?
    var nodeID: String? = nil
    var nodeName: String? = nil
}
struct ProxyMemberSummary: Codable, Identifiable {
    var id: String
    var name: String
    var kind: String
    var state: String
    var delayMs: Double?
    var udp: Bool?
}
struct ProxyGroupSummary: Codable, Identifiable {
    var id: String
    var name: String
    var kind: String
    var selected: String?
    var members: [ProxyMemberSummary]
}
struct PrivacyCheck: Codable, Identifiable {
    var id: String
    var title: String
    var state: String
    var detail: String
}
struct BackendSnapshot: Codable {
    var capturedAt: String
    var relayRunning: Bool
    var mihomoRunning: Bool
    var tunEnabled: Bool?
    var mode: String
    var activeProfile: String?
    var connections: [ConnectionRecord]
    var nodes: [NodeSummary]
    var providers: [ProviderSummary]
    var privacy: [PrivacyCheck]
    var errors: [String]
    var uploadTotal: Double
    var downloadTotal: Double
    var proxyGroups: [ProxyGroupSummary]? = nil
    static var empty: Self { .init(capturedAt: "", relayRunning: false, mihomoRunning: false, tunEnabled: nil, mode: "待读取", activeProfile: nil, connections: [], nodes: [], providers: [], privacy: [], errors: [], uploadTotal: 0, downloadTotal: 0) }
}
struct CandidateReceipt: Codable {
    var success: Bool
    var path: String?
    var reportPath: String?
    var notes: [String]
}
enum FleetFormat {
    static func bytes(_ value: Double) -> String { if value <= 0 { return "0 B" }; return ByteCountFormatter.string(fromByteCount: Int64(max(0, value)), countStyle: .file) }
    static func rate(_ value: Double) -> String { bytes(value) + "/s" }
    static func nodeName(_ id: String) -> String { ["azure": "Azure · West US", "la-a": "洛杉矶 A", "panda": "潘达 · 故障备用"][id] ?? id }
}
