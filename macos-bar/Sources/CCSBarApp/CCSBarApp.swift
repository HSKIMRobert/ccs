import SwiftUI

/// CCS Bar entry point. A menu-bar-only app (no dock icon) whose title shows
/// the leading account's quota and today's total cost, with a dropdown for
/// per-account detail and control.
@main
struct CCSBarApp: App {
  @StateObject private var viewModel = BarViewModel()

  var body: some Scene {
    MenuBarExtra {
      BarMenuView(viewModel: viewModel)
    } label: {
      Text(viewModel.statusTitle)
    }
    .menuBarExtraStyle(.window)
  }
}
