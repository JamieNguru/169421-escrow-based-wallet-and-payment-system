import dotenv from "dotenv";

import { createApp } from "./app";

dotenv.config({ quiet: true });

const PORT = Number(process.env.PORT) || 4000;

createApp().listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
