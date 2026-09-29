require("dotenv").config({ quiet: true });

const { createApp } = require("./app");

const PORT = process.env.PORT || 4000;

createApp().listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
