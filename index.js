require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const port = process.env.PORT || 3000;

// Inisialisasi Google Gen AI client dengan API Key dari environment variable
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(`${__dirname}/public`));

// Endpoint health check sederhana
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Gemini Chatbot API is running',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  });
});

// Endpoint GET /api/chat untuk informasi panduan jika diakses lewat browser
app.get('/api/chat', (req, res) => {
  res.status(200).json({
    message: 'Endpoint /api/chat siap digunakan. Kirimkan request POST dengan JSON body { "messages": [...] }.',
    method: 'POST',
    example_body: {
      messages: [
        { role: 'user', content: 'Halo Gemini!' }
      ]
    }
  });
});

/**
 * Endpoint POST /api/chat
 * Memungkinkan percakapan multi-turn dengan Gemini AI
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, temperature, systemInstruction } = req.body || {};

    // Validasi bahwa input berupa array
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: 'Input tidak valid: properti "messages" harus berupa array.',
      });
    }

    // Mengubah setiap pesan ke format yang kompatibel dengan Gemini (role dan parts)
    const formattedMessages = messages.map((msg) => {
      // Normalisasi role ke 'user' atau 'model'
      let role = (msg.role || 'user').toLowerCase();
      if (role === 'assistant' || role === 'bot') {
        role = 'model';
      } else if (role !== 'model') {
        role = 'user';
      }

      // Normalisasi parts
      let parts;
      if (Array.isArray(msg.parts)) {
        parts = msg.parts;
      } else if (typeof msg.content === 'string') {
        parts = [{ text: msg.content }];
      } else if (typeof msg.text === 'string') {
        parts = [{ text: msg.text }];
      } else if (typeof msg.message === 'string') {
        parts = [{ text: msg.message }];
      } else {
        parts = [{ text: String(msg.content || msg.text || msg.message || '') }];
      }

      return {
        role,
        parts,
      };
    });

    // Konfigurasi jawaban Gemini dengan temperature dan systemInstruction
    const config = {
      temperature: temperature !== undefined ? Number(temperature) : 0.7,
      systemInstruction:
        systemInstruction ||
        'Anda adalah asisten AI yang ramah, membantu, dan cerdas.',
    };

    // Menentukan model dari environment variable GEMINI_MODEL (default: gemini-3.8-flash)
    const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

    // Mengirim pesan yang telah diformat ke model Gemini menggunakan generateContent()
    const response = await ai.models.generateContent({
      model,
      contents: formattedMessages,
      config,
    });

    // Mengembalikan respons AI melalui properti response.text
    return res.status(200).json({
      text: response.text,
    });
  } catch (error) {
    console.error('Error saat memproses chat:', error);

    let errorMessage = error.message || 'Terjadi kesalahan pada server saat memproses permintaan.';
    try {
      const parsed = JSON.parse(errorMessage);
      if (parsed && parsed.error && parsed.error.message) {
        errorMessage = parsed.error.message;
      }
    } catch (_) {}

    // Menangani error dengan mengembalikan status 500 dan pesan error
    return res.status(500).json({
      error: errorMessage,
    });
  }
});

// Menjalankan server Express
app.listen(port, () => {
  console.log(`Server Express berjalan di http://localhost:${port}`);
  console.log(`Model Gemini: ${process.env.GEMINI_MODEL || 'gemini-3.8-flash'}`);
});
