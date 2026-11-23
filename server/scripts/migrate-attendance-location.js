import { query } from "../src/config/db.js";

export async function runAttendanceLocationMigration() {
  try {
    await query(`
      ALTER TABLE attendance 
      ADD COLUMN IF NOT EXISTS latitude NUMERIC,
      ADD COLUMN IF NOT EXISTS longitude NUMERIC,
      ADD COLUMN IF NOT EXISTS accuracy NUMERIC,
      ADD COLUMN IF NOT EXISTS resolved_address TEXT,
      ADD COLUMN IF NOT EXISTS location_status VARCHAR(50) DEFAULT 'Not Available',
      ADD COLUMN IF NOT EXISTS location_captured_at TIMESTAMP WITH TIME ZONE NULL;

      CREATE INDEX IF NOT EXISTS idx_attendance_location_coords
      ON attendance (latitude, longitude) WHERE latitude IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_attendance_date_company
      ON attendance (company_id, date DESC);

      UPDATE attendance
      SET latitude = CAST(NULLIF(location->>'latitude', '') AS NUMERIC),
          longitude = CAST(NULLIF(location->>'longitude', '') AS NUMERIC),
          accuracy = CAST(NULLIF(location->>'accuracy', '') AS NUMERIC),
          resolved_address = COALESCE(
            NULLIF(location->>'locationName', ''),
            NULLIF(location->>'address', ''),
            NULLIF(location->>'resolved_address', '')
          ),
          location_captured_at = COALESCE(check_in, created_at),
          location_status = CASE 
            WHEN NULLIF(location->>'latitude', '') IS NOT NULL THEN 'Location Captured'
            ELSE 'Not Available'
          END
      WHERE location IS NOT NULL AND (location->>'latitude') IS NOT NULL AND latitude IS NULL;
    `);
    console.log("✅ Verified attendance location and reverse-geocoding columns exist.");
  } catch (err) {
    console.warn("⚠️ Attendance location migration note:", err.message);
  }
}

if (process.argv[1] && process.argv[1].endsWith("migrate-attendance-location.js")) {
  runAttendanceLocationMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Migration failed:", err);
      process.exit(1);
    });
}
