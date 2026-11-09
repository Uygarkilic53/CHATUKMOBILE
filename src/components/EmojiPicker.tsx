import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  TextInput,
  Platform,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { gemoji } from 'gemoji';
import { useTheme } from '../context/ThemeContext';

export interface GemojiItem {
  emoji: string;
  names: string[];
  tags: string[];
  description: string;
  category: string;
}

export interface EmojiPickerProps {
  /** Callback returning the pure Unicode emoji string when selected */
  onSelectEmoji: (emoji: string) => void;
  /** Optional callback to close the picker modal/bottom sheet */
  onClose?: () => void;
  /** Number of grid columns (default: 8) */
  columns?: number;
  /** Show search bar at top (default: true) */
  showSearch?: boolean;
  /** Show horizontal category tabs (default: true) */
  showCategoryTabs?: boolean;
}

const CATEGORIES = [
  { key: 'All', label: 'All', icon: 'grid' },
  { key: 'Smileys & Emotion', label: 'Smileys', icon: 'smile' },
  { key: 'People & Body', label: 'People', icon: 'user' },
  { key: 'Animals & Nature', label: 'Animals', icon: 'feather' },
  { key: 'Food & Drink', label: 'Food', icon: 'coffee' },
  { key: 'Travel & Places', label: 'Travel', icon: 'map-pin' },
  { key: 'Activities', label: 'Activities', icon: 'activity' },
  { key: 'Objects', label: 'Objects', icon: 'box' },
  { key: 'Symbols', label: 'Symbols', icon: 'hash' },
  { key: 'Flags', label: 'Flags', icon: 'flag' },
] as const;

interface EmojiCellProps {
  item: GemojiItem;
  onSelect: (emoji: string) => void;
}

/**
 * Individual memoized emoji cell.
 * Strict constraint: No fontWeight attributes applied to the emoji Text to prevent
 * native system font rendering crashes on custom Android OEM skins.
 */
const EmojiCell = React.memo(({ item, onSelect }: EmojiCellProps) => {
  return (
    <Pressable
      onPress={() => onSelect(item.emoji)}
      style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
      hitSlop={2}
      accessibilityRole="button"
      accessibilityLabel={item.description || item.names[0] || 'Emoji'}
    >
      <Text style={styles.emojiText}>{item.emoji}</Text>
    </Pressable>
  );
});

EmojiCell.displayName = 'EmojiCell';

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  onSelectEmoji,
  onClose,
  columns = 8,
  showSearch = true,
  showCategoryTabs = true,
}) => {
  const { theme } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  // Filter emojis based on category and search query
  const filteredEmojis = useMemo<GemojiItem[]>(() => {
    const query = searchQuery.trim().toLowerCase();

    return (gemoji as GemojiItem[]).filter((item) => {
      // Category filter
      if (activeCategory !== 'All' && item.category !== activeCategory) {
        return false;
      }

      // Search query filter
      if (!query) return true;

      if (item.emoji.includes(query)) return true;
      if (item.description && item.description.toLowerCase().includes(query)) return true;
      if (item.names && item.names.some((name) => name.toLowerCase().includes(query))) return true;
      if (item.tags && item.tags.some((tag) => tag.toLowerCase().includes(query))) return true;

      return false;
    });
  }, [searchQuery, activeCategory]);

  const handleSelect = useCallback(
    (emoji: string) => {
      onSelectEmoji(emoji);
    },
    [onSelectEmoji]
  );

  const renderItem = useCallback(
    ({ item }: { item: GemojiItem }) => <EmojiCell item={item} onSelect={handleSelect} />,
    [handleSelect]
  );

  const keyExtractor = useCallback((item: GemojiItem, index: number) => {
    return `${item.emoji}-${index}`;
  }, []);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.card,
          borderColor: theme.cardBorder,
        },
      ]}
    >
      {/* Header with Search and optional Close button */}
      <View style={styles.header}>
        {showSearch ? (
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: theme.cardItem,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <Feather name="search" size={16} color={theme.onSurfaceVariant} style={styles.searchIcon} />
            <TextInput
              style={[styles.searchInput, { color: theme.onSurface }]}
              placeholder="Search emojis..."
              placeholderTextColor={theme.onSurfaceVariant}
              value={searchQuery}
              onChangeText={setSearchQuery}
              clearButtonMode="while-editing"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={6}>
                <Feather name="x-circle" size={16} color={theme.onSurfaceVariant} />
              </Pressable>
            )}
          </View>
        ) : (
          <Text style={[styles.headerTitle, { color: theme.onSurface }]}>Choose Emoji</Text>
        )}

        {onClose && (
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: theme.cardItem },
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close emoji picker"
          >
            <Feather name="x" size={18} color={theme.onSurfaceVariant} />
          </Pressable>
        )}
      </View>

      {/* Category Pills */}
      {showCategoryTabs && (
        <View style={styles.categoryContainer}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={CATEGORIES}
            keyExtractor={(cat) => cat.key}
            contentContainerStyle={styles.categoryScroll}
            renderItem={({ item }) => {
              const isActive = activeCategory === item.key;
              return (
                <Pressable
                  onPress={() => setActiveCategory(item.key)}
                  style={[
                    styles.categoryPill,
                    {
                      backgroundColor: isActive ? theme.primary : theme.cardItem,
                      borderColor: isActive ? theme.primary : theme.cardBorder,
                    },
                  ]}
                  hitSlop={4}
                >
                  <Text
                    style={[
                      styles.categoryLabel,
                      { color: isActive ? '#ffffff' : theme.onSurfaceVariant },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            }}
          />
        </View>
      )}

      {/* Heavily Optimized FlatList for Unicode Emojis */}
      <FlatList
        data={filteredEmojis}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        numColumns={columns}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        // Performance optimizations for 1,800+ Unicode items
        initialNumToRender={40}
        maxToRenderPerBatch={32}
        windowSize={5}
        removeClippedSubviews={Platform.OS !== 'android'}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="search-outline" size={36} color={theme.onSurfaceVariant} />
            <Text style={[styles.emptyText, { color: theme.onSurfaceVariant }]}>
              No emojis found for &quot;{searchQuery}&quot;
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxHeight: 380,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryContainer: {
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(150, 150, 150, 0.2)',
  },
  categoryScroll: {
    paddingHorizontal: 10,
    gap: 6,
  },
  categoryPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 2,
    borderRadius: 8,
  },
  cellPressed: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    transform: [{ scale: 1.15 }],
  },
  /**
   * CRITICAL: Do NOT add fontWeight here.
   * Applying fontWeight to emoji glyphs triggers native Android text rendering crashes.
   */
  emojiText: {
    fontSize: 32,
    textAlign: 'center',
    includeFontPadding: false,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
});

export default EmojiPicker;
