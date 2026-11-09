import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { Vibration } from 'react-native';
import { useRouter } from 'expo-router';
import { socketService, IncomingCallData } from '../services/socket';
import { webrtcService } from '../services/webrtc';
import { useToast } from '../components/Toast';

export type CallStatus = 'idle' | 'ringing' | 'outgoing' | 'active' | 'ended';

export interface CallState {
  status: CallStatus;
  callLogId: string | null;
  callerId: string | null;
  callerName: string | null;
  callerImage: string | null;
  calleeId: string | null;
  conversationId: string | null;
  isMuted: boolean;
  isSpeaker: boolean;
  duration: number; // in seconds
  connectionState: string;
}

interface CallContextType extends CallState {
  initiateCall: (
    calleeId: string,
    conversationId: string,
    calleeName?: string,
    calleeImage?: string | null
  ) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
}

const INITIAL_STATE: CallState = {
  status: 'idle',
  callLogId: null,
  callerId: null,
  callerName: null,
  callerImage: null,
  calleeId: null,
  conversationId: null,
  isMuted: false,
  isSpeaker: false,
  duration: 0,
  connectionState: 'new',
};

const CallContext = createContext<CallContextType | null>(null);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const { showToast } = useToast();
  const [callState, setCallState] = useState<CallState>(INITIAL_STATE);

  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStateRef = useRef<CallState>(callState);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  // Cleanup helper
  const resetCall = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    webrtcService.cleanup();
    setCallState(INITIAL_STATE);
  }, []);

  // Duration timer when call is active
  useEffect(() => {
    if (callState.status === 'active') {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      durationTimerRef.current = setInterval(() => {
        setCallState((prev) => ({ ...prev, duration: prev.duration + 1 }));
      }, 1000);
    } else {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    }
    return () => {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    };
  }, [callState.status]);

  // Handle incoming socket events
  useEffect(() => {
    const unsubIncoming = socketService.onCallIncoming((data: IncomingCallData) => {
      // If already in a call, auto-decline incoming
      if (callStateRef.current.status !== 'idle') {
        socketService.declineCall(data.callLogId);
        return;
      }

      try {
        Vibration.vibrate([0, 500, 400, 500], true);
      } catch {}

      setCallState({
        status: 'ringing',
        callLogId: data.callLogId,
        callerId: data.callerId,
        callerName: data.callerName,
        callerImage: data.callerImage,
        calleeId: null,
        conversationId: data.conversationId,
        isMuted: false,
        isSpeaker: false,
        duration: 0,
        connectionState: 'ringing',
      });
    });

    const unsubInitiated = socketService.onCallInitiated((data) => {
      setCallState((prev) => ({
        ...prev,
        callLogId: data.callLogId,
      }));
    });

    const unsubAccepted = socketService.onCallAccepted(async (data) => {
      try {
        Vibration.cancel();
      } catch {}

      setCallState((prev) => ({
        ...prev,
        status: 'active',
        connectionState: 'connecting',
      }));

      // If we are the caller, setup WebRTC offer and navigate to active call screen
      try {
        await webrtcService.setupLocalStream();
        webrtcService.createPeerConnection(data.callLogId);
        const offer = await webrtcService.createOffer();
        socketService.sendCallOffer(data.callLogId, offer);

        router.push('/conversation/call');
      } catch (err) {
        console.warn('[CallContext] Error setting up caller peer connection:', err);
      }
    });

    const unsubDeclined = socketService.onCallDeclined(() => {
      try {
        Vibration.cancel();
      } catch {}
      showToast('Call was declined', { type: 'info' });
      setCallState((prev) => ({ ...prev, status: 'ended' }));
      setTimeout(resetCall, 1200);
    });

    const unsubCancelled = socketService.onCallCancelled(() => {
      try {
        Vibration.cancel();
      } catch {}
      showToast('Missed call', { type: 'info' });
      setCallState((prev) => ({ ...prev, status: 'ended' }));
      setTimeout(resetCall, 800);
    });

    const unsubEnded = socketService.onCallEnded(() => {
      try {
        Vibration.cancel();
      } catch {}
      setCallState((prev) => ({ ...prev, status: 'ended' }));
      setTimeout(resetCall, 1000);
    });

    const unsubOffer = socketService.onCallOffer(async (data) => {
      try {
        await webrtcService.setupLocalStream();
        webrtcService.createPeerConnection(data.callLogId);
        const answer = await webrtcService.handleOffer(data.sdp);
        socketService.sendCallAnswer(data.callLogId, answer);
      } catch (err) {
        console.warn('[CallContext] Error handling offer:', err);
      }
    });

    const unsubAnswer = socketService.onCallAnswer(async (data) => {
      try {
        await webrtcService.handleAnswer(data.sdp);
      } catch (err) {
        console.warn('[CallContext] Error handling answer:', err);
      }
    });

    const unsubCandidate = socketService.onCallIceCandidate(async (data) => {
      try {
        await webrtcService.addIceCandidate(data.candidate);
      } catch (err) {
        console.warn('[CallContext] Error adding candidate:', err);
      }
    });

    const unsubError = socketService.onCallError((data) => {
      try {
        Vibration.cancel();
      } catch {}
      showToast(data.error || 'Call error occurred', { type: 'error' });
      resetCall();
    });

    // Connection state observer
    webrtcService.onConnectionStateChange = (state) => {
      setCallState((prev) => ({ ...prev, connectionState: state }));
      if (state === 'failed' || state === 'disconnected') {
        showToast('Call connection lost', { type: 'warning' });
        setTimeout(resetCall, 1500);
      }
    };

    return () => {
      unsubIncoming();
      unsubInitiated();
      unsubAccepted();
      unsubDeclined();
      unsubCancelled();
      unsubEnded();
      unsubOffer();
      unsubAnswer();
      unsubCandidate();
      unsubError();
    };
  }, [resetCall, router, showToast]);

  const initiateCall = useCallback(
    async (
      calleeId: string,
      conversationId: string,
      calleeName?: string,
      calleeImage?: string | null
    ) => {
      try {
        await webrtcService.setupLocalStream();
      } catch {
        showToast('Microphone permission is required to make calls', { type: 'error' });
        return;
      }

      setCallState({
        status: 'outgoing',
        callLogId: null,
        callerId: null,
        callerName: null,
        callerImage: null,
        calleeId,
        conversationId,
        isMuted: false,
        isSpeaker: false,
        duration: 0,
        connectionState: 'calling',
      });

      socketService.initiateCall(calleeId, conversationId);
      router.push({
        pathname: '/conversation/call',
        params: {
          recipientName: calleeName || 'Contact',
          recipientImage: calleeImage || '',
        },
      });
    },
    [router, showToast]
  );

  const acceptCall = useCallback(async () => {
    const { callLogId, callerName, callerImage } = callStateRef.current;
    if (!callLogId) return;

    try {
      Vibration.cancel();
    } catch {}

    setCallState((prev) => ({
      ...prev,
      status: 'active',
      connectionState: 'connecting',
    }));

    try {
      await webrtcService.setupLocalStream();
      socketService.acceptCall(callLogId);

      router.push({
        pathname: '/conversation/call',
        params: {
          recipientName: callerName || 'Contact',
          recipientImage: callerImage || '',
        },
      });
    } catch (err) {
      console.warn('[CallContext] Error accepting call:', err);
      showToast('Could not access microphone', { type: 'error' });
      resetCall();
    }
  }, [resetCall, router, showToast]);

  const declineCall = useCallback(() => {
    const { callLogId } = callStateRef.current;
    try {
      Vibration.cancel();
    } catch {}
    if (callLogId) {
      socketService.declineCall(callLogId);
    }
    resetCall();
  }, [resetCall]);

  const endCall = useCallback(() => {
    const { callLogId } = callStateRef.current;
    try {
      Vibration.cancel();
    } catch {}
    if (callLogId) {
      socketService.endCall(callLogId);
    }
    resetCall();
    try {
      router.back();
    } catch {}
  }, [resetCall, router]);

  const toggleMute = useCallback(() => {
    const isMuted = webrtcService.toggleMute();
    setCallState((prev) => ({ ...prev, isMuted }));
  }, []);

  const toggleSpeaker = useCallback(() => {
    setCallState((prev) => ({ ...prev, isSpeaker: !prev.isSpeaker }));
  }, []);

  const value: CallContextType = {
    ...callState,
    initiateCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleSpeaker,
  };

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
};

export const useCall = (): CallContextType => {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return ctx;
};
