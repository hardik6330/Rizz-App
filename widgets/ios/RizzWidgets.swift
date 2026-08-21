import SwiftUI
import WidgetKit

// MARK: - Widget bundle

@main
struct RizzWidgets: WidgetBundle {
    var body: some Widget {
        DailyOpenerWidget()
    }
}

// MARK: - Shared data

/// Payload written by the app via @bittingz/expo-widgets `setWidgetData`
/// (see src/services/widgetBridge.ts).
struct WidgetPayload: Codable {
    let opener: String
    let category: String
    let updatedAt: String
}

enum WidgetStore {
    /// ⚠️ Derived from `ios.bundleIdentifier`, NOT the Android package.
    ///
    /// The plugin builds the entitlement as `group.${ios.bundleIdentifier}.expowidgets`
    /// (expo-widgets/plugin/src/ios/withAppGroupPermissions.ts). This read
    /// `com.rizzcoach.app` — the ANDROID package — while the iOS bundle id is
    /// `com.rizzcoach.chat`, so the suite was never one the extension is entitled to:
    /// `load()` returned nil on every device and the widget only ever rendered the
    /// fallback below. Change `ios.bundleIdentifier` in app.json and this changes too.
    static let appGroup = "group.com.rizzcoach.chat.expowidgets"
    static let dataKey = "widgetdata"

    static func load() -> WidgetPayload? {
        guard
            let defaults = UserDefaults(suiteName: appGroup),
            let json = defaults.string(forKey: dataKey),
            let data = json.data(using: .utf8)
        else { return nil }
        return try? JSONDecoder().decode(WidgetPayload.self, from: data)
    }
}

// MARK: - Timeline

struct OpenerEntry: TimelineEntry {
    let date: Date
    let opener: String
    let category: String
}

struct DailyOpenerProvider: TimelineProvider {
    private let fallback = OpenerEntry(
        date: .now,
        opener: "Hot take: you look like you have strong opinions about pineapple on pizza. I need to hear them.",
        category: "OPENER"
    )

    func placeholder(in context: Context) -> OpenerEntry { fallback }

    func getSnapshot(in context: Context, completion: @escaping (OpenerEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OpenerEntry>) -> Void) {
        // Refresh shortly after midnight so a new opener lands each day.
        let nextMidnight = Calendar.current.startOfDay(for: .now.addingTimeInterval(86_400))
        completion(Timeline(entries: [currentEntry()], policy: .after(nextMidnight)))
    }

    private func currentEntry() -> OpenerEntry {
        guard let payload = WidgetStore.load() else { return fallback }
        return OpenerEntry(date: .now, opener: payload.opener, category: payload.category.uppercased())
    }
}

// MARK: - Views

struct DailyOpenerView: View {
    var entry: OpenerEntry
    @Environment(\.widgetFamily) private var family

    private let violet = Color(red: 0.545, green: 0.361, blue: 0.965)
    private let pink = Color(red: 1.0, green: 0.302, blue: 0.553)

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 9, weight: .heavy))
                    .foregroundStyle(violet)
                Text("DAILY OPENER")
                    .font(.system(size: 9, weight: .heavy))
                    .tracking(1.3)
                    .foregroundStyle(.secondary)
                Spacer()
            }

            Text(entry.opener)
                .font(.system(size: family == .systemSmall ? 13 : 15, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(family == .systemSmall ? 4 : 3)
                .minimumScaleFactor(0.75)

            Spacer(minLength: 0)

            HStack {
                Text(entry.category)
                    .font(.system(size: 8, weight: .heavy))
                    .tracking(1.1)
                    .foregroundStyle(violet)
                Spacer()
                Text("RizzCoach")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(2)
        .containerBackground(for: .widget) {
            LinearGradient(
                colors: [
                    Color(red: 0.10, green: 0.07, blue: 0.22),
                    Color(red: 0.04, green: 0.04, blue: 0.07),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .overlay(
                RadialGradient(
                    colors: [pink.opacity(0.22), .clear],
                    center: .topTrailing,
                    startRadius: 0,
                    endRadius: 160
                )
            )
        }
    }
}

// MARK: - Widget

struct DailyOpenerWidget: Widget {
    let kind = "DailyOpenerWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DailyOpenerProvider()) { entry in
            DailyOpenerView(entry: entry)
        }
        .configurationDisplayName("Daily Opener")
        .description("A fresh field-tested opener on your home screen, every day.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
