import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The widget's App Group must match the one the plugin actually provisions.
 *
 * `@bittingz/expo-widgets` derives the entitlement as
 * `group.${ios.bundleIdentifier}.expowidgets` (plugin/src/ios/withAppGroupPermissions.ts).
 * `RizzWidgets.swift` hardcodes the suite it reads. Nothing connects the two, so they
 * drifted: the Swift side carried `com.rizzcoach.app` — the ANDROID package — against an
 * iOS bundle id of `com.rizzcoach.chat`. `UserDefaults(suiteName:)` does not throw for a
 * suite you are not entitled to, it just never has the data, so `load()` returned nil on
 * every device and the widget rendered its fallback line forever. tsc cannot see across a
 * language boundary and no other check reads either file.
 *
 * Run: node widgets/appGroup.selfcheck.ts
 */

const bundleId: string = JSON.parse(readFileSync('app.json', 'utf8')).expo.ios.bundleIdentifier;
const swift = readFileSync('widgets/ios/RizzWidgets.swift', 'utf8');

const declared = /static let appGroup = "([^"]+)"/.exec(swift)?.[1];
assert.ok(declared, 'RizzWidgets.swift no longer declares `static let appGroup` — rename?');

const expected = `group.${bundleId}.expowidgets`;
assert.equal(
  declared,
  expected,
  `App Group mismatch — the widget would read a suite it is not entitled to.\n` +
    `  app.json ios.bundleIdentifier : ${bundleId}\n` +
    `  plugin provisions             : ${expected}\n` +
    `  RizzWidgets.swift reads       : ${declared}`,
);

// The key the plugin writes. Changing it silently empties the widget the same way.
assert.match(swift, /static let dataKey = "widgetdata"/, 'dataKey must stay "widgetdata"');

console.log(`widget app group: ok — ${expected}`);
