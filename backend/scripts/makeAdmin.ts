import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  // Dynamic imports so dotenv.config() above runs before auth.ts's module-level
  // JWT_SECRET check — static imports get hoisted above this file's own code.
  const { hashPassword } = await import("../src/lib/auth");
  const { pool } = await import("../src/lib/db");

  const email = process.argv[2] || "admin@weblytech.in";
  const password = process.argv[3] || "adminpassword123";
  const hash = await hashPassword(password);
  await pool.query("DELETE FROM users WHERE email = $1", [email]);
  const result = await pool.query(
    "INSERT INTO users (email, password_hash, role) VALUES ($1,$2,'ADMIN') RETURNING id, email",
    [email, hash]
  );
  console.log("Admin created:", result.rows[0], "password:", password);
  await pool.end();
}
main();
