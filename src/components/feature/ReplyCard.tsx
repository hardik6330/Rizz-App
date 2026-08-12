import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { STAGGER } from '@/theme/motion';
import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { ReplyOption } from '@/types';
import { CircleIconButton } from '@/components/ui/CircleIconButton';
import { haptic } from '@/utils/haptics';

const STYLE_COLORS: Record<ReplyOption['style'], string> = {
  Smooth: palette.cyan,
  Playful: palette.pink,
  Bold: palette.ember,
};

interface ReplyCardProps {
  option: ReplyOption;
  index: number;
  saved: boolean;
  /** Receives the line as it currently stands, edited or not. */
  onCopy: (text: string) => void;
  onToggleSave: (text: string) => void;
}

/**
 * One generated reply, with copy, save, and — the point of this file — edit.
 *
 * ## Why editing matters more than it looks
 *
 * Every product in this category ends the same way: here is a line, copy it or
 * do not. That makes the output something the user *takes*, and a line you took
 * is a line you might not trust enough to send. Changing one word makes it
 * theirs, and a vault of lines someone wrote half of is worth opening again in
 * a way a vault of machine output is not.
 *
 * It is also the honest answer to the failure mode this product actually has:
 * the engine gets the read right and the wording 90% right, and the user's own
 * name for their dog is the missing 10%. Regenerating for that costs a credit
 * and usually loses what was already good.
 *
 * ## Why the draft is local and never lifted
 *
 * An edit is not a new result. The screen owns `result`, which came from the
 * engine, and writing user text back into it would mean a re-analysis or a
 * re-render of the whole set could silently discard typing. Held here, the edit
 * survives exactly as long as the card does — and the two ways it escapes,
 * copying and saving, both take the current draft.
 *
 * `saved` is still keyed on the option id, so editing a saved line and saving
 * again updates that row rather than creating a second one.
 */
export function ReplyCard({ option, index, saved, onCopy, onToggleSave }: ReplyCardProps) {
  const color = STYLE_COLORS[option.style];
  const [draft, setDraft] = useState(option.text);
  const [editing, setEditing] = useState(false);
  const edited = draft.trim() !== option.text.trim();

  const toggleEdit = () => {
    haptic.light();
    // Empty is not an edit, it is a mistake — fall back rather than let someone
    // copy a blank line or save one to the vault.
    if (editing && draft.trim() === '') setDraft(option.text);
    setEditing((v) => !v);
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(STAGGER * index)
        .springify()
        .damping(17)}
      style={styles.card}
    >
      <View style={styles.header}>
        <View style={[styles.styleChip, { backgroundColor: `${color}1F`, borderColor: `${color}55` }]}>
          <Text style={[styles.styleText, { color }]}>{option.style.toUpperCase()}</Text>
        </View>
        <Text style={styles.spice}>{'🌶️'.repeat(option.spice)}</Text>
        {edited && <Text style={styles.edited}>EDITED</Text>}
        <View style={styles.spacer} />
        <CircleIconButton
          icon={editing ? 'checkmark' : 'create-outline'}
          active={editing}
          onPress={toggleEdit}
          accessibilityLabel={editing ? 'Done editing' : 'Edit this reply'}
        />
        <CircleIconButton
          icon={saved ? 'bookmark' : 'bookmark-outline'}
          active={saved}
          onPress={() => onToggleSave(draft.trim() || option.text)}
          accessibilityLabel={saved ? 'Remove from vault' : 'Save to vault'}
        />
        <CircleIconButton
          icon="copy-outline"
          onPress={() => onCopy(draft.trim() || option.text)}
          accessibilityLabel="Copy reply"
        />
      </View>

      {editing ? (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          multiline
          autoFocus
          // Same type role as the read-only line: switching to an input must not
          // reflow the card, or the text jumps under the cursor as you tap edit.
          style={[styles.text, styles.input]}
          selectionColor={color}
          accessibilityLabel="Edit reply text"
          onBlur={() => setEditing(false)}
        />
      ) : (
        <Text style={styles.text}>{draft}</Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  styleChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  styleText: {
    ...typo.micro,
  },
  spice: {
    ...typo.overline,
    letterSpacing: 0,
  },
  edited: {
    ...typo.micro,
    color: palette.textTertiary,
  },
  spacer: {
    flex: 1,
  },
  text: {
    ...typo.reply,
  },
  input: {
    // Recessed while it is a field, so it reads as somewhere to type rather
    // than as the same card with a cursor in it.
    backgroundColor: palette.surfaceInset,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.hairline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    // The read-only Text has no padding, so match its optical position and let
    // the card grow by the padding rather than the line shifting inside it.
    marginHorizontal: -spacing.sm,
  },
});
