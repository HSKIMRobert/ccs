import Foundation

/// Pure formatting helpers for the status-bar title and dropdown rows.
/// No SwiftUI dependency so they are unit-testable on any toolchain.
public enum BarFormatting {
  /// Quota percentage label, e.g. "82%" or "--" when unknown.
  public static func quotaLabel(_ pct: Double?) -> String {
    guard let pct else { return "--" }
    return "\(Int(pct.rounded()))%"
  }

  /// Today cost label, e.g. "$3.20" or "" when unknown/zero-not-shown.
  public static func costLabel(_ cost: Double?) -> String {
    guard let cost, cost > 0 else { return "" }
    return String(format: "$%.2f", cost)
  }

  /// Compact status-bar title. Shows the most-used (lowest remaining quota)
  /// active account, plus today's total cost when available.
  /// Example: "agy 82% · $3.20". Falls back to "CCS" when there are no rows.
  public static func statusTitle(rows: [BarSummaryRow]) -> String {
    let active = rows.filter { !$0.paused }
    guard let lead = leadRow(active.isEmpty ? rows : active) else { return "CCS" }
    var parts: [String] = []
    let q = quotaLabel(lead.quotaPercentage)
    parts.append("\(lead.provider) \(q)")
    let total = rows.compactMap { $0.todayCost }.reduce(0, +)
    let cost = costLabel(total)
    if !cost.isEmpty { parts.append(cost) }
    return parts.joined(separator: " \u{00B7} ")
  }

  /// The row to surface in the compact title: the one closest to exhaustion
  /// (highest quota used). Rows without a known percentage sort last.
  static func leadRow(_ rows: [BarSummaryRow]) -> BarSummaryRow? {
    rows.max { lhs, rhs in
      (lhs.quotaPercentage ?? -1) < (rhs.quotaPercentage ?? -1)
    }
  }
}

/// Force-refresh debounce. Arms the window at decision time so concurrent
/// open-triggered refreshes do not both bypass it (matches the server-side
/// 15s debounce on `/api/bar/summary?refresh=true`).
public struct RefreshDebouncer {
  public let interval: TimeInterval
  private var lastArmed: Date?

  public init(interval: TimeInterval = 15) {
    self.interval = interval
  }

  /// Returns true and arms the window if a force-refresh should proceed at
  /// `now`; returns false when still inside the previous window.
  public mutating func shouldRefresh(now: Date) -> Bool {
    if let lastArmed, now.timeIntervalSince(lastArmed) < interval {
      return false
    }
    lastArmed = now
    return true
  }
}
