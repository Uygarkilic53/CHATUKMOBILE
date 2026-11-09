import type {
  RTCPeerConnection as IRTCPeerConnection,
  MediaStream as IMediaStream,
  RTCIceCandidate as IRTCIceCandidate,
  RTCSessionDescription as IRTCSessionDescription,
} from 'react-native-webrtc';
import { socketService } from './socket';

// Safely resolve native react-native-webrtc module at runtime so it does not crash Expo Go or web
let RTCPeerConnectionClass: any = null;
let RTCIceCandidateClass: any = null;
let RTCSessionDescriptionClass: any = null;
let mediaDevicesInstance: any = null;
let isWebRTCAvailable = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webrtc = require('react-native-webrtc');
  RTCPeerConnectionClass = webrtc.RTCPeerConnection;
  RTCIceCandidateClass = webrtc.RTCIceCandidate;
  RTCSessionDescriptionClass = webrtc.RTCSessionDescription;
  mediaDevicesInstance = webrtc.mediaDevices;
  isWebRTCAvailable = !!(RTCPeerConnectionClass && mediaDevicesInstance);
} catch {
  console.warn(
    '[WebRTC] react-native-webrtc native module is not available in this build (e.g. Expo Go). Real-time calls require a development build.'
  );
}

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

class NativeWebRTCService {
  private peerConnection: IRTCPeerConnection | null = null;
  private localStream: IMediaStream | null = null;
  private remoteStream: IMediaStream | null = null;
  private callLogId: string | null = null;
  private iceCandidatesQueue: IRTCIceCandidate[] = [];

  public onRemoteStream: ((stream: IMediaStream) => void) | null = null;
  public onConnectionStateChange: ((state: string) => void) | null = null;

  async setupLocalStream(): Promise<IMediaStream> {
    if (!isWebRTCAvailable || !mediaDevicesInstance) {
      throw new Error(
        'Real-time voice calls require an Expo development build (react-native-webrtc native module is not included in Expo Go).'
      );
    }

    if (this.localStream) {
      return this.localStream;
    }

    try {
      const stream = await mediaDevicesInstance.getUserMedia({
        audio: true,
        video: false,
      });

      this.localStream = stream as IMediaStream;
      return this.localStream;
    } catch (err) {
      console.warn('[WebRTC] Failed to obtain local audio stream:', err);
      throw err;
    }
  }

  createPeerConnection(callLogId: string): IRTCPeerConnection {
    if (!isWebRTCAvailable || !RTCPeerConnectionClass) {
      throw new Error('Real-time voice calls require an Expo development build.');
    }

    this.cleanup();
    this.callLogId = callLogId;

    const pc = new RTCPeerConnectionClass(ICE_CONFIG);
    this.peerConnection = pc;

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.addEventListener('icecandidate', (event: any) => {
      if (event.candidate && this.callLogId) {
        socketService.sendIceCandidate(this.callLogId, event.candidate);
      }
    });

    pc.addEventListener('track', (event: any) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        this.onRemoteStream?.(this.remoteStream!);
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      this.onConnectionStateChange?.(pc.connectionState);
    });

    return pc;
  }

  async createOffer(): Promise<IRTCSessionDescription> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized');
    }

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });

    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(sdp: any): Promise<IRTCSessionDescription> {
    if (!this.peerConnection || !RTCSessionDescriptionClass) {
      throw new Error('PeerConnection not initialized');
    }

    await this.peerConnection.setRemoteDescription(new RTCSessionDescriptionClass(sdp));
    await this.processQueuedCandidates();

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(sdp: any): Promise<void> {
    if (!this.peerConnection || !RTCSessionDescriptionClass) return;
    await this.peerConnection.setRemoteDescription(new RTCSessionDescriptionClass(sdp));
    await this.processQueuedCandidates();
  }

  async addIceCandidate(candidate: any): Promise<void> {
    if (!this.peerConnection || !RTCIceCandidateClass) return;
    const rtcCandidate = new RTCIceCandidateClass(candidate);
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

export const webrtcService = new NativeWebRTCService();
