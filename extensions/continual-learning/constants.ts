/**
 * Constants for the continual-learning extension.
 */

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export const STATE_DIR_RELATIVE = `${CONFIG_DIR_NAME}/state`;
export const STATE_FILE_RELATIVE = `${STATE_DIR_RELATIVE}/continual-learning.json`;
export const INDEX_FILE_RELATIVE = `${STATE_DIR_RELATIVE}/continual-learning-index.json`;

export const TRIAL_DEFAULT_DURATION_MINUTES = 24 * 60;

// Session-based cadence and out-of-band run defaults.
export const DEFAULT_SESSION_INTERVAL = 5;
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_SESSIONS = 20;
export const DEFAULT_MAX_INPUT_CHARS = 200_000;
export const DEFAULT_TRIAL_SESSIONS = 1;

// Model config lives beside the extension directory under the agent dir.
export const MODEL_CONFIG_DIR_PARTS = ["extensions", "continual-learning"];
export const MODEL_CONFIG_FILE = "config.json";
