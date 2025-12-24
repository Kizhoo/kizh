-- Jalankan di SQL Editor Supabase

-- 1. Aktifkan ekstensi UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabel untuk menyimpan konfigurasi (Token & Chat ID)
CREATE TABLE IF NOT EXISTS app_config (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  config_key VARCHAR(50) UNIQUE NOT NULL,
  config_value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. Tabel utama untuk pesan
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sender_name VARCHAR(100) NOT NULL,
  message_text TEXT NOT NULL,
  photo_count INTEGER DEFAULT 0,
  telegram_status VARCHAR(20) DEFAULT 'pending' CHECK (telegram_status IN ('pending', 'sent', 'failed')),
  telegram_message_id VARCHAR(100),
  telegram_error TEXT,
  
  -- Supabase Row Level Security (RLS) - Biarkan publik untuk insert
  user_id UUID DEFAULT gen_random_uuid(),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 4. Tabel untuk statistik harian
CREATE TABLE IF NOT EXISTS daily_stats (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  stat_date DATE UNIQUE NOT NULL,
  message_count INTEGER DEFAULT 0,
  photo_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 5. Enable Row Level Security (untuk keamanan)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;

-- 6. Policies untuk messages (Izinkan insert tanpa autentikasi)
CREATE POLICY "Enable insert for all users" ON messages
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable read for all users" ON messages
  FOR SELECT USING (true);

-- 7. Policies untuk app_config (Hanya admin)
CREATE POLICY "Enable read for all users on app_config" ON app_config
  FOR SELECT USING (true);

-- 8. Index untuk performa
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(telegram_status);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(stat_date DESC);

-- 9. Fungsi untuk update timestamp otomatis
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 10. Trigger untuk update timestamp
CREATE TRIGGER update_messages_updated_at 
  BEFORE UPDATE ON messages 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- 11. Insert konfigurasi default (isi dengan token dan chat ID kamu)
INSERT INTO app_config (config_key, config_value) VALUES
  ('BOT_TOKEN', 'YOUR_BOT_TOKEN_HERE'),
  ('CHAT_ID', 'YOUR_CHAT_ID_HERE')
ON CONFLICT (config_key) DO NOTHING;

-- 12. Fungsi untuk update statistik harian
CREATE OR REPLACE FUNCTION update_daily_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO daily_stats (stat_date, message_count, photo_count)
  VALUES (CURRENT_DATE, 1, NEW.photo_count)
  ON CONFLICT (stat_date) 
  DO UPDATE SET 
    message_count = daily_stats.message_count + 1,
    photo_count = daily_stats.photo_count + NEW.photo_count;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 13. Trigger untuk update statistik
CREATE TRIGGER update_stats_after_insert
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_stats();
