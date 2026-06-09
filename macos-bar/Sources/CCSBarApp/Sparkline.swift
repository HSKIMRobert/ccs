import SwiftUI

/// A compact bar sparkline for daily values (e.g. cost per day over 7 days).
/// Zero-value days render as faint placeholders so the cadence stays readable.
struct Sparkline: View {
  let values: [Double]
  var accent: Color = BarTheme.accent

  var body: some View {
    GeometryReader { geo in
      let peak = max(values.max() ?? 0, 0.0001)
      HStack(alignment: .bottom, spacing: 3) {
        ForEach(Array(values.enumerated()), id: \.offset) { _, value in
          let height = CGFloat(value / peak) * geo.size.height
          RoundedRectangle(cornerRadius: 2)
            .fill(value > 0 ? accent : Color.secondary.opacity(0.2))
            .frame(height: max(2, height))
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    }
  }
}

/// Shared visual tokens for the menu. The accent matches the CCS logo orange.
enum BarTheme {
  static let accent = Color(red: 0.886, green: 0.451, blue: 0.137) // ~#E2732A
  /// Distinct tint for native first-party subscription rows (Claude Code / Codex)
  /// so the user's own plan reads apart from CLIProxy pool accounts. A cool indigo
  /// contrasts with the warm orange accent used for everything else.
  static let subscription = Color(red: 0.357, green: 0.388, blue: 0.851) // ~#5B63D9

  /// Headroom palette for quota bars. Muted for the dark surface (raw system
  /// green/yellow/orange/red read garish here) and intuitive green→amber→coral→red.
  /// Deliberately leans coral/red for "low" rather than the brand orange, so a
  /// nearly-empty window never gets mistaken for the accent.
  static let bandGreen = Color(red: 0.36, green: 0.74, blue: 0.56) // ~#5CBC8F emerald
  static let bandAmber = Color(red: 0.86, green: 0.67, blue: 0.31) // ~#DBAB4F gold
  static let bandCoral = Color(red: 0.91, green: 0.46, blue: 0.36) // ~#E8755C warning
  static let bandRed = Color(red: 0.85, green: 0.34, blue: 0.31) // ~#D9564F critical

  /// Neutral elevated surface for the subscription card — a faint light lift
  /// rather than a colored wash, so the warm headroom bars read cleanly on top.
  static let cardSurface = Color.primary.opacity(0.05)
}
