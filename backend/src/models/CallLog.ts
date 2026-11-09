import mongoose, { Schema, Document } from 'mongoose';

export interface ICallLog extends Document {
  callerId: mongoose.Types.ObjectId;
  calleeId: mongoose.Types.ObjectId;
  conversationId?: mongoose.Types.ObjectId;
  type: 'audio' | 'video';
  startedAt: Date;
  endedAt?: Date;
  result: 'missed' | 'answered' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

const CallLogSchema: Schema = new Schema(
  {
    callerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    calleeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation' },
    type: { type: String, enum: ['audio', 'video'], required: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    result: { type: String, enum: ['missed', 'answered', 'rejected'], required: true },
  },
  { timestamps: true }
);

export default mongoose.model<ICallLog>('CallLog', CallLogSchema);
