/**
 * Run this script to generate a bcrypt hash of the admin password.
 * Usage: node scripts/hash-password.js
 * 
 * Copy the output hash and set it as ADMIN_PASSWORD_HASH in Netlify.
 */
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.log('Usage: node scripts/hash-password.js <your-password>');
  process.exit(1);
}
const saltRounds = 12;

bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) {
    console.error('Error hashing password:', err);
    process.exit(1);
  }

  console.log('\n=== Admin Password Hash ===\n');
  console.log('Hash:', hash);
  console.log('\nSet this as ADMIN_PASSWORD_HASH in your Netlify environment variables.\n');
});
