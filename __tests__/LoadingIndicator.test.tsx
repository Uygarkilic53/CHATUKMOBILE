import React from 'react';
import { render } from '@testing-library/react-native';
import { LoadingIndicator } from '../src/components/LoadingIndicator';

describe('<LoadingIndicator />', () => {
  it('renders the label correctly when provided', async () => {
    const { getByText } = await render(
      <LoadingIndicator variant="bar" label="Connecting to Chatuk..." />
    );

    expect(getByText('Connecting to Chatuk...')).toBeTruthy();
  });
});
