import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { EmojiPicker } from '../src/components/EmojiPicker';
import { ThemeProvider } from '../src/context/ThemeContext';

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
  Ionicons: 'Ionicons',
}));

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      card: '#ffffff',
      cardItem: '#f1f5f9',
      cardBorder: '#e2e8f0',
      onSurface: '#0f172a',
      onSurfaceVariant: '#64748b',
      primary: '#4f46e5',
      isDark: false,
    },
    themeMode: 'light',
  }),
  ThemeProvider: ({ children }: any) => children,
}));

const renderWithTheme = async (component: React.ReactElement) => {
  return await render(component);
};

describe('<EmojiPicker /> (Method 2 - Unicode Mappings via gemoji)', () => {
  it('renders correctly and allows selecting a pure Unicode emoji', async () => {
    const onSelectEmojiMock = jest.fn();

    const { getByText, getByPlaceholderText } = await renderWithTheme(
      <EmojiPicker onSelectEmoji={onSelectEmojiMock} columns={8} showSearch={true} />
    );

    // Verify search input is present
    expect(getByPlaceholderText('Search emojis...')).toBeTruthy();

    // Verify category pill is present
    expect(getByText('Smileys')).toBeTruthy();

    // Select an emoji (e.g., grinning face 😀 from gemoji)
    const emojiNode = getByText('😀');
    expect(emojiNode).toBeTruthy();

    fireEvent.press(emojiNode);

    expect(onSelectEmojiMock).toHaveBeenCalledWith('😀');
  });

  it('filters emojis correctly using search input', async () => {
    const onSelectEmojiMock = jest.fn();

    const { getByPlaceholderText, findByText } = await renderWithTheme(
      <EmojiPicker onSelectEmoji={onSelectEmojiMock} />
    );

    const searchInput = getByPlaceholderText('Search emojis...');

    // Search for a specific unique emoji
    fireEvent.changeText(searchInput, 'rocket');

    expect(await findByText('🚀')).toBeTruthy();
  });
});
