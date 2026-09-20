require("dotenv").config();

const FormData = require("form-data");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ============================================================
// ENV VALIDATION
// ============================================================

const rubikaToken = process.env.RUBIKA_BOT_TOKEN;
const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;

if (!rubikaToken) {
  console.error("❌ RUBIKA_BOT_TOKEN تنظیم نشده");
  process.exit(1);
}

if (!cloudflareAccountId) {
  console.error("❌ CLOUDFLARE_ACCOUNT_ID تنظیم نشده");
  process.exit(1);
}

if (!cloudflareApiToken) {
  console.error("❌ CLOUDFLARE_API_TOKEN تنظیم نشده");
  process.exit(1);
}

// ============================================================
// CONFIG & CONSTANTS
// ============================================================

const RUBIKA_BASE = `https://botapi.rubika.ir/v3/${rubikaToken}`;
const OFFSET_FILE = path.join(__dirname, "offset.json");
const GENERATED_IMAGE_FILE = path.join(__dirname, "generated.png");

const CF_AI_BASE = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/run`;
const TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

const SYSTEM_PROMPT = `You are SIBA, the AI assistant of the SIBAK ecosystem.
Answer users in Persian unless they ask another language.
Be helpful, accurate and concise.`;

let offsetId = null;

// ============================================================
// OFFSET MANAGEMENT
// ============================================================

try {
  if (fs.existsSync(OFFSET_FILE)) {
    const stored = fs.readFileSync(OFFSET_FILE, "utf8").trim();
    if (stored) {
      offsetId = stored;
      console.log("♻️ Offset قبلی بازیابی شد:", offsetId);
    }
  }
} catch (error) {
  console.error("⚠️ خطا در خواندن offset:", error.message);
}

function saveOffset(value) {
  try {
    fs.writeFileSync(OFFSET_FILE, String(value), "utf8");
  } catch (error) {
    console.error("⚠️ خطا در ذخیره offset:", error.message);
  }
}

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeString(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function looksMostlyEnglish(text) {
  const value = safeString(text);
  if (!value) return false;
  const englishChars = (value.match(/[a-zA-Z]/g) || []).length;
  const persianChars = (value.match(/[\u0600-\u06FF]/g) || []).length;
  return englishChars > 5 && englishChars >= persianChars * 2;
}

// ============================================================
// IMAGE REQUEST DETECTION
// ============================================================

function isImageRequest(text) {
  const value = safeString(text).trim().toLowerCase();
  if (!value) return false;

  const patterns = [
    "/image", "/img", "/photo",
    "generate image", "create image", "make an image", "make image",
    "generate a picture", "create a picture", "make a picture",
    "generate picture", "create picture",
    "عکس بساز", "تصویر بساز", "یه عکس بساز", "یک عکس بساز",
    "یه تصویر بساز", "یک تصویر بساز",
    "عکس تولید کن", "تصویر تولید کن", "عکس ایجاد کن", "تصویر ایجاد کن",
    "عکس درست کن", "تصویر درست کن",
    "عکس بکش", "تصویر بکش",
    "ساخت عکس", "ساخت تصویر", "تصویرسازی",
    "یه عکس", "یک عکس", "یه تصویر", "یک تصویر",
    "رندر بساز", "رندر کن"
  ];

  return patterns.some((pattern) => value.includes(pattern));
}

function extractImagePrompt(text) {
  let prompt = safeString(text).trim();

  prompt = prompt
    .replace(/^\/image\b/i, "")
    .replace(/^\/img\b/i, "")
    .replace(/^\/photo\b/i, "")
    .trim();

  prompt = prompt.replace(
    /^(لطفا\s+)?(یک|یه|یک\s+عدد)?\s*(عکس|تصویر)\s*/i,
    ""
  );

  prompt = prompt.replace(
    /\s*(بساز|تولید کن|ایجاد کن|درست کن|بکش|رندر بساز|رندر کن)\s*$/i,
    ""
  );

  return prompt.replace(/\s+/g, " ").trim();
}

// ============================================================
// CLOUDFLARE TEXT AI (LLAMA 3.1)
// ============================================================

async function askAI(userMessage) {
  console.log("☁️ درخواست متنی به Cloudflare AI...");

  try {
    const response = await axios.post(
      `${CF_AI_BASE}/${TEXT_MODEL}`,
      {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${cloudflareApiToken}`,
          "Content-Type": "application/json"
        },
        timeout: 60000
      }
    );

    if (!response.data?.success) {
      throw new Error(JSON.stringify(response.data));
    }

    const answer = response.data?.result?.response;
    if (!answer) throw new Error("پاسخ خالی از Cloudflare دریافت شد.");

    console.log("✅ پاسخ متنی دریافت شد");
    return answer;

  } catch (error) {
    const msg = error.response?.data || error.message;
    console.error("❌ خطا در Cloudflare Text AI:", msg);
    throw new Error("خطا در ارتباط با هوش مصنوعی متنی.");
  }
}

