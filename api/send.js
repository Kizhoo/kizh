import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { FormData } from 'form-data';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Handle GET request for health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      message: 'To-Kizhoo API is running',
      timestamp: new Date().toISOString()
    });
  }
  
  // Only POST allowed for sending messages
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }
  
  try {
    console.log('📨 Received message request');
    
    // Parse request body
    const { senderName, message, photos = [] } = req.body;
    
    // Validate input
    if (!senderName || !message) {
      return res.status(400).json({
        success: false,
        error: 'Nama dan pesan wajib diisi'
      });
    }
    
    // Initialize Supabase client
    const supabaseUrl = "https://sdhjhqyowzvwnwhkhseg.supabase.co";
    const supabaseKey = " sb_publishable_z1du_teMwE39uEa18VMEJw_8Cqb3cg8"; // Use service key for full access
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get Telegram config from database
    const { data: configData, error: configError } = await supabase
      .from('app_config')
      .select('config_key, config_value')
      .in('config_key', ['BOT_TOKEN', 'CHAT_ID']);
    
    if (configError) {
      console.error('Config error:', configError);
      throw new Error('Failed to get configuration');
    }
    
    // Convert config array to object
    const config = {};
    configData?.forEach(item => {
      config[item.config_key] = item.config_value;
    });
    
    const botToken = config.BOT_TOKEN;
    const chatId = config.CHAT_ID;
    
    if (!botToken || !chatId) {
      return res.status(500).json({
        success: false,
        error: 'Telegram bot not configured'
      });
    }
    
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
    
    // Send to Telegram
    const telegramMessage = `📨 *PESAN BARU DARI TO-KIZHOO*\n\n👤 **Pengirim:** ${senderName}\n💬 **Pesan:**\n${message}\n\n🕒 **Waktu:** ${new Date().toLocaleString('id-ID')}`;
    
    let telegramResponse = null;
    let telegramError = null;
    
    try {
      if (photos.length > 0) {
        // Send with photos
        console.log(`📷 Sending ${photos.length} photos...`);
        
        // Send first photo with caption
        telegramResponse = await sendTelegramPhoto(botToken, chatId, photos[0], telegramMessage);
        
        // Send remaining photos
        for (let i = 1; i < photos.length; i++) {
          await sendTelegramPhoto(botToken, chatId, photos[i], `📸 Gambar ${i + 1} dari ${senderName}`);
          if (i < photos.length - 1) {
            await sleep(300); // Delay to avoid rate limiting
          }
        }
      } else {
        // Send text only
        console.log('📝 Sending text message...');
        telegramResponse = await sendTelegramMessage(botToken, chatId, telegramMessage);
      }
      
      // Update message status to sent
      const { error: updateError } = await supabase
        .from('messages')
        .update({
          telegram_status: 'sent',
          telegram_message_id: telegramResponse?.result?.message_id || 'unknown'
        })
        .eq('id', messageId);
      
      if (updateError) {
        console.error('Update error:', updateError);
      }
      
      console.log('✅ Message sent successfully');
      
      // Return success response
      return res.status(200).json({
        success: true,
        message: 'Pesan berhasil dikirim ke Telegram',
        messageId: messageId,
        timestamp: new Date().toISOString()
      });
      
    } catch (telegramErr) {
      telegramError = telegramErr.message;
      console.error('Telegram error:', telegramErr);
      
      // Update message status to failed
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

// Helper function to send Telegram message
async function sendTelegramMessage(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
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

// Helper function to send Telegram photo
async function sendTelegramPhoto(botToken, chatId, photoBase64, caption) {
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  
  // Validate and extract base64 data
  if (!photoBase64 || !photoBase64.includes('base64,')) {
    throw new Error('Invalid base64 image data');
  }
  
  const base64Data = photoBase64.split(';base64,').pop();
  if (!base64Data) {
    throw new Error('No base64 data found');
  }
  
  // Decode base64 to buffer
  const buffer = Buffer.from(base64Data, 'base64');
  
  // Create FormData
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('caption', caption.substring(0, 1024)); // Telegram caption limit
  formData.append('parse_mode', 'Markdown');
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

// Helper function for delay
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
      }
