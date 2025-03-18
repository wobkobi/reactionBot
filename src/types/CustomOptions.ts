// src/types/CustomOptions.ts
import { User } from 'discord.js';

export interface CustomOptions {
  getUser(name: string, required: true): User;
  getString(name: string, required: true): string;
  getInteger(name: string, required: true): number;
  // Add any additional methods if needed.
}
