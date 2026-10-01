import XCTest
@testable import ParentCore

final class ParentCoreTests: XCTestCase {
    func testOriginKeepsCredentialsOnConfiguredSecureOrigin() {
        XCTAssertNotNil(ParentEndpoint.origin("https://school.example", allowLocalHTTP: false))
        XCTAssertNil(ParentEndpoint.origin("http://school.example", allowLocalHTTP: true))
        var credentialsInURL = URLComponents(string: "https://school.example")!
        credentialsInURL.user = "fixture-user"
        credentialsInURL.password = "fixture-password"
        XCTAssertNil(ParentEndpoint.origin(credentialsInURL.string!, allowLocalHTTP: false))
        XCTAssertNil(ParentEndpoint.origin("https://school.example/path", allowLocalHTTP: false))
        XCTAssertNil(ParentEndpoint.origin("https://school.example?redirect=other", allowLocalHTTP: false))
    }

    func testLocalDevelopmentOriginRejectsPublicAndIPLookalikeHosts() {
        XCTAssertNotNil(ParentEndpoint.origin("http://192.168.1.2:3130", allowLocalHTTP: true))
        XCTAssertNotNil(ParentEndpoint.origin("http://localhost:3130", allowLocalHTTP: true))
        XCTAssertNil(ParentEndpoint.origin("http://192.168.1.2:3130", allowLocalHTTP: false))
        XCTAssertNil(ParentEndpoint.origin("http://192.168.1.2.example.invalid", allowLocalHTTP: true))
        XCTAssertNil(ParentEndpoint.origin("http://8.8.8.8", allowLocalHTTP: true))
        XCTAssertNil(ParentEndpoint.origin("http://192.168.999.1", allowLocalHTTP: true))
    }

    func testAssignmentIdentityAndFilterUseChildID() {
        let a = ParentPractice(id: "same-assignment", participantId: "child-a", participantName: "Same name", title: "Practice", instructions: "", dueAt: nil, submittedAt: nil)
        let b = ParentPractice(id: "same-assignment", participantId: "child-b", participantName: "Same name", title: "Practice", instructions: "", dueAt: nil, submittedAt: "2026-10-01T08:00:00Z")
        XCTAssertNotEqual(a.identity, b.identity)
        XCTAssertEqual(ParentFilter.practices([a, b], participantID: "child-a", state: "pending"), [a])
        XCTAssertTrue(ParentFilter.practices([a, b], participantID: "child-a", state: "submitted").isEmpty)
    }

    func testLegacyReportsDoNotFallBackToNames() throws {
        let json = """
        [{"id":"a","participantId":"child-a","kind":"assessment","title":"Report","participantName":"Same name","date":"2026-10-01T08:00:00Z","summary":"","strengths":"","focusAreas":"","recommendation":"","score":null,"totalScore":null},
        {"id":"old","kind":"assessment","title":"Report","participantName":"Same name","date":"2026-10-01T08:00:00Z","summary":"","strengths":"","focusAreas":"","recommendation":"","score":null,"totalScore":null}]
        """
        let rows = try JSONDecoder().decode([ParentReport].self, from: Data(json.utf8))
        XCTAssertEqual(ParentFilter.reports(rows, participantID: "child-a").map(\.id), ["a"])
        XCTAssertTrue(ParentFilter.reports(rows, participantID: "child-b").isEmpty)
    }

    func testStringLimitsMatchHTTPUTF16AfterTrimming() {
        XCTAssertEqual(ParentValidation.textLength("  好的  "), 2)
        XCTAssertEqual(ParentValidation.textLength(" 😀 "), 2)
        XCTAssertGreaterThan(ParentValidation.textLength(String(repeating: "😀", count: 501)), 1000)
        XCTAssertEqual(ParentValidation.textLength(" \n "), 0)
    }

    func testUncertainNonIdempotentWritesRequireCheckingRecords() {
        for code in ["NETWORK", "INVALID_RESPONSE", "UNAVAILABLE"] { XCTAssertTrue(ParentValidation.uncertainWrite(code)) }
        for code in ["VALIDATION", "FORBIDDEN", "CONFLICT"] { XCTAssertFalse(ParentValidation.uncertainWrite(code)) }
    }

    func testDateParsingAndCalendarIncludeLeapDay() throws {
        XCTAssertNotNil(ParentDate.parse("2026-10-01T08:00:00.123Z"))
        XCTAssertNotNil(ParentDate.parse("2026-10-01T08:00:00+08:00"))
        XCTAssertNil(ParentDate.parse("invalid"))
        let february = try XCTUnwrap(ParentDate.calendar.date(from: DateComponents(year: 2028, month: 2, day: 12)))
        let days = ParentDate.monthDays(february).compactMap { $0 }
        XCTAssertEqual(days.count, 29)
        XCTAssertEqual(days.map { ParentDate.calendar.component(.day, from: $0) }, Array(1...29))
    }
}
