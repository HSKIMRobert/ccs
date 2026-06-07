import Foundation
import CCSBarCore

// Lightweight assert harness used in place of XCTest (unavailable without a
// full Xcode install). Run with `swift run ccs-bar-check`; exits non-zero on
// any failure so it works as a CI/test gate on a CommandLineTools toolchain.

var failures = 0
func check(_ condition: Bool, _ message: String) {
  if condition {
    print("[OK] \(message)")
  } else {
    print("[X] \(message)")
    failures += 1
  }
}

// Recording transport so CCSBarClient can be exercised without a live server.
final class RequestRecorder: @unchecked Sendable {
  var lastRequest: URLRequest?
  var responseData = Data("[]".utf8)
  var status = 200
}
struct RecordingTransport: HTTPTransport {
  let recorder: RequestRecorder
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    recorder.lastRequest = request
    let http = HTTPURLResponse(
      url: request.url!, statusCode: recorder.status, httpVersion: nil, headerFields: nil)!
    return (recorder.responseData, http)
  }
}

// MARK: BarSummaryRow decoding (mixed snake_case / camelCase keys)

let summaryJSON = """
[
  {
    "account_id": "alice@example.com",
    "provider": "agy",
    "displayName": "Alice (Ultra)",
    "tier": "ultra",
    "paused": false,
    "quota_percentage": 82.4,
    "next_reset": "2026-06-08T00:00:00Z",
    "today_cost": 3.2,
    "health": "ok",
    "cached": true,
    "fetchedAt": "2026-06-07T19:00:00Z",
    "needsReauth": false
  },
  {
    "account_id": "bob@example.com",
    "provider": "codex",
    "displayName": null,
    "tier": null,
    "paused": true,
    "quota_percentage": null,
    "next_reset": null,
    "today_cost": null,
    "health": "warning",
    "cached": false,
    "fetchedAt": null,
    "needsReauth": true
  }
]
"""

do {
  let rows = try JSONDecoder().decode([BarSummaryRow].self, from: Data(summaryJSON.utf8))
  check(rows.count == 2, "decodes two rows")
  check(rows[0].accountId == "alice@example.com", "maps account_id")
  check(rows[0].quotaPercentage == 82.4, "maps quota_percentage")
  check(rows[0].todayCost == 3.2, "maps today_cost")
  check(rows[0].id == "agy:alice@example.com", "stable id is provider:account")
  check(rows[1].quotaPercentage == nil, "null quota decodes to nil")
  check(rows[1].paused == true, "maps paused")
  check(rows[1].needsReauth == true, "maps needsReauth")
  check(rows[1].healthDot == "!", "warning -> ! dot")
  check(rows[0].healthDot == "OK", "ok -> OK dot")
} catch {
  check(false, "decoding threw: \(error)")
}

// MARK: BarDiscovery loading

let tmp = NSTemporaryDirectory() + "ccs-bar-check-\(ProcessInfo.processInfo.globallyUniqueString)"
let ccsDir = tmp + "/.ccs"
try? FileManager.default.createDirectory(atPath: ccsDir, withIntermediateDirectories: true)
let barJSON = """
{ "baseUrl": "http://127.0.0.1:3210", "port": 3210, "authMode": "loopback" }
"""
try? barJSON.write(toFile: ccsDir + "/bar.json", atomically: true, encoding: .utf8)

switch BarDiscovery.load(home: tmp) {
case .success(let d):
  check(d.port == 3210, "discovery reads port")
  check(d.authMode == "loopback", "discovery reads authMode")
  check(d.resolvedURL?.absoluteString == "http://127.0.0.1:3210", "resolvedURL from baseUrl")
case .failure(let e):
  check(false, "discovery load failed: \(e)")
}

let missingHome = NSTemporaryDirectory() + "ccs-bar-check-missing-\(ProcessInfo.processInfo.globallyUniqueString)"
switch BarDiscovery.load(home: missingHome) {
case .failure(.missing):
  check(true, "absent bar.json -> .missing (offline state)")
case .success:
  check(false, "expected .missing for absent file")
case .failure(let e):
  check(false, "expected .missing, got \(e)")
}

// MARK: BarFormatting

check(BarFormatting.quotaLabel(82.4) == "82%", "quota label rounds")
check(BarFormatting.quotaLabel(nil) == "--", "nil quota -> --")
check(BarFormatting.costLabel(3.2) == "$3.20", "cost label formats")
check(BarFormatting.costLabel(0) == "", "zero cost hidden")
check(BarFormatting.costLabel(nil) == "", "nil cost hidden")

do {
  let rows = try JSONDecoder().decode([BarSummaryRow].self, from: Data(summaryJSON.utf8))
  let title = BarFormatting.statusTitle(rows: rows)
  // Active rows only (bob is paused); alice leads. Total cost = 3.2.
  check(title.contains("agy 82%"), "title shows leading active account + quota")
  check(title.contains("$3.20"), "title shows total cost")
}

// MARK: RefreshDebouncer (arms at decision time)

var deb = RefreshDebouncer(interval: 15)
let t0 = Date(timeIntervalSince1970: 1000)
check(deb.shouldRefresh(now: t0), "first force-refresh proceeds")
check(!deb.shouldRefresh(now: t0.addingTimeInterval(5)), "within 15s blocked")
check(!deb.shouldRefresh(now: t0.addingTimeInterval(14.9)), "just before window end blocked")
check(deb.shouldRefresh(now: t0.addingTimeInterval(15)), "at/after 15s proceeds")

// MARK: CCSBarClient (recording transport)

let recorder = RequestRecorder()
recorder.responseData = Data(summaryJSON.utf8)
let client = CCSBarClient(
  baseURL: URL(string: "http://127.0.0.1:3210")!,
  transport: RecordingTransport(recorder: recorder)
)

do {
  let rows = try await client.summary(refresh: true)
  check(rows.count == 2, "client.summary decodes rows")
  check(
    recorder.lastRequest?.url?.query?.contains("refresh=true") == true,
    "summary(refresh: true) adds ?refresh=true")
} catch {
  check(false, "client.summary threw: \(error)")
}

recorder.responseData = Data("{}".utf8)
recorder.lastRequest = nil
do {
  try await client.pause(provider: "agy", accountId: "alice@example.com")
  check(recorder.lastRequest?.httpMethod == "POST", "pause is POST")
  check(
    recorder.lastRequest?.url?.path.hasSuffix("bulk-pause") == true,
    "pause hits bulk-pause endpoint")
} catch {
  check(false, "pause threw: \(error)")
}

recorder.lastRequest = nil
do {
  try await client.tierLock(provider: "agy", tier: nil)
  let body = recorder.lastRequest?.httpBody ?? Data()
  let obj = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
  check(obj?["tier"] is NSNull, "tierLock(nil) serializes tier: null")
  check((obj?["provider"] as? String) == "agy", "tierLock sends provider")
} catch {
  check(false, "tierLock threw: \(error)")
}

recorder.status = 409
do {
  _ = try await client.summary(refresh: false)
  check(false, "non-200 summary should throw")
} catch CCSBarClientError.httpStatus(let code) {
  check(code == 409, "non-200 -> httpStatus(409)")
} catch {
  check(false, "wrong error type: \(error)")
}
recorder.status = 200

// cleanup
try? FileManager.default.removeItem(atPath: tmp)

if failures > 0 {
  print("\nFAILED: \(failures) check(s)")
  exit(1)
} else {
  print("\nALL CHECKS PASSED")
  exit(0)
}
