import mongoose from 'mongoose';
import { config } from '../config/index.js';

export async function connectDB() {
  try {
    await mongoose.connect(config.mongoUrl);
    console.log('MongoDB connected');
  } catch (err) {
    // Fail fast — a server that "starts" without a working DB connection
    // just fails confusingly on the first request instead. Better to
    // never come up at all.
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }
}
