import XCTest
@testable import AX1OM

final class UsageDayBreakdownTests: XCTestCase {
    func testDailySharesUseWholeDayIncludingUnassignedTraffic() {
        let day = UsageDay(id: "test", date: Date(), upload: 200, download: 800, serviceBytes: ["gpt": 500, "google": 200])
        let value = UsageDayBreakdown(day: day, maximum: 2000)
        XCTAssertEqual(value.total, 1000)
        XCTAssertEqual(value.unassigned, 300)
        XCTAssertEqual(value.share(500), 0.5)
        XCTAssertEqual(value.level, 2)
        XCTAssertEqual(value.services.first?.service, .gpt)
    }
    func testAbsentRecordDoesNotBecomeZeroRecordedDay() {
        XCTAssertNil(UsageDayBreakdown(day: nil, maximum: 10).level)
        let zero = UsageDay(id: "zero", date: Date(), upload: 0, download: 0, serviceBytes: [:])
        let value = UsageDayBreakdown(day: zero, maximum: 10)
        XCTAssertEqual(value.level, 0)
        XCTAssertEqual(value.share(0), 0)
        XCTAssertTrue(value.services.isEmpty)
    }
}
