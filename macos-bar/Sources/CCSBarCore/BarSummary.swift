import Foundation

/// One account row in the menu-bar glance.
///
/// Mirrors the `GET /api/bar/summary` payload exactly (mixed snake_case and
/// camelCase keys, matching the CCS web-server response).
public struct BarSummaryRow: Codable, Sendable, Identifiable, Equatable {
  public let accountId: String
  public let provider: String
  public let displayName: String?
  public let tier: String?
  public let paused: Bool
  public let quotaPercentage: Double?
  public let nextReset: String?
  public let todayCost: Double?
  public let health: String
  public let cached: Bool
  public let fetchedAt: String?
  public let needsReauth: Bool

  /// Stable identity for SwiftUI lists: provider-scoped account id.
  public var id: String { "\(provider):\(accountId)" }

  enum CodingKeys: String, CodingKey {
    case accountId = "account_id"
    case provider
    case displayName
    case tier
    case paused
    case quotaPercentage = "quota_percentage"
    case nextReset = "next_reset"
    case todayCost = "today_cost"
    case health
    case cached
    case fetchedAt
    case needsReauth
  }

  public init(
    accountId: String,
    provider: String,
    displayName: String? = nil,
    tier: String? = nil,
    paused: Bool = false,
    quotaPercentage: Double? = nil,
    nextReset: String? = nil,
    todayCost: Double? = nil,
    health: String = "ok",
    cached: Bool = false,
    fetchedAt: String? = nil,
    needsReauth: Bool = false
  ) {
    self.accountId = accountId
    self.provider = provider
    self.displayName = displayName
    self.tier = tier
    self.paused = paused
    self.quotaPercentage = quotaPercentage
    self.nextReset = nextReset
    self.todayCost = todayCost
    self.health = health
    self.cached = cached
    self.fetchedAt = fetchedAt
    self.needsReauth = needsReauth
  }
}

extension BarSummaryRow {
  /// Health rendered as an ASCII-safe dot for the dropdown.
  public var healthDot: String {
    switch health {
    case "error": return "X"
    case "warning": return "!"
    default: return "OK"
    }
  }
}
