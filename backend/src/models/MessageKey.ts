import mongoose, { Schema, Document } from 'mongoose';

export interface IMessageKey extends Document {
  messageId: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  recipientUserId: mongoose.Types.ObjectId;
  recipientDeviceId: string;
  nonce: string;       // base64, 24 bytes
  wrappedKey: string;  // base64, 48 bytes
  createdAt: Date;
}

const MessageKeySchema = new Schema<IMessageKey>(
  {
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    recipientUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recipientDeviceId: { type: String, required: true },
    nonce: { type: String, required: true },
    wrappedKey: { type: String, required: true },
  },
  { timestamps: true }
);

MessageKeySchema.index({ messageId: 1, recipientDeviceId: 1 }, { unique: true });
MessageKeySchema.index({ recipientDeviceId: 1, conversationId: 1 });
MessageKeySchema.index({ recipientUserId: 1, conversationId: 1 });

export default mongoose.model<IMessageKey>('MessageKey', MessageKeySchema);
