import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  displayName: string;
  avatarUrl?: string;
  theme?: string;
  bio?: string;
  wallpaper?: string;
  wallpaperUpdatedAt?: Date;
  fcmTokens: string[];
  blockedUsers?: mongoose.Types.ObjectId[];
  lastSeen: Date;
  isOnline: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true },
    avatarUrl: { type: String, default: '' },
    theme: { type: String, default: 'light' },
    bio: { type: String, default: '' },
    wallpaper: { type: String, default: 'default' },
    wallpaperUpdatedAt: { type: Date, default: null },
    fcmTokens: { type: [String], default: [] },
    blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    lastSeen: { type: Date, default: Date.now },
    isOnline: { type: Boolean, default: false },
  },
  { timestamps: true } // Automatically adds createdAt and updatedAt
);

UserSchema.index({ email: 1 }, { unique: true });

export default mongoose.model<IUser>('User', UserSchema);
