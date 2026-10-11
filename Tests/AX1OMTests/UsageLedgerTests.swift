import XCTest
@testable import AX1OM

@MainActor final class UsageLedgerTests: XCTestCase {
    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("AX1OM-Ledger-Test-" + UUID().uuidString)
    }
    private func date(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }
    private func snapshot(_ upload: Double, _ download: Double, connections: [ConnectionRecord] = []) -> BackendSnapshot {
        var value = BackendSnapshot.empty
        value.mihomoRunning = true; value.mode = "rule · Mihomo"
        value.uploadTotal = upload; value.downloadTotal = download; value.connections = connections
        return value
    }
    private func connection(_ id: String, _ service: ServiceKind, upload: Double = 0, download: Double = 0, start: String? = nil) -> ConnectionRecord {
        .init(id: id, service: service, host: "fixture.test", process: "fixture", network: "tcp", rule: "fixture", chains: [], upload: upload, download: download, start: start)
    }

    func testFirstFrameIsBaselineAndOnlyRealCounterDeltaCounts() {
        let dir = temporaryDirectory(); defer { try? FileManager.default.removeItem(at: dir) }
        let ledger = UsageLedger(directory: dir), at = date("2026-10-10T20:00:00Z")
        ledger.observe(snapshot(1000, 2000), at: at)
        XCTAssertEqual(ledger.total(.all, now: at).total, 0)
        ledger.observe(snapshot(1020, 2300), at: at.addingTimeInterval(4))
        XCTAssertEqual(ledger.total(.today, now: at).upload, 20)
        XCTAssertEqual(ledger.total(.all, now: at).download, 300)
    }

    func testCounterResetErrorsModeTwoAndLongGapNeverBackfill() {
        let dir = temporaryDirectory(); defer { try? FileManager.default.removeItem(at: dir) }
        let ledger = UsageLedger(directory: dir), at = date("2026-10-10T20:00:00Z")
        ledger.observe(snapshot(100, 100), at: at)
        ledger.observe(snapshot(5, 10), at: at.addingTimeInterval(4))
        XCTAssertEqual(ledger.total(.all, now: at).total, 0)
        ledger.observe(snapshot(7, 13), at: at.addingTimeInterval(8))
        var invalid = snapshot(900, 900); invalid.errors = ["failed read"]
        ledger.observe(invalid, at: at.addingTimeInterval(12))
        ledger.observe(snapshot(1000, 1000), at: at.addingTimeInterval(16))
        var modeTwo = snapshot(2000, 2000); modeTwo.mode = "模式二 · 独立系统代理"
        ledger.observe(modeTwo, at: at.addingTimeInterval(20))
        ledger.observe(snapshot(3000, 3000), at: at.addingTimeInterval(24))
        ledger.observe(snapshot(4000, 4000), at: at.addingTimeInterval(60))
        ledger.observe(snapshot(4001, 4001), at: at.addingTimeInterval(64))
        XCTAssertEqual(ledger.total(.all, now: at).total, 7)
    }

    func testConnectionAttributionOnlyUsesObservedDeltasOrProvenNewConnections() {
        let dir = temporaryDirectory(); defer { try? FileManager.default.removeItem(at: dir) }
        let ledger = UsageLedger(directory: dir), at = date("2026-10-10T20:00:00Z")
        ledger.observe(snapshot(0, 0, connections: [connection("existing", .gpt, download: 200)]), at: at)
        ledger.observe(snapshot(10, 100, connections: [
            connection("existing", .gpt, download: 230),
            connection("new", .claude, upload: 10, download: 20, start: "2026-10-10T20:00:01Z"),
            connection("late-discovery", .google, download: 5000, start: "2026-10-10T19:00:00Z"),
            connection("unknown-start", .slack, download: 500)
        ]), at: at.addingTimeInterval(4))
        let services = Dictionary(uniqueKeysWithValues: ledger.services(.all, now: at).map { ($0.service.rawValue, $0.bytes) })
        XCTAssertEqual(services["gpt"], 30)
        XCTAssertEqual(services["claude"], 30)
        XCTAssertNil(services["google"])
        XCTAssertNil(services["slack"])
        XCTAssertEqual(services.values.reduce(0, +), 60)
        XCTAssertEqual(ledger.total(.all, now: at).total, 110)
    }

    func testConflictingServiceCountersAreUnassignedRatherThanRescaled() {
        let dir = temporaryDirectory(); defer { try? FileManager.default.removeItem(at: dir) }
        let ledger = UsageLedger(directory: dir), at = date("2026-10-10T20:00:00Z")
        ledger.observe(snapshot(0, 0, connections: [connection("x", .gpt)]), at: at)
        ledger.observe(snapshot(0, 10, connections: [connection("x", .gpt, download: 100)]), at: at.addingTimeInterval(4))
        XCTAssertEqual(ledger.total(.all, now: at).total, 10)
        XCTAssertTrue(ledger.services(.all, now: at).isEmpty)
    }

    func testMidnightUsesTimeProportionAndPeriodWindows() {
        let dir = temporaryDirectory(); defer { try? FileManager.default.removeItem(at: dir) }
        let ledger = UsageLedger(directory: dir)
        let midnight = Calendar.current.startOfDay(for: date("2026-10-11T20:00:00Z"))
        ledger.observe(snapshot(0, 0), at: midnight.addingTimeInterval(-10))
        ledger.observe(snapshot(40, 60), at: midnight.addingTimeInterval(10))
        XCTAssertEqual(ledger.days.count, 2)
        XCTAssertEqual(ledger.total(.today, now: midnight).total, 50, accuracy: 0.000001)
        XCTAssertEqual(ledger.total(.week, now: midnight).total, 100, accuracy: 0.000001)
        XCTAssertEqual(ledger.total(.week, now: midnight.addingTimeInterval(8 * 86400)).total, 0)
        XCTAssertEqual(ledger.total(.month, now: midnight.addingTimeInterval(8 * 86400)).total, 100)
    }

    func testPersistenceRetainsRecordedDaysButRestartNeedsNewBaseline() throws {
        let dir = temporaryDirectory(); defer { try? FileManager.default.removeItem(at: dir) }
        let at = date("2026-10-10T20:00:00Z")
        let first = UsageLedger(directory: dir)
        first.observe(snapshot(0, 0), at: at)
        first.observe(snapshot(10, 20), at: at.addingTimeInterval(4))
        let restored = UsageLedger(directory: dir)
        XCTAssertEqual(restored.startedAt, at)
        XCTAssertEqual(restored.total(.all, now: at).total, 30)
        restored.observe(snapshot(1000, 2000), at: at.addingTimeInterval(8))
        XCTAssertEqual(restored.total(.all, now: at).total, 30)
        let directoryAttributes = try FileManager.default.attributesOfItem(atPath: dir.path)
        let fileAttributes = try FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent("usage.json").path)
        XCTAssertEqual((directoryAttributes[.posixPermissions] as? NSNumber)?.intValue, 0o700)
        XCTAssertEqual((fileAttributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: dir.path).allSatisfy { $0 == "usage.json" })
    }

    func testCorruptRecordIsPreserved() throws {
        let dir = temporaryDirectory(); defer { try? FileManager.default.removeItem(at: dir) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("usage.json"), original = Data("invalid-json".utf8)
        try original.write(to: file)
        let ledger = UsageLedger(directory: dir), at = date("2026-10-10T20:00:00Z")
        ledger.observe(snapshot(0, 0), at: at)
        ledger.observe(snapshot(1, 2), at: at.addingTimeInterval(4))
        XCTAssertNotNil(ledger.persistenceError)
        XCTAssertEqual(ledger.total(.all, now: at).total, 3)
        XCTAssertEqual(try Data(contentsOf: file), original)
    }

    func testPermanentCumulativeUsageSurvivesMoreThanOneYear() {
        let dir = temporaryDirectory(); defer { try? FileManager.default.removeItem(at: dir) }
        let ledger = UsageLedger(directory: dir), old = date("2025-10-10T20:00:00Z")
        ledger.observe(snapshot(0, 0), at: old)
        ledger.observe(snapshot(0, 10), at: old.addingTimeInterval(4))
        XCTAssertEqual(ledger.days.count, 1)
        let now = date("2026-10-12T20:00:00Z")
        ledger.observe(snapshot(0, 1000), at: now)
        XCTAssertEqual(ledger.days.count, 1)
        XCTAssertEqual(ledger.total(.all, now: now).total, 10)
        ledger.observe(snapshot(0, 1010), at: now.addingTimeInterval(4))
        XCTAssertEqual(ledger.days.count, 2)
        XCTAssertEqual(ledger.total(.all, now: now).total, 20)
        XCTAssertEqual(ledger.total(.week, now: now).total, 10)
        let restored = UsageLedger(directory: dir)
        XCTAssertEqual(restored.total(.all, now: now).total, 20)
        XCTAssertEqual(restored.days.count, 2)
    }
    func testNodeUsageFollowsActualNodeAndPersistsWithoutBackfillingOldHistory() throws {
        let dir = temporaryDirectory(); defer { try? FileManager.default.removeItem(at: dir) }
        let ledger = UsageLedger(directory: dir), at = date("2026-10-10T20:00:00Z")
        var a = connection("a", .gpt), b = connection("b", .google)
        a.nodeID = "la-a"; a.nodeName = "洛杉矶 A"
        b.nodeID = "azure"; b.nodeName = "Azure"
        ledger.observe(snapshot(0, 0, connections: [a, b]), at: at)
        a.download = 70; b.download = 20
        ledger.observe(snapshot(0, 100, connections: [a, b]), at: at.addingTimeInterval(4))
        XCTAssertEqual(ledger.nodes(.today, now: at).first?.id, "la-a")
        XCTAssertEqual(ledger.nodes(.all, now: at).reduce(0) { $0 + $1.bytes }, 90)
        let restored = UsageLedger(directory: dir)
        XCTAssertEqual(restored.nodes(.all, now: at).first?.bytes, 70)
        // A changing chain on the same connection cannot establish which node carried the interval.
        a.nodeID = "panda"; a.nodeName = "潘达"; a.download = 90
        ledger.observe(snapshot(0, 120, connections: [a, b]), at: at.addingTimeInterval(8))
        XCTAssertFalse(ledger.nodes(.all, now: at).contains { $0.id == "panda" })
        XCTAssertEqual(ledger.total(.all, now: at).total, 120)
        let file = dir.appendingPathComponent("usage.json")
        var json = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
        json["version"] = 1
        json["days"] = (json["days"] as! [[String: Any]]).map { day in
            var copy = day; copy.removeValue(forKey: "nodeBytes"); copy.removeValue(forKey: "nodeNames"); return copy
        }
        try JSONSerialization.data(withJSONObject: json).write(to: file)
        let legacy = UsageLedger(directory: dir)
        XCTAssertNil(legacy.persistenceError)
        XCTAssertEqual(legacy.total(.all, now: at).total, 120)
        XCTAssertTrue(legacy.nodes(.all, now: at).isEmpty)
    }

    func testNodeUsageSharesMidnightAndRejectsConflictingCounters() {
        let dir = temporaryDirectory(); defer { try? FileManager.default.removeItem(at: dir) }
        let ledger = UsageLedger(directory: dir)
        let midnight = Calendar.current.startOfDay(for: date("2026-10-11T20:00:00Z"))
        var c = connection("a", .gpt); c.nodeID = "la-a"; c.nodeName = "洛杉矶 A"
        ledger.observe(snapshot(0, 0, connections: [c]), at: midnight.addingTimeInterval(-10))
        c.download = 100
        ledger.observe(snapshot(0, 100, connections: [c]), at: midnight.addingTimeInterval(10))
        XCTAssertEqual(ledger.nodes(.today, now: midnight).first?.bytes, 50)
        c.download = 1000
        ledger.observe(snapshot(0, 110, connections: [c]), at: midnight.addingTimeInterval(14))
        XCTAssertEqual(ledger.nodes(.all, now: midnight).first?.bytes, 100)
    }

}