// ============================================================
// CLOUDFLARE IMAGE PROMPT TRANSLATOR (USING SAME LLAMA MODEL)
// ============================================================

async function createImagePrompt(userText) {
  const directPrompt = extractImagePrompt(userText);

  if (!directPrompt) {
    return "A high quality cinematic image, professional composition, detailed lighting";
  }

  if (looksMostlyEnglish(directPrompt)) {
    return directPrompt;
  }

  console.log("📝 تبدیل درخواست فارسی به Prompt انگلیسی...");

  try {
    const response = await axios.post(
      `${CF_AI_BASE}/${TEXT_MODEL}`,
      {
        messages: [
          {
            role: "system",
            content: `You are an expert AI image prompt engineer.
Convert the user's Persian image request into ONE excellent English image-generation prompt.
Rules:
- Output ONLY the final English prompt.
- Do not explain anything.
- Make the image visually rich and precise.
- Preserve the user's main idea.
- Add useful details about composition, lighting, materials, camera, atmosphere and quality when appropriate.`
          },
          { role: "user", content: directPrompt }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${cloudflareApiToken}`,
          "Content-Type": "application/json"
        },
        timeout: 60000
      }
    );

    const result = response.data?.result?.response?.trim();
    if (result) {
      console.log("✅ Prompt انگلیسی ساخته شد");
      return result;
    }

    console.log("⚠️ پرامپت خالی برگردانده شد، استفاده از fallback");
  } catch (error) {
    console.error("⚠️ خطا در ساخت Prompt:", error.response?.data || error.message);
  }

  return `${directPrompt}, high quality 3D render, cinematic lighting, professional composition, highly detailed`;
}

// ============================================================
// FLUX IMAGE GENERATION
// ============================================================

async function generateImage(prompt) {
  console.log("🎨 ساخت تصویر با FLUX.2 Klein...");
  console.log("🖼 Prompt:", prompt);

  try {
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("width", "1024");
    form.append("height", "1024");

    const response = await axios.post(
      `${CF_AI_BASE}/${IMAGE_MODEL}`,
      form,
      {
        headers: {
          Authorization: `Bearer ${cloudflareApiToken}`,
          ...form.getHeaders()
        },
        timeout: 180000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    if (response.data?.success !== true) {
      throw new Error(JSON.stringify(response.data));
    }

    const image = response.data?.result?.image;
    if (!image) throw new Error("تصویر از Cloudflare دریافت نشد.");

    console.log("✅ تصویر از Cloudflare دریافت شد");
    return image;

  } catch (error) {
    const msg = error.response?.data || error.message;
    console.error("❌ خطا در تولید تصویر:", msg);
    throw new Error("خطا در تولید تصویر.");
  }
}

// ============================================================
// RUBIKA API WRAPPERS
// ============================================================

async function sendMessage(chatId, text) {
  try {
    const response = await axios.post(
      `${RUBIKA_BASE}/sendMessage`,
      { chat_id: chatId, text: safeString(text) },
      { timeout: 30000 }
    );

    if (response.data?.status && response.data.status !== "OK") {
      throw new Error(response.data?.message || response.data?.status || "sendMessage failed");
    }

    return response.data;
  } catch (error) {
    console.error("❌ خطا در ارسال پیام:", error.response?.data || error.message);
    throw error;
  }
}

async function requestSendFile() {
  console.log("📤 درخواست آپلود فایل...");

  try {
    const response = await axios.post(
      `${RUBIKA_BASE}/requestSendFile`,
      { type: "Image" },
      { timeout: 60000 }
    );

    if (response.data?.status !== "OK") {
      throw new Error("requestSendFile failed: " + JSON.stringify(response.data));
    }

    return response.data;
  } catch (error) {
    console.error("❌ خطا در requestSendFile:", error.response?.data || error.message);
    throw error;
  }
}

async function uploadFile(filePath, uploadInfo) {
  const fileBuffer = fs.readFileSync(filePath);
  const uploadUrl = uploadInfo?.data?.upload_url;

  if (!uploadUrl) throw new Error("upload_url پیدا نشد");

  console.log("⬆️ آپلود multipart به روبیکا...");

  const form = new FormData();
  form.append("file", fileBuffer, {
    filename: path.basename(filePath),
    contentType: "image/png"
  });

  try {
    const response = await axios.post(uploadUrl, form, {
      headers: { ...form.getHeaders() },
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: () => true
    });

    console.log("📡 Upload HTTP:", response.status);
    return response.data;
  } catch (error) {
    console.error("❌ خطا در آپلود فایل:", error.message);
    throw error;
  }
}

async function sendFile(chatId, fileId, caption = "") {
  console.log("📤 ارسال فایل به روبیکا...", fileId);

  try {
    const response = await axios.post(
      `${RUBIKA_BASE}/sendFile`,
      { chat_id: chatId, file_id: String(fileId), text: caption },
      { timeout: 60000 }
    );

    if (response.data?.status && response.data.status !== "OK") {
      throw new Error(response.data?.message || response.data?.status || "sendFile failed");
    }

    return response.data;
  } catch (error) {
    console.error("❌ خطا در sendFile:", error.response?.data || error.message);
    throw error;
  }
}

async function getUpdates() {
  const body = { limit: 10 };
  if (offsetId) body.offset_id = offsetId;

  const response = await axios.post(`${RUBIKA_BASE}/getUpdates`, body, { timeout: 60000 });
  return response.data;
}

// ============================================================
// SEND GENERATED IMAGE PIPELINE
// ============================================================

async function sendGeneratedImage(chatId, imageBase64) {
  const buffer = Buffer.from(imageBase64, "base64");
  fs.writeFileSync(GENERATED_IMAGE_FILE, buffer);
  console.log("💾 تصویر ذخیره شد:", GENERATED_IMAGE_FILE);

  try {
    const uploadInfo = await requestSendFile();
    const uploadResult = await uploadFile(GENERATED_IMAGE_FILE, uploadInfo);

    const fileId =
      uploadResult?.data?.file_id ||
      uploadResult?.file_id ||
      uploadResult?.id;

    if (!fileId) throw new Error("file_id پیدا نشد");

    await sendFile(chatId, fileId, "✨ تصویر ساخته‌شده توسط سیباچت");
    console.log("✅ تصویر ارسال شد");
  } finally {
    try {
      if (fs.existsSync(GENERATED_IMAGE_FILE)) {
        fs.unlinkSync(GENERATED_IMAGE_FILE);
      }
    } catch (_) {}
  }
}

// ============================================================
// PROCESS MESSAGE
// ============================================================

async function processMessage(chatId, userText) {
  const imageRequest = isImageRequest(userText);
  console.log("🔍 IMAGE CHECK:", imageRequest);
  console.log("USER TEXT DEBUG:", JSON.stringify(userText));

  // ===================== IMAGE MODE =====================
  if (imageRequest) {
    console.log("🔥 IMAGE MODE");

    try {
      await sendMessage(chatId, "🎨 درخواست تصویر شناسایی شد...\n\n⏳ در حال آماده‌سازی تصویر");

      const imagePrompt = await createImagePrompt(userText);
      console.log("🖼 Prompt نهایی:", imagePrompt);

      await sendMessage(chatId, "✨ پرامپت آماده شد.\n\n🧠 در حال تولید تصویر...");

      const imageBase64 = await generateImage(imagePrompt);
      console.log("✅ تولید تصویر موفق بود");

      await sendMessage(chatId, "📦 تصویر ساخته شد؛ در حال ارسال به روبیکا...");
      await sendGeneratedImage(chatId, imageBase64);
      await sendMessage(chatId, "✅ تصویر با موفقیت ارسال شد! 🎉");
    } catch (error) {
      console.error("❌ IMAGE ERROR:", error.response?.data || error.message);
      try {
        await sendMessage(chatId, "❌ در تولید یا ارسال تصویر مشکلی پیش آمد.\n\nلطفاً دوباره امتحان کن.");
      } catch (_) {}
    }
    return;
  }

  // ===================== CHAT MODE =====================
  try {
    await sendMessage(chatId, "⏳ در حال فکر کردن...");
    const answer = await askAI(userText);
    console.log("🧠 پاسخ SIBA:", answer);
    await sendMessage(chatId, answer);
    console.log("📤 پاسخ ارسال شد");
  } catch (error) {
    console.error("❌ AI ERROR:", error.response?.data || error.message);
    try {
      await sendMessage(chatId, "❌ در پردازش درخواست مشکلی پیش آمد.\n\nدوباره امتحان کن.");
    } catch (_) {}
  }
}

// ============================================================
// START BOT
// ============================================================

async function startBot() {
  console.log("🤖 سیباچت در حال اجراست...");

  // Drain old messages on startup
  let initialized = false;
  while (!initialized) {
    try {
      const result = await getUpdates();

      if (result?.status !== "OK") {
        console.log("⚠️ Startup getUpdates:", JSON.stringify(result, null, 2));
        await sleep(3000);
        continue;
      }

      const updates = result.data?.updates || [];
      const nextOffsetId = result.data?.next_offset_id || null;

      if (nextOffsetId) {
        offsetId = nextOffsetId;
        saveOffset(offsetId);
      }

      if (updates.length === 0) {
        initialized = true;
        console.log("✅ صف پیام‌های قبلی خالی شد.");
        console.log("🟢 سیباچت از این لحظه پیام‌های جدید را پردازش می‌کند.");
      } else {
        console.log(`⏭ ${updates.length} پیام قدیمی رد شد.`);
      }
    } catch (error) {
      console.error("❌ خطا هنگام پاک‌سازی صف قدیمی:", error.response?.data || error.message);
      await sleep(3000);
    }
  }

  // Main polling loop
  while (true) {
    try {
      const result = await getUpdates();

      if (result?.status !== "OK") {
        console.log("⚠️ getUpdates:", JSON.stringify(result, null, 2));
        await sleep(3000);
        continue;
      }

      const updates = result.data?.updates || [];
      const nextOffsetId = result.data?.next_offset_id || null;

      if (nextOffsetId) {
        offsetId = nextOffsetId;
        saveOffset(offsetId);
      }

      if (updates.length === 0) continue;

      for (const update of updates) {
        if (update.type !== "NewMessage") continue;

        const chatId = update.chat_id;
        const userText = update.new_message?.text?.trim();

        if (!chatId || !userText) continue;

        console.log(`📩 پیام جدید: ${userText}`);

        processMessage(chatId, userText).catch((error) => {
          console.error("❌ خطای پردازش پیام:", error.response?.data || error.message);
          sendMessage(chatId, "❌ در پردازش پیام مشکلی پیش آمد.").catch(() => {});
        });
      }
    } catch (error) {
      console.error("❌ خطا در دریافت پیام‌ها:", error.response?.data || error.message);
      await sleep(3000);
    }
  }
}

// ============================================================
// RUN
// ============================================================

startBot();