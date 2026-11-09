import "dotenv/config";
import express from "express";
import app from "./server/src/app.js";

// Vercel detects this root entrypoint because it imports and instantiates Express.
const vercelApp = express();
vercelApp.use(app);

export default vercelApp;
