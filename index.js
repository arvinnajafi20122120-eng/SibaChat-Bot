require("dotenv").config();

const FormData = require("form-data");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
// ============================================================
// ENV
// ============================================================

const rubikaToken = process.env.RUBIKA_BOT_TOKEN;
const baiApiKey = process.env.BAI_API_KEY;
const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;

if (!rubikaToken) {
  console.error("❌ RUBIKA_BOT_TOKEN تنظیم نشده");
  process.exit(1);
}

if (!baiApiKey) {
  console.error("❌ BAI_API_KEY تنظیم نشده");
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
// CONFIG
// ============================================================

const rubikaBase = `https://botapi.rubika.ir/v3/${rubikaToken}`;

const OFFSET_FILE = path.join(__dirname, "offset.json");
const GENERATED_IMAGE_FILE = path.join(__dirname, "generated.png");

let offsetId = null;

// ============================================================
// OFFSET
// ============================================================

try {
  if (fs.existsSync(OFFSET_FILE)) {
    offsetId = fs.readFileSync(OFFSET_FILE, "utf8").trim() || null;

    if (offsetId) {
      console.log("♻️ Offset قبلی بازیابی شد");
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
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

// ============================================================
// IMAGE REQUEST DETECTION
// ============================================================

function isImageRequest(text) {
  const value = safeString(text).trim().toLowerCase();

  if (!value) {
    return false;
  }

  const patterns = [
    "/image",
    "/img",
    "/photo",

    "generate image",
    "create image",
    "make an image",
    "make image",
    "generate a picture",
    "create a picture",
    "make a picture",
    "generate picture",
    "create picture",

    "عکس بساز",
    "تصویر بساز",
    "یه عکس بساز",
    "یک عکس بساز",
    "یه تصویر بساز",
    "یک تصویر بساز",

    "عکس تولید کن",
    "تصویر تولید کن",
    "عکس ایجاد کن",
    "تصویر ایجاد کن",

    "عکس درست کن",
    "تصویر درست کن",

    "عکس بکش",
    "تصویر بکش",

    "ساخت عکس",
    "ساخت تصویر",
    "تصویرسازی",

    "یه عکس",
    "یک عکس",
    "یه تصویر",
    "یک تصویر",

    "رندر بساز",
    "رندر کن"
  ];

  return patterns.some((pattern) => value.includes(pattern));
}

// ============================================================
// EXTRACT IMAGE PROMPT
// ============================================================

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

  prompt = prompt.replace(/\s+/g, " ").trim();

  return prompt;
}

// ============================================================
// SIMPLE ENGLISH DETECTION
// ============================================================

function looksMostlyEnglish(text) {
  const value = safeString(text);

  if (!value) {
    return false;
  }

  const englishChars = (value.match(/[a-zA-Z]/g) || []).length;
  const persianChars = (value.match(/[\u0600-\u06FF]/g) || []).length;

  return englishChars > 5 && englishChars >= persianChars * 2;
}

// ============================================================
// QWEN IMAGE PROMPT
// ============================================================

async function createImagePrompt(userText) {
  const directPrompt = extractImagePrompt(userText);

  if (!directPrompt) {
    return "A high quality cinematic image, professional composition, detailed lighting";
  }

  // اگر درخواست از قبل انگلیسی باشد، مستقیم استفاده می‌کنیم
  if (looksMostlyEnglish(directPrompt)) {
    return directPrompt;
  }

  console.log("📝 تبدیل درخواست فارسی به Prompt انگلیسی...");

  try {
    const response = await axios.post(
      "https://api.b.ai/v1/chat/completions",
      {
        model: "qwen3.8-flash",

        messages: [
          {
            role: "system",
            content: `
You are an expert AI image prompt engineer.

Convert the user's Persian image request into ONE excellent English image-generation prompt.

Rules:
- Output ONLY the final English prompt.
- Do not explain anything.
- Do not mention AI, APIs, prompts, or limitations.
- Make the image visually rich and precise.
- Preserve the user's main idea.
- Add useful details about composition, lighting, materials, camera, atmosphere and quality when appropriate.
- Never replace the user's subject with something unrelated.
`
          },

          {
            role: "user",
            content: directPrompt
          }
        ]
      },

      {
        headers: {
          Authorization: `Bearer ${baiApiKey}`,
          "Content-Type": "application/json"
        },

        timeout: 30000
      }
    );

    const result =
      response.data?.choices?.[0]?.message?.content?.trim();

    if (result) {
      console.log("✅ Prompt انگلیسی ساخته شد");
      return result;
    }

    console.log("⚠️ Qwen پرامپت خالی برگرداند");
  } catch (error) {
    console.error(
      "⚠️ خطا در ساخت Prompt:",
      error.response?.data || error.message
    );
  }

  // fallback
  return `${directPrompt}, high quality 3D render, cinematic lighting, professional composition, highly detailed`;
}

// ============================================================
// FLUX IMAGE GENERATION
// ============================================================

async function generateImage(prompt) {
  console.log("🎨 ساخت تصویر با FLUX.2...");
  console.log("🖼 Prompt:", prompt);

  const FormData = require("form-data");
  const form = new FormData();

  form.append("prompt", prompt);
  form.append("width", "1024");
  form.append("height", "1024");

  const response = await axios.post(
    `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`,
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
    console.error(
      "❌ Cloudflare Error:",
      JSON.stringify(response.data, null, 2)
    );

    throw new Error("Cloudflare image generation failed");
  }

  const image = response.data?.result?.image;

  if (!image) {
    throw new Error("تصویر از Cloudflare دریافت نشد.");
  }

  console.log("✅ تصویر از Cloudflare دریافت شد");
  console.log("📦 Base64:", image.length);

  return image;
}

// ============================================================
// QWEN CHAT
// ============================================================

async function askQwen(userMessage) {
  await sleep(1000);

  const response = await axios.post(
    "https://api.b.ai/v1/chat/completions",
    {
      model: "qwen3.8-flash",

      messages: [
        {
          role: "system",
          content: `
تو «سیباچت» هستی؛ یک دستیار هوش مصنوعی فارسی‌زبان داخل روبیکا.

قوانین:
- فارسی و طبیعی پاسخ بده.
- دقیق و مفید باش.
- خودت را GPT یا ChatGPT معرفی نکن.
- اگر درباره مدل سؤال شد، بگو موتور گفت‌وگوی سیباچت بر پایه Qwen اجرا می‌شود.
- اگر کاربر درخواست تولید تصویر داد، این پیام نباید به این بخش برسد.
- پاسخ‌ها را تا حد امکان خوانا و مرتب بنویس.
`
        },

        {
          role: "user",
          content: userMessage
        }
      ]
    },

    {
      headers: {
        Authorization: `Bearer ${baiApiKey}`,
        "Content-Type": "application/json"
      },

      timeout: 180000
    }
  );

  const answer =
    response.data?.choices?.[0]?.message?.content?.trim();

  return answer || "نتونستم پاسخ مناسبی تولید کنم.";
}

// ============================================================
// RUBIKA SEND MESSAGE
// ============================================================

async function sendMessage(chatId, text) {
  const response = await axios.post(
    `${rubikaBase}/sendMessage`,
    {
      chat_id: chatId,
      text: safeString(text)
    },
    {
      timeout: 30000
    }
  );

  if (
    response.data?.status &&
    response.data.status !== "OK"
  ) {
    throw new Error(
      response.data?.message ||
      response.data?.status ||
      "sendMessage failed"
    );
  }

  return response.data;
}

// ============================================================
// RUBIKA REQUEST SEND FILE
// ============================================================
async function requestSendFile() {

  console.log("📤 درخواست آپلود فایل...");

  const response = await axios.post(
    `${rubikaBase}/requestSendFile`,
    {
      type: "Image"
    },
    {
      timeout: 60000
    }
  );

  console.log(
    "📡 پاسخ requestSendFile:",
    JSON.stringify(response.data, null, 2)
  );

  if (response.data?.status !== "OK") {
    throw new Error(
      "requestSendFile failed: " +
      JSON.stringify(response.data)
    );
  }

  return response.data;
}


// ============================================================
// RUBIKA UPLOAD FILE
// ============================================================

async function uploadFile(filePath, uploadInfo) {

  const fileBuffer = fs.readFileSync(filePath);

  const uploadUrl =
    uploadInfo?.data?.upload_url;

  if (!uploadUrl) {
    throw new Error("upload_url پیدا نشد");
  }


  console.log("⬆️ آپلود multipart به روبیکا...");


  const form = new FormData();

  form.append(
    "file",
    fileBuffer,
    {
      filename: path.basename(filePath),
      contentType: "image/png"
    }
  );


  const response = await axios.post(
    uploadUrl,
    form,
    {
      headers: {
        ...form.getHeaders()
      },

      timeout:120000,

      maxContentLength: Infinity,
      maxBodyLength: Infinity,

      validateStatus: () => true
    }
  );


  console.log(
    "📡 HTTP:",
    response.status
  );

  console.log(
    "📡 Upload:",
    JSON.stringify(
      response.data,
      null,
      2
    )
  );


  return response.data;
}
// ============================================================
// RUBIKA SEND FILE
// ============================================================

async function sendFile(
  chatId,
  fileId,
  caption = ""
) {
  console.log("📤 ارسال فایل به روبیکا...");
  console.log("🆔 file_id:", fileId);

  const response = await axios.post(
    `${rubikaBase}/sendFile`,
    {
      chat_id: chatId,
      file_id: String(fileId),
      text: caption
    },
    {
      timeout: 60000
    }
  );

  console.log("📡 پاسخ sendFile:");
  console.log(
    JSON.stringify(response.data, null, 2)
  );

  if (
    response.data?.status &&
    response.data.status !== "OK"
  ) {
    throw new Error(
      response.data?.message ||
      response.data?.status ||
      "sendFile failed"
    );
  }

  return response.data;
}

// ============================================================
// SAVE + UPLOAD + SEND GENERATED IMAGE
// ============================================================
async function sendGeneratedImage(
  chatId,
  imageBase64
) {

  const buffer = Buffer.from(
    imageBase64,
    "base64"
  );


  fs.writeFileSync(
    GENERATED_IMAGE_FILE,
    buffer
  );


  console.log(
    "💾 تصویر ذخیره شد:",
    GENERATED_IMAGE_FILE
  );


  try {

    const uploadInfo =
      await requestSendFile();


    const uploadResult =
      await uploadFile(
        GENERATED_IMAGE_FILE,
        uploadInfo
      );


    console.log(
      "📦 نتیجه آپلود:",
      JSON.stringify(
        uploadResult,
        null,
        2
      )
    );


    const fileId =
      uploadResult?.data?.file_id ||
      uploadResult?.file_id ||
      uploadResult?.id;


    if (!fileId) {

      throw new Error(
        "file_id پیدا نشد"
      );

    }


    await sendFile(
      chatId,
      fileId,
      "✨ تصویر ساخته‌شده توسط سیباچت"
    );


    console.log(
      "✅ تصویر ارسال شد"
    );


  } catch(error) {

    console.error(
      "❌ ارسال تصویر:",
      error.message
    );

    throw error;


  } finally {

    try {

      if(
        fs.existsSync(
          GENERATED_IMAGE_FILE
        )
      ){

        fs.unlinkSync(
          GENERATED_IMAGE_FILE
        );

      }

    } catch(e){}

  }
}
      

// ============================================================
// GET UPDATES
// ============================================================

async function getUpdates() {
  const body = {
    limit: 10
  };

  if (offsetId) {
    body.offset_id = offsetId;
  }

  const response = await axios.post(
    `${rubikaBase}/getUpdates`,
    body,
    {
      timeout: 60000
    }
  );

  return response.data;
}

// ============================================================
// PROCESS MESSAGE
// ============================================================

async function processMessage(
  chatId,
  userText
) {
  const imageRequest =
    isImageRequest(userText);

  console.log(
    "🔍 IMAGE CHECK:",
    imageRequest
  );

  // ==========================================================
  // IMAGE MODE
  // ==========================================================

  if (imageRequest) {
    console.log("🔥 IMAGE MODE");

    try {
      await sendMessage(
        chatId,
        "🎨 درخواست تصویر شناسایی شد...\n\n⏳ در حال آماده‌سازی تصویر"
      );

      // ------------------------------------------------------
      // Prompt
      // ------------------------------------------------------

      const imagePrompt =
        await createImagePrompt(
          userText
        );

      console.log(
        "🖼 Prompt نهایی:"
      );

      console.log(
        imagePrompt
      );

      await sendMessage(
        chatId,
        "✨ پرامپت آماده شد.\n\n🧠 در حال تولید تصویر..."
      );

      // ------------------------------------------------------
      // FLUX
      // ------------------------------------------------------

      const imageBase64 =
        await generateImage(
          imagePrompt
        );

      console.log(
        "✅ تولید تصویر موفق بود"
      );

      await sendMessage(
        chatId,
        "📦 تصویر ساخته شد؛ در حال ارسال به روبیکا..."
      );

      // ------------------------------------------------------
      // Rubika
      // ------------------------------------------------------

      await sendGeneratedImage(
        chatId,
        imageBase64
      );

      await sendMessage(
        chatId,
        "✅ تصویر با موفقیت ارسال شد! 🎉"
      );

      return;
    } catch (error) {
      console.error(
        "❌ IMAGE ERROR:"
      );

      console.error(
        error.response?.data ||
        error.message
      );

      try {
        await sendMessage(
          chatId,
          "❌ در تولید یا ارسال تصویر مشکلی پیش آمد.\n\nلطفاً دوباره امتحان کن."
        );
      } catch (_) {}

      return;
    }
  }

  // ==========================================================
  // NORMAL CHAT MODE
  // ==========================================================

  try {
    await sendMessage(
      chatId,
      "⏳ در حال فکر کردن..."
    );

    const answer =
      await askQwen(
        userText
      );

    console.log(
      "🧠 پاسخ Qwen:",
      answer
    );

    await sendMessage(
      chatId,
      answer
    );

    console.log(
      "📤 پاسخ ارسال شد"
    );
  } catch (error) {
    console.error(
      "❌ QWEN ERROR:"
    );

    console.error(
      error.response?.data ||
      error.message
    );

    try {
      await sendMessage(
        chatId,
        "❌ در پردازش درخواست مشکلی پیش آمد.\n\nدوباره امتحان کن."
      );
    } catch (_) {}
  }
}

// ============================================================
// START BOT
// ============================================================

async function startBot() {
  console.log(
    "🤖 سیباچت در حال اجراست..."
  );

  while (true) {
    try {
      const result =
        await getUpdates();

      if (
        result?.status !== "OK"
      ) {
        console.log(
          "⚠️ getUpdates:",
          JSON.stringify(
            result,
            null,
            2
          )
        );

        await sleep(3000);

        continue;
      }

      const updates =
        result.data?.updates || [];

      // ------------------------------------------------------
      // ذخیره offset جدید
      // ------------------------------------------------------

      if (
        result.data?.next_offset_id
      ) {
        offsetId =
          result.data.next_offset_id;

        saveOffset(
          offsetId
        );
      }

      // ------------------------------------------------------
      // پردازش پیام‌ها
      // ------------------------------------------------------

      for (
        const update of updates
      ) {
        if (
          update.type !==
          "NewMessage"
        ) {
          continue;
        }

        const chatId =
          update.chat_id;

        const userText =
          update.new_message?.text
            ?.trim();

        if (
          !chatId ||
          !userText
        ) {
          continue;
        }

        console.log(
          `📩 پیام: ${userText}`
        );

        try {
          await processMessage(
            chatId,
            userText
          );
        } catch (error) {
          console.error(
            "❌ خطای پردازش پیام:",
            error.message
          );
        }
      }
    } catch (error) {
      console.error(
        "❌ خطا در دریافت پیام‌ها:"
      );

      console.error(
        error.response?.data ||
        error.message
      );

      await sleep(3000);
    }
  }
}

// ============================================================
// RUN
// ============================================================

startBot();