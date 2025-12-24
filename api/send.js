import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { FormData } from 'form-data';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      message: 'To-Kizhoo API is running',
      timestamp: new Date().toISOString()
    });
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }
  
  try {
    console.log('📨 Received message request');
    
    const { senderName, message, photos = [] } = req.body;
    
    if (!senderName || !message) {
      return res.status(400).json({
        success: false,
        error: 'Nama dan pesan wajib diisi'
      });
    }
    
    // ✅ AMBIL BOT TOKEN & CHAT ID DARI ENV VARIABLES
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const CHAT_ID = process.env.CHAT_ID;
    
    if (!BOT_TOKEN || !CHAT_ID) {
      return res.status(500).json({
        success: false,
        error: 'Telegram bot not configured properly'
      });
    }
    
    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Save message to database
    const { data: messageData, error: dbError } = await supabase
      .from('messages')
      .insert({
        sender_name: senderName.substring(0, 100),
        message_text: message,
        photo_count: photos.length,
        telegram_status: 'pending'
      })
      .select()
      .single();
    
    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error('Failed to save message');
    }
    
    const messageId = messageData.id;
    console.log(`💾 Message saved with ID: ${messageId}`);
    
    // Format Telegram message
    const telegramMessage = `📨 *PESAN BARU DARI TO-KIZHOO*\n\n👤 **Pengirim:** ${senderName}\n💬 **Pesan:**\n${message}\n\n🕒 **Waktu:** ${new Date().toLocaleString('id-ID')}`;
    
    let telegramResponse = null;
    let telegramError = null;
    
    try {
      if (photos.length > 0) {
        // Send with photos
        console.log(`📷 Sending ${photos.length} photos...`);
        
        // Send first photo with caption
        telegramResponse = await sendTelegramPhoto(BOT_TOKEN, CHAT_ID, photos[0], telegramMessage);
        
        // Send remaining photos without caption (to avoid spam)
        for (let i = 1; i < photos.length; i++) {
          await sendTelegramPhoto(BOT_TOKEN, CHAT_ID, photos[i], '');
          await sleep(500); // Delay to avoid rate limiting
        }
      } else {
        // Send text only
        console.log('📝 Sending text message...');
        telegramResponse = await sendTelegramMessage(BOT_TOKEN, CHAT_ID, telegramMessage);
      }
      
      // Update message status
      await supabase
        .from('messages')
        .update({
          telegram_status: 'sent',
          telegram_message_id: telegramResponse?.result?.message_id || 'unknown'
        })
        .eq('id', messageId);
      
      console.log('✅ Message sent successfully');
      
      return res.status(200).json({
        success: true,
        message: 'Pesan berhasil dikirim ke Kizhoo!',
        messageId: messageId,
        timestamp: new Date().toISOString()
      });
      
    } catch (telegramErr) {
      telegramError = telegramErr.message;
      console.error('Telegram error:', telegramErr);
      
      await supabase
        .from('messages')
        .update({
          telegram_status: 'failed',
          telegram_error: telegramError.substring(0, 500)
        })
        .eq('id', messageId);
      
      return res.status(500).json({
        success: false,
        error: `Gagal mengirim ke Telegram: ${telegramError}`,
        messageId: messageId
      });
    }
    
  } catch (error) {
    console.error('🔥 Server error:', error);
    
    return res.status(500).json({
      success: false,
      error: `Server error: ${error.message}`,
      timestamp: new Date().toISOString()
    });
  }
}

// Helper functions
async function sendTelegramMessage(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    })
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Telegram API error: ${JSON.stringify(errorData)}`);
  }
  
  return response.json();
}

async function sendTelegramPhoto(botToken, chatId, photoBase64, caption) {
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  
  // Extract base64 data
  const base64Data = photoBase64.split(';base64,').pop();
  if (!base64Data) {
    throw new Error('Invalid image data');
  }
  
  const buffer = Buffer.from(base64Data, 'base64');
  
  // Create FormData - FIX FOR ANDROID
  const formData = new FormData();
  formData.append('chat_id', chatId);
  
  if (caption) {
    formData.append('caption', caption.substring(0, 1024));
    formData.append('parse_mode', 'Markdown');
  }
  
  formData.append('photo', buffer, {
    filename: `photo_${Date.now()}.jpg`,
    contentType: 'image/jpeg'
  });
  
  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Telegram Photo API error: ${JSON.stringify(errorData)}`);
  }
  
  return response.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
        }
