import { socketService } from './socket';

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private callLogId: string | null = null;
  private iceCandidatesQueue: RTCIceCandidate[] = [];

  public onRemoteStream: ((stream: MediaStream) => void) | null = null;
  public onConnectionStateChange: ((state: string) => void) | null = null;

  private isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.RTCPeerConnection !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    );
  }

  async setupLocalStream(): Promise<MediaStream | null> {
    if (!this.isSupported()) {
      console.warn('[WebRTC] WebRTC is not supported in this environment');
      throw new Error('WebRTC is not supported in this environment');
    }

    if (this.localStream) {
      return this.localStream;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.localStream = stream;
      return this.localStream;
    } catch (err) {
      console.warn('[WebRTC] Failed to obtain local audio stream on web:', err);
      throw err;
    }
  }

  createPeerConnection(callLogId: string): RTCPeerConnection | null {
    if (!this.isSupported()) {
      throw new Error('WebRTC is not supported in this environment');
    }

    this.cleanup();
    this.callLogId = callLogId;

    const pc = new window.RTCPeerConnection(ICE_CONFIG);
    this.peerConnection = pc;

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate && this.callLogId) {
        socketService.sendIceCandidate(this.callLogId, event.candidate.toJSON());
      }
    });

    pc.addEventListener('track', (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        this.onRemoteStream?.(this.remoteStream);
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      this.onConnectionStateChange?.(pc.connectionState);
    });

    return pc;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized');
    }

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
    });

    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized');
    }

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.processQueuedCandidates();

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.processQueuedCandidates();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) return;
    const rtcCandidate = new RTCIceCandidate(candidate);
    if (this.peerConnection.remoteDescription) {
      await this.peerConnection.addIceCandidate(rtcCandidate);
    } else {
      this.iceCandidatesQueue.push(rtcCandidate);
    }
  }

  private async processQueuedCandidates(): Promise<void> {
    if (!this.peerConnection) return;
    while (this.iceCandidatesQueue.length > 0) {
      const candidate = this.iceCandidatesQueue.shift();
      if (candidate) {
        try {
          await this.peerConnection.addIceCandidate(candidate);
        } catch (e) {
          console.warn('[WebRTC] Failed to add queued candidate:', e);
        }
      }
    }
  }

  toggleMute(): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled;
    }
    return false;
  }

  cleanup(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      this.localStream = null;
    }

    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      this.remoteStream = null;
    }

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }

    this.callLogId = null;
    this.iceCandidatesQueue = [];
    this.onRemoteStream = null;
    this.onConnectionStateChange = null;
  }
}

export const webrtcService = new WebRTCService();
