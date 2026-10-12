import "dotenv/config";

import { createUser } from "../services/userService";
import { loginSchema } from "../validation/login";

// Creates the first admin account. Usage: set ADMIN_EMAIL and ADMIN_PASSWORD
// (and optionally ADMIN_NAME) in .env, then run `npm run seed:admin`.
async function main() {
  const parsed = loginSchema.safeParse({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  if (!parsed.success || parsed.data.password.length < 8) {
    throw new Error("Set ADMIN_EMAIL (valid) and ADMIN_PASSWORD (at least 8 characters) in .env");
  }

  const admin = await createUser({
    name: process.env.ADMIN_NAME || "Admin",
    email: parsed.data.email,
    password: parsed.data.password,
    role: "admin",
  });
  console.log(`Created admin ${admin.email} (${admin.id})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
