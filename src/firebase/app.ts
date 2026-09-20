// The Firebase entry point. Authentication + Firestore ONLY (no Storage, Functions, Analytics, Hosting).
// Only src/services may import this module (enforced by ESLint).
import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { readConfig } from '../config/env';

const result = readConfig();
if (!result.ok) {
  // main.tsx validates first and shows ConfigErrorPage; this is a last line of defence.
  throw result.error;
}
const { config } = result;

const isFirstInit = getApps().length === 0;
const app = isFirstInit ? initializeApp(config.firebase) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);

// Emulator connections may only be made once per instance (Vite HMR re-evaluates modules).
if (config.useEmulators && isFirstInit) {
  connectAuthEmulator(auth, `http://${config.emulatorHost}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, config.emulatorHost, 8080);
}
