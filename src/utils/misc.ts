import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

/**
 * Share text cross-platform. RN's `Share` throws on web ("not supported"), so
 * there we use the Web Share API when present, else copy to the clipboard.
 * Returns 'copied' when it fell back to clipboard (caller may want to toast).
 */
export async function shareText(message: string): Promise<'shared' | 'copied'> {
  if (Platform.OS !== 'web') {
    await Share.share({ message });
    return 'shared';
  }
  const webShare = (globalThis.navigator as Navigator | undefined)?.share;
  if (webShare) {
    try {
      await webShare.call(globalThis.navigator, { text: message });
      return 'shared';
    } catch {
      // user dismissed the sheet or share failed — fall through to copy
    }
  }
  await Clipboard.setStringAsync(message);
  return 'copied';
}

/**
 * Lightweight unique id — good enough for local list keys, not for servers.
 *
 * **Not for anything the user can save.** A vault id is the server's primary key
 * and the save is an upsert, so a re-minted id inserts a duplicate row instead
 * of updating the original. Use `contentId()` in `utils/contentId.ts` there.
 */
export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
