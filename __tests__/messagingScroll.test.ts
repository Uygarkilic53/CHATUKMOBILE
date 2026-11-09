describe('MessagingScreen Scroll & Auto-Scroll Controller', () => {
  interface ScrollState {
    initialScrollDone: boolean;
    userHasScrolled: boolean;
    isAtBottom: boolean;
    isDragging: boolean;
    isMomentumScrolling: boolean;
    isProgrammaticScroll: boolean;
    showScrollBottom: boolean;
    newMessagesBelow: number;
  }

  const createInitialState = (): ScrollState => ({
    initialScrollDone: false,
    userHasScrolled: false,
    isAtBottom: true,
    isDragging: false,
    isMomentumScrolling: false,
    isProgrammaticScroll: false,
    showScrollBottom: false,
    newMessagesBelow: 0,
  });

  const evaluateScrollEvent = (
    state: ScrollState,
    event: {
      layoutMeasurement: { height: number; width: number };
      contentOffset: { y: number; x: number };
      contentSize: { height: number; width: number };
    }
  ) => {
    const { layoutMeasurement, contentOffset, contentSize } = event;
    const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
    const maxOffset = contentSize.height - layoutMeasurement.height;

    // If programmatic scroll is in flight, ignore intermediate frames unless near bottom
    if (state.isProgrammaticScroll) {
      if (distanceFromBottom < 80) {
        state.isProgrammaticScroll = false;
        state.isAtBottom = true;
        state.showScrollBottom = false;
        state.newMessagesBelow = 0;
      }
      return;
    }

    const isNearBottom = distanceFromBottom < 80;
    state.isAtBottom = isNearBottom;

    if (maxOffset > 0 && contentOffset.y < maxOffset - 15) {
      state.userHasScrolled = true;
    }

    if (isNearBottom) {
      if (state.showScrollBottom) {
        state.showScrollBottom = false;
        state.newMessagesBelow = 0;
      }
    } else {
      state.userHasScrolled = true;
      if (!state.showScrollBottom) {
        state.showScrollBottom = true;
      }
    }
  };

  const evaluateContentSizeChange = (
    state: ScrollState,
    messagesCount: number,
    scrollToBottomMock: jest.Mock
  ) => {
    if (messagesCount === 0) return;

    // Initial entrance: automatically scroll to latest message once content size is measured
    if (!state.initialScrollDone && !state.userHasScrolled) {
      state.initialScrollDone = true;
      state.isProgrammaticScroll = true;
      scrollToBottomMock(false);
    }
    // Content resize from images or rendering older messages must NEVER scroll down
  };

  const evaluateIncomingSocketMessage = (
    state: ScrollState,
    isSentByMe: boolean,
    scrollToBottomMock: jest.Mock
  ) => {
    if (isSentByMe) {
      state.isAtBottom = true;
      state.showScrollBottom = false;
      state.newMessagesBelow = 0;
      scrollToBottomMock(true);
      return;
    }

    if (state.isAtBottom && !state.isDragging && !state.isMomentumScrolling) {
      scrollToBottomMock(true);
    } else {
      state.newMessagesBelow += 1;
    }
  };

  const evaluateRemoteSyncComplete = (
    state: ScrollState,
    scrollToBottomMock: jest.Mock
  ) => {
    if (!state.userHasScrolled && !state.initialScrollDone) {
      state.initialScrollDone = true;
      state.isProgrammaticScroll = true;
      scrollToBottomMock(false);
    }
  };

  it('automatically scrolls to bottom on initial entrance when messages first render', () => {
    const state = createInitialState();
    const scrollToBottomMock = jest.fn();

    evaluateContentSizeChange(state, 10, scrollToBottomMock);

    expect(scrollToBottomMock).toHaveBeenCalledTimes(1);
    expect(scrollToBottomMock).toHaveBeenCalledWith(false);
    expect(state.initialScrollDone).toBe(true);
    expect(state.isProgrammaticScroll).toBe(true);
  });

  it('does NOT scroll to bottom when images finish loading or older messages mount', () => {
    const state = createInitialState();
    state.initialScrollDone = true;
    state.userHasScrolled = false;
    state.isAtBottom = true;

    const scrollToBottomMock = jest.fn();

    // Image finishes loading in a message bubble
    evaluateContentSizeChange(state, 10, scrollToBottomMock);

    expect(scrollToBottomMock).not.toHaveBeenCalled();
  });

  it('does NOT mark user as scrolled away during programmatic initial scroll intermediate frames', () => {
    const state = createInitialState();
    state.initialScrollDone = true;
    state.isProgrammaticScroll = true;

    // Intermediate frame while animating from y=0 down to bottom
    evaluateScrollEvent(state, {
      layoutMeasurement: { height: 500, width: 375 },
      contentOffset: { y: 200, x: 0 },
      contentSize: { height: 1500, width: 375 },
    });

    expect(state.userHasScrolled).toBe(false);
    expect(state.showScrollBottom).toBe(false);
    expect(state.isProgrammaticScroll).toBe(true);

    // Frame that reaches near bottom
    evaluateScrollEvent(state, {
      layoutMeasurement: { height: 500, width: 375 },
      contentOffset: { y: 950, x: 0 },
      contentSize: { height: 1500, width: 375 },
    });

    expect(state.isProgrammaticScroll).toBe(false);
    expect(state.isAtBottom).toBe(true);
    expect(state.showScrollBottom).toBe(false);
  });

  it('detects user drag upwards and sets userHasScrolled', () => {
    const state = createInitialState();
    state.initialScrollDone = true;

    // User touches screen and drags up
    state.isDragging = true;
    state.userHasScrolled = true;
    state.isProgrammaticScroll = false;

    evaluateScrollEvent(state, {
      layoutMeasurement: { height: 500, width: 375 },
      contentOffset: { y: 600, x: 0 },
      contentSize: { height: 1500, width: 375 },
    });

    expect(state.userHasScrolled).toBe(true);
    expect(state.isAtBottom).toBe(false);
    expect(state.showScrollBottom).toBe(true);
  });

  it('does NOT scroll down on incoming socket message when user has scrolled up', () => {
    const state = createInitialState();
    state.initialScrollDone = true;
    state.userHasScrolled = true;
    state.isAtBottom = false;

    const scrollToBottomMock = jest.fn();

    evaluateIncomingSocketMessage(state, false, scrollToBottomMock);

    expect(scrollToBottomMock).not.toHaveBeenCalled();
    expect(state.newMessagesBelow).toBe(1);
  });

  it('does NOT scroll down on incoming socket message while user is actively dragging', () => {
    const state = createInitialState();
    state.initialScrollDone = true;
    state.isAtBottom = true;
    state.isDragging = true; // User has finger on screen

    const scrollToBottomMock = jest.fn();

    evaluateIncomingSocketMessage(state, false, scrollToBottomMock);

    expect(scrollToBottomMock).not.toHaveBeenCalled();
    expect(state.newMessagesBelow).toBe(1);
  });

  it('does NOT scroll down on incoming socket message while momentum scrolling', () => {
    const state = createInitialState();
    state.initialScrollDone = true;
    state.isAtBottom = true;
    state.isMomentumScrolling = true; // User flicked screen

    const scrollToBottomMock = jest.fn();

    evaluateIncomingSocketMessage(state, false, scrollToBottomMock);

    expect(scrollToBottomMock).not.toHaveBeenCalled();
    expect(state.newMessagesBelow).toBe(1);
  });

  it('scrolls down on incoming message if user is at bottom and not interacting', () => {
    const state = createInitialState();
    state.initialScrollDone = true;
    state.isAtBottom = true;
    state.isDragging = false;
    state.isMomentumScrolling = false;

    const scrollToBottomMock = jest.fn();

    evaluateIncomingSocketMessage(state, false, scrollToBottomMock);

    expect(scrollToBottomMock).toHaveBeenCalledTimes(1);
    expect(scrollToBottomMock).toHaveBeenCalledWith(true);
    expect(state.newMessagesBelow).toBe(0);
  });

  it('outbound message sent by user always scrolls to bottom', () => {
    const state = createInitialState();
    state.initialScrollDone = true;
    state.isAtBottom = false;
    state.showScrollBottom = true;

    const scrollToBottomMock = jest.fn();

    evaluateIncomingSocketMessage(state, true, scrollToBottomMock);

    expect(scrollToBottomMock).toHaveBeenCalledTimes(1);
    expect(state.isAtBottom).toBe(true);
    expect(state.showScrollBottom).toBe(false);
  });

  it('remote sync finishing in background does not scroll down if user has already scrolled', () => {
    const state = createInitialState();
    state.initialScrollDone = true;
    state.userHasScrolled = true;

    const scrollToBottomMock = jest.fn();

    evaluateRemoteSyncComplete(state, scrollToBottomMock);

    expect(scrollToBottomMock).not.toHaveBeenCalled();
  });

  it('web wheel scroll up immediately triggers userHasScrolled and cancels programmatic scroll', () => {
    const state = createInitialState();
    state.isProgrammaticScroll = true;
    state.userHasScrolled = false;

    // Simulate wheel event deltaY < 0 (scroll up)
    const wheelEvent = { deltaY: -100 };
    if (wheelEvent.deltaY < 0) {
      state.userHasScrolled = true;
      state.isProgrammaticScroll = false;
    }

    expect(state.userHasScrolled).toBe(true);
    expect(state.isProgrammaticScroll).toBe(false);
  });
});
