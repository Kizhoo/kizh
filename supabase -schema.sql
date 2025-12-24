-- Jalankan di SQL Editor Supabase
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabel utama untuk pesan
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sender_name VARCHAR(100) NOT NULL,
  message_text TEXT NOT NULL,
  photo_count INTEGER DEFAULT 0,
  telegram_status VARCHAR(20) DEFAULT 'pending' CHECK (telegram_status IN ('pending', 'sent', 'failed')),
  telegram_message_id VARCHAR(100),
  telegram_error TEXT,
  user_ip INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Tabel untuk statistik
CREATE TABLE IF NOT EXISTS daily_stats (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  stat_date DATE UNIQUE NOT NULL,
  message_count INTEGER DEFAULT 0,
  photo_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Enable Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Enable insert for all users" ON messages
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable read for all users" ON messages
  FOR SELECT USING (true);

CREATE POLICY "Enable read for all users on daily_stats" ON daily_stats
  FOR SELECT USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(telegram_status);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(stat_date DESC);

-- Function untuk update statistik
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

-- Trigger untuk update statistik
CREATE TRIGGER update_stats_after_insert
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_stats();
