import mongoose, { Schema, Document } from 'mongoose';

export interface IClearedBy {
  userId: mongoose.Types.ObjectId;
  clearedAt: Date;
}

export interface IConversation extends Document {
  type: 'direct' | 'group';
  participants: mongoose.Types.ObjectId[];
  name?: string; // Optional: Only for group chats (max 100 chars)
  description?: string; // Optional: Only for group chats (max 512 chars)
  adminIds?: mongoose.Types.ObjectId[]; // Optional: Only for group chats
  groupAvatarUrl?: string; // Optional: For group avatars (e.g. Cloudinary URL)
  groupAvatarPublicId?: string; // Optional: Cloudinary public_id for asset management
  lastMessage?: mongoose.Types.ObjectId; // Reference to the latest Message for fast UI rendering
  clearedBy: IClearedBy[]; // Tracks when a user deleted/cleared the conversation for themselves
  status?: 'pending' | 'accepted';
  initiatorId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema: Schema = new Schema(
  {
    type: { type: String, enum: ['direct', 'group'], required: true },
    participants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    name: { type: String, maxlength: 100 }, 
    description: { type: String, maxlength: 512 },
    adminIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    groupAvatarUrl: { type: String },
    groupAvatarPublicId: { type: String },
    lastMessage: { type: Schema.Types.ObjectId, ref: 'Message' },
    status: { type: String, enum: ['pending', 'accepted'], default: 'accepted' },
    initiatorId: { type: Schema.Types.ObjectId, ref: 'User' },
    // This handles the "delete chat for me but not the other person" logic
    clearedBy: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        clearedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

ConversationSchema.index({ participants: 1, updatedAt: -1 });
ConversationSchema.index({ participants: 1, type: 1 });

export default mongoose.model<IConversation>('Conversation', ConversationSchema);
