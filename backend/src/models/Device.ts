import mongoose, { Schema, Document } from 'mongoose';

export interface IDevice extends Document {
  userId: mongoose.Types.ObjectId;
  deviceId: string;          // UUIDv4
  signPublicKey: string;     // base64 Ed25519
  boxPublicKey: string;      // base64 X25519
  boxKeySignature: string;   // base64, Sign(signSk, "e2ee-v1-boxkey|" || deviceId || boxPk)
  registeredAt: Date;
  revokedAt?: Date;          // set when replaced/logged out
}

const DeviceSchema = new Schema<IDevice>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId: { type: String, required: true },
    signPublicKey: { type: String, required: true },
    boxPublicKey: { type: String, required: true },
    boxKeySignature: { type: String, required: true },
    registeredAt: { type: Date, default: Date.now },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);

DeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
DeviceSchema.index({ userId: 1, revokedAt: 1 });

export default mongoose.model<IDevice>('Device', DeviceSchema);
