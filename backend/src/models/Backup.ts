import mongoose, { Schema, Document } from 'mongoose';

export interface IBackup extends Document {
  userId: mongoose.Types.ObjectId;
  version: number;
  salt: string;
  nonce: string;
  ciphertext: string;
  exportedAt: number;
  createdAt: Date;
  updatedAt: Date;
}

const BackupSchema = new Schema<IBackup>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    salt: {
      type: String,
      required: true,
    },
    nonce: {
      type: String,
      required: true,
    },
    ciphertext: {
      type: String,
      required: true,
    },
    exportedAt: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Backup = mongoose.model<IBackup>('Backup', BackupSchema);
