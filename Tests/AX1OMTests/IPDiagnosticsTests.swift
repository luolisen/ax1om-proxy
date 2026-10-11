import XCTest
@testable import AX1OM

final class IPDiagnosticsTests: XCTestCase {
    func testMissingEvidenceStaysUnknownAndAdapterExtensionsDecode() throws {
        let data = Data(#"{"capturedAt":"2026-10-10T00:00:00Z","exits":[{"id":"claude","title":"Claude trace","ip":null,"detail":"未验证","source":"claude.ai","state":"未验证"}],"attributes":[],"security":[],"score":null,"availability":[],"dns":{"state":"未实测","detail":"没有浏览器权威检测"},"webrtc":{"state":"未实测","detail":"没有 ICE 检测"},"errors":[],"checks":[{"id":"dns-records","title":"64 / 65","state":"有限实测","detail":"NOERROR / answer=0"}],"path":{"state":"现有代理","detail":"当前分流","proxyPort":7897},"dnsProbe":[{"host":"claude.ai","type":65,"state":"NOERROR","rcode":0,"answerCount":0},{"host":"example.com","type":1,"state":"超时","rcode":null,"answerCount":null}],"receivedBytes":100}"#.utf8)
        let value = try JSONDecoder().decode(IPDiagnosticsSnapshot.self, from: data)
        XCTAssertNil(value.score)
        XCTAssertNil(value.exits.first?.ip)
        XCTAssertEqual(value.dns.state, "未实测")
        XCTAssertEqual(value.webrtc.state, "未实测")
        XCTAssertEqual(value.checks?.first?.id, "dns-records")
        XCTAssertEqual(value.path?.state, "现有代理")
        XCTAssertEqual(value.dnsProbe?.first?.answerCount, 0)
        XCTAssertEqual(value.dnsProbe?.first?.type, 65)
        XCTAssertNil(value.dnsProbe?.last?.answerCount)
    }

    func testExpiredConnectionReceiptIsNotSuccess() throws {
        let value = try JSONDecoder().decode(ConnectionCloseReceipt.self, from: Data(#"{"success":false,"message":"连接已结束"}"#.utf8))
        XCTAssertFalse(value.success)
    }
}
