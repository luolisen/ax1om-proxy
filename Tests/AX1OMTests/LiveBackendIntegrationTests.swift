import XCTest
@testable import AX1OM

final class LiveBackendIntegrationTests: XCTestCase {
    func testLocalReadOnlySnapshotDoesNotWaitForTimeout() async throws {
        guard ProcessInfo.processInfo.environment["AX1OM_RUN_LIVE_TESTS"] == "1" else {
            throw XCTSkip("Opt-in local read-only control socket integration test")
        }
        let started = Date()
        let snapshot = try await LiveBackend().fetchSnapshot()
        XCTAssertLessThan(Date().timeIntervalSince(started), 12)
        XCTAssertFalse(snapshot.capturedAt.isEmpty)
        XCTAssertGreaterThan(snapshot.nodes.count, 0)
        XCTAssertEqual(Set(snapshot.connections.map(\.id)).count, snapshot.connections.count)
        let groups = try XCTUnwrap(snapshot.proxyGroups)
        XCTAssertGreaterThan(groups.count, 0)
        XCTAssertEqual(Set(groups.map(\.id)).count, groups.count)
        for group in groups where group.selected != nil {
            XCTAssertTrue(group.members.contains { $0.name == group.selected })
        }
    }
}
