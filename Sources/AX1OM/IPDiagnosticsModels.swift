import Foundation

struct IPDiagnosticsSnapshot: Decodable {
    var capturedAt: String
    var exits: [IPExit]
    var attributes: [IPField]
    var security: [IPField]
    var score: Double?
    var scoreDetail: String?
    var availability: [IPAvailability]
    var dns: IPCheck
    var webrtc: IPCheck
    var errors: [String]
    var checks: [IPExtraCheck]?
    var path: IPCheck?
    var dnsProbe: [IPDNSProbe]?
}
struct IPDNSProbe: Decodable {
    var host: String
    var type: Int
    var state: String
    var rcode: Int?
    var answerCount: Int?
}
struct IPExit: Decodable, Identifiable {
    var id: String
    var title: String
    var ip: String?
    var detail: String
    var source: String
    var state: String
    var sourceURL: String?
}
struct IPField: Decodable { var label: String; var value: String }
struct IPAvailability: Decodable { var label: String; var state: String; var latencyMs: Double?; var detail: String? }
struct IPCheck: Decodable { var state: String; var detail: String }
struct IPExtraCheck: Decodable, Identifiable { var id: String; var title: String; var state: String; var detail: String }
struct ConnectionCloseReceipt: Decodable { var success: Bool; var message: String }
