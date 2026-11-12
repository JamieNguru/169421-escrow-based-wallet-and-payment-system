// Vercel serverless entry point: every request is rewritten here (vercel.json)
// and handled by the same Express app that server.ts runs locally.
import { createApp } from "../src/app";

export default createApp();
