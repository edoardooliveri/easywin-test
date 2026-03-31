-- ============================================================
-- 008: Add PasswordHash column to users table
-- ============================================================
-- The legacy ASP.NET Membership system stored passwords in a
-- separate table (aspnet_Membership). Now that we use bcrypt,
-- we need a PasswordHash column directly on the users table.
-- On first login, users without a hash will have their password
-- hashed and stored here.
-- ============================================================

-- Add PasswordHash column if it doesn't exist (PascalCase to match ASP.NET imported schema)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'PasswordHash'
    ) THEN
        ALTER TABLE users ADD COLUMN "PasswordHash" VARCHAR(255);
    END IF;
END $$;

-- Also handle case where column might exist as snake_case from migration 001
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'password_hash'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'PasswordHash'
    ) THEN
        ALTER TABLE users RENAME COLUMN password_hash TO "PasswordHash";
    END IF;
END $$;
