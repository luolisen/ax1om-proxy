import XCTest
@testable import AX1OM

final class PolicyTests: XCTestCase {
    func testRequestedRoutingAndBackup() throws {
        let routes = RoutePlan.defaults
        XCTAssertEqual(Set(routes.map(\.id)).count, 5)
        XCTAssertTrue(routes.allSatisfy { $0.backup == "panda" && $0.primary != "panda" })
        XCTAssertEqual(routes.filter { [.gpt, .claude].contains($0.service) }.map(\.primary), ["la-a", "la-a"])
        XCTAssertTrue(routes.filter { [.google, .xai, .slack].contains($0.service) }.allSatisfy { $0.primary == "azure" })
        XCTAssertEqual(try JSONDecoder().decode([RoutePlan].self, from: JSONEncoder().encode(routes)), routes)
    }
    func testMissingSnapshotDoesNotClaimHealthyNetwork() {
        let empty = BackendSnapshot.empty
        XCTAssertFalse(empty.relayRunning)
        XCTAssertFalse(empty.mihomoRunning)
        XCTAssertNil(empty.tunEnabled)
        XCTAssertTrue(empty.connections.isEmpty)
    }
}
