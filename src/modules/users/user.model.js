import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
    },
    // Lowercased, indexed copy — used for case-insensitive login lookup
    // and Search, without needing a collation-aware index.
    usernameLower: { type: String, required: true, unique: true },

    passwordHash: { type: String, required: true },

    displayName: { type: String, required: true, maxlength: 50 },
    avatarUrl: { type: String, default: null },
    avatarPublicId: { type: String, default: null },
    bio: { type: String, default: '', maxlength: 200 },

    // Login rate-limiting / brute-force protection (Security module)
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

// Never let passwordHash or lockout internals leak into an API response —
// every route returns this, never the raw document.
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    username: this.username,
    displayName: this.displayName,
    avatarUrl: this.avatarUrl,
    bio: this.bio,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
