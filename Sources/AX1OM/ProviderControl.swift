import Foundation

struct ProviderReceipt: Decodable {
    var success: Bool
    var message: String?
    var configPath: String?
    var sourceId: String?
    var sources: [Source]?
    struct Source: Decodable { var id: String; var name: String; var type: String; var count: Int }
}

extension LiveBackend {
    func providerAction(_ action: String, name: String? = nil, type: String? = nil, url: String? = nil, path: String? = nil, slot: String? = nil, routes: [RoutePlan]? = nil, supplemental: [SupplementaryRoute]? = nil) async throws -> ProviderReceipt {
        struct Input: Encodable {
            var action: String; var name: String?; var type: String?; var url: String?; var path: String?
            var slot: String?
            var routes: [RoutePlan]?; var supplemental: [SupplementaryRoute]?
        }
        let input = try JSONEncoder().encode(Input(action: action, name: name, type: type, url: url, path: path, slot: slot, routes: routes, supplemental: supplemental))
        let data = try await run(resource: "provider-store.cjs", input: input, timeout: 45)
        let result = try JSONDecoder().decode(ProviderReceipt.self, from: data)
        guard result.success else { throw CoreControlError.message(result.message ?? "订阅操作未完成。") }
        return result
    }
}
