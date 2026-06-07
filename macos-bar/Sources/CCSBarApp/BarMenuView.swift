import SwiftUI
import AppKit
import CCSBarCore

/// Dropdown content for the menu bar: per-account rows + actions, an offline
/// state when CCS isn't running, and footer controls.
struct BarMenuView: View {
  @ObservedObject var viewModel: BarViewModel

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      header

      if viewModel.offline {
        offlineState
      } else if viewModel.rows.isEmpty {
        Text("No accounts found")
          .foregroundStyle(.secondary)
      } else {
        ForEach(viewModel.rows) { row in
          BarRowView(row: row, viewModel: viewModel)
          Divider()
        }
      }

      footer
    }
    .padding(12)
    .frame(width: 320)
    .onAppear { viewModel.onOpen() }
  }

  private var header: some View {
    HStack {
      Text("CCS").font(.headline)
      Spacer()
      if viewModel.isRefreshing {
        Text("refreshing…").font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private var offlineState: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("CCS is not running").font(.body)
      Text("Start CCS, then reopen this menu.")
        .font(.caption)
        .foregroundStyle(.secondary)
      Button("Retry") { viewModel.reconnect(); viewModel.onOpen() }
    }
  }

  private var footer: some View {
    VStack(alignment: .leading, spacing: 4) {
      Button("Open dashboard") { openDashboard() }
      Button("Refresh") { viewModel.onOpen() }
      Button("Quit") { NSApplication.shared.terminate(nil) }
    }
  }

  private func openDashboard() {
    // The dashboard runs on the same host/port the bar reads from discovery.
    if case .success(let discovery) = BarDiscovery.load(), let url = discovery.resolvedURL {
      NSWorkspace.shared.open(url)
    }
  }
}

/// One account row: health dot, name, provider/tier/quota/paused subline, and
/// a control menu.
struct BarRowView: View {
  let row: BarSummaryRow
  @ObservedObject var viewModel: BarViewModel

  var body: some View {
    HStack(alignment: .top) {
      Text(row.healthDot)
        .font(.system(.caption, design: .monospaced))
        .frame(width: 22, alignment: .leading)

      VStack(alignment: .leading, spacing: 2) {
        Text(row.displayName ?? row.accountId)
          .font(.body)
          .lineLimit(1)
        Text(subline)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }

      Spacer()

      Menu("Actions") {
        if row.paused {
          Button("Resume") { viewModel.resume(row) }
        } else {
          Button("Pause") { viewModel.pause(row) }
        }
        Button("Set as default") { viewModel.setDefault(row) }
        Button("Solo (pause others)") { viewModel.solo(row) }
        if let tier = row.tier {
          Button("Lock to \(tier)") { viewModel.tierLock(row, tier: tier) }
        }
        Button("Clear tier lock") { viewModel.tierLock(row, tier: nil) }
      }
      .menuStyle(.borderlessButton)
      .frame(width: 90)
    }
  }

  private var subline: String {
    var parts: [String] = [row.provider]
    if let tier = row.tier { parts.append(tier) }
    parts.append(BarFormatting.quotaLabel(row.quotaPercentage))
    let cost = BarFormatting.costLabel(row.todayCost)
    if !cost.isEmpty { parts.append(cost) }
    if row.paused { parts.append("paused") }
    if row.needsReauth { parts.append("needs reauth") }
    return parts.joined(separator: " \u{00B7} ")
  }
}
