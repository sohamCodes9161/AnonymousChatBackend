import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Never the raw token — SHA-256 hash. Fast hash is correct here
    // (unlike passwords): this is a 320-bit random value, not a
    // guessable secret, so brute-force resistance from a slow hash
    // buys nothing and would just slow down every refresh call.
    tokenHash: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
