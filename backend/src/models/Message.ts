import mongoose, { Schema, Document } from 'mongoose';

export interface IEncryptedPayload {
  v: number;               // protocol version, 1
  senderDeviceId: string;
  nonce: string;           // base64, 24 bytes
  ct: string;              // base64, AEAD ciphertext
  sig: string;             // base64, 64 bytes, Ed25519
}

export interface IReaction {
  userId: mongoose.Types.ObjectId;
  userName?: string;
  emoji: string;
  createdAt?: Date;
}

export interface IMessage extends Document {
  conversationId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  type: 'text' | 'image' | 'video' | 'audio' | 'reaction' | 'control' | 'system';
  clientMessageId: string; // UUIDv4 from the client
  content: string;         // system messages ONLY; '' otherwise
  encrypted?: IEncryptedPayload;
  fileUrl?: string;        // Cloudinary URL of an ENCRYPTED blob
  reactions?: IReaction[];
  readBy: mongoose.Types.ObjectId[];
  deliveredTo: mongoose.Types.ObjectId[];
  deletedBy: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const EncryptedSchema = new Schema(
  {
    v: { type: Number, required: true },
    senderDeviceId: { type: String, required: true },
    nonce: { type: String, required: true },
    ct: { type: String, required: true, maxlength: 90_000 },
    sig: { type: String, required: true },
  },
  { _id: false }
);

const MessageSchema = new Schema<IMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['text', 'image', 'video', 'audio', 'reaction', 'control', 'system'],
      required: true,
    },
    clientMessageId: { type: String, required: true },
    content: { type: String, default: '' },
    encrypted: { type: EncryptedSchema },
    fileUrl: { type: String },
    reactions: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        userName: { type: String, default: '' },
        emoji: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    deletedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true } // idempotent sends + replay protection
);
// Covers unread-count aggregation and mark_read bulk update
MessageSchema.index({ conversationId: 1, senderId: 1, readBy: 1 });

// Hard guard against accidental plaintext storage
MessageSchema.pre('validate', function () {
  if (this.type === 'system') {
    if (this.encrypted) {
      throw new Error('system messages must not be encrypted');
    }
  } else {
    if (!this.encrypted) {
      throw new Error('non-system messages require ciphertext');
    }
    if (this.content && this.content.trim().length > 0) {
      throw new Error('plaintext content is forbidden for E2EE messages');
    }
  }
});

export default mongoose.model<IMessage>('Message', MessageSchema);
