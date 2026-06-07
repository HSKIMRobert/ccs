import Foundation
import SwiftUI
import CCSBarCore

/// Observable state for the menu bar. Holds the last-known rows for instant
/// paint, reconnects to the CCS web-server via the discovery file, and fires a
/// debounced force-refresh when the menu opens.
@MainActor
final class BarViewModel: ObservableObject {
  @Published var rows: [BarSummaryRow] = []
  @Published var offline = false
  @Published var lastError: String?
  @Published var isRefreshing = false

  private let home: String
  private var client: CCSBarClient?
  private var debouncer = RefreshDebouncer(interval: 15)

  init(home: String = NSHomeDirectory()) {
    self.home = home
    reconnect()
  }

  /// Compact status-bar title.
  var statusTitle: String {
    offline ? "CCS offline" : BarFormatting.statusTitle(rows: rows)
  }

  /// Resolve the discovery file and (re)build the client. Marks offline when
  /// CCS hasn't been launched.
  func reconnect() {
    switch BarDiscovery.load(home: home) {
    case .success(let discovery):
      if let url = discovery.resolvedURL {
        client = CCSBarClient(baseURL: url)
        offline = false
      } else {
        client = nil
        offline = true
      }
    case .failure:
      client = nil
      offline = true
    }
  }

  /// Menu opened: cached rows are already on screen; fire a debounced
  /// force-refresh so the glance reflects live provider data.
  func onOpen() {
    let force = debouncer.shouldRefresh(now: Date())
    Task { await load(force: force) }
  }

  func load(force: Bool) async {
    if client == nil { reconnect() }
    guard let client else {
      offline = true
      return
    }
    if force { isRefreshing = true }
    defer { isRefreshing = false }
    do {
      rows = try await client.summary(refresh: force)
      offline = false
      lastError = nil
    } catch {
      lastError = describe(error)
      // Keep the last rows visible (instant cached paint); only flip to the
      // offline state when there is nothing to show.
      if rows.isEmpty { offline = true }
    }
  }

  // MARK: Account actions

  func pause(_ row: BarSummaryRow) {
    perform { try await $0.pause(provider: row.provider, accountId: row.accountId) }
  }
  func resume(_ row: BarSummaryRow) {
    perform { try await $0.resume(provider: row.provider, accountId: row.accountId) }
  }
  func solo(_ row: BarSummaryRow) {
    perform { try await $0.solo(provider: row.provider, accountId: row.accountId) }
  }
  func setDefault(_ row: BarSummaryRow) {
    perform { try await $0.setDefault(name: row.accountId) }
  }
  func tierLock(_ row: BarSummaryRow, tier: String?) {
    perform { try await $0.tierLock(provider: row.provider, tier: tier) }
  }

  private func perform(_ op: @escaping (CCSBarClient) async throws -> Void) {
    guard let client else { return }
    Task {
      do {
        try await op(client)
        await load(force: true)
      } catch {
        lastError = describe(error)
      }
    }
  }

  private func describe(_ error: Error) -> String {
    String(describing: error)
  }
}
