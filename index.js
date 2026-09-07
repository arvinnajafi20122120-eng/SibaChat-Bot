require("dotenv").config();
const axios = require("axios");

const rubikaToken = process.env.RUBIKA_BOT_TOKEN;
const baiApiKey = process.env.BAI_API_KEY;

if (!rubikaToken) {
  console.error("❌ RUBIKA_BOT_TOKEN در .env پیدا نشد");
  process.exit(1);
}

if (!baiApiKey) {
  console.error("❌ BAI_API_KEY در .env پیدا نشد");
  process.exit(1);
}

const rubikaBase = `https://botapi.rubika.ir/v3/${rubikaToken}`;

let offsetId = null;

async function askQwen(userMessage) {
  const response = await axios.post(
    "https://api.b.ai/v1/chat/completions",
    {
      model: "qwen3.8-flash",
      messages: [
        {
          role: "system",
          content:
            "تو سیباچت هستی؛ یک دستیار هوش مصنوعی فارسی‌زبان، دوستانه، دقیق و مفید. پاسخ‌ها را واضح و طبیعی بده."
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
      timeout: 60000
    }
  );

  return response.data.choices?.[0]?.message?.content || "نتونستم پاسخ مناسبی تولید کنم.";
}

async function sendMessage(chatId, text) {
  await axios.post(`${rubikaBase}/sendMessage`, {
    chat_id: chatId,
    text: text
  });
}

async function getUpdates() {
  const body = {
    limit: 10
  };

  if (offsetId) {
    body.offset_id = offsetId;
  }

  const response = await axios.post(
    `${rubikaBase}/getUpdates`,
    body
  );

  return response.data;
}

async function startBot() {
  console.log("🤖 سیباچت در حال اجراست...");

  while (true) {
    try {
      const result = await getUpdates();

      if (result?.status !== "OK") {
        console.log("⚠️ پاسخ نامعتبر از روبیکا:", result);
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }

      const updates = result.data?.updates || [];

      if (result.data?.next_offset_id) {
        offsetId = result.data.next_offset_id;
      }

      for (const update of updates) {
        if (update.type !== "NewMessage") {
          continue;
        }

        const chatId = update.chat_id;
        const message = update.new_message;
        const userText = message?.text?.trim();

        if (!chatId || !userText) {
          continue;
        }

        console.log(`📩 پیام: ${userText}`);

        try {
          await sendMessage(chatId, "⏳ در حال فکر کردن...");

          const answer = await askQwen(userText);

          await sendMessage(chatId, answer);

          console.log(`📤 پاسخ: ${answer}`);
        } catch (error) {
          console.error(
            "❌ خطا در AI یا ارسال:",
            error.response?.data || error.message
          );

          await sendMessage(
            chatId,
            "متأسفانه الان در پردازش پیام مشکلی پیش اومد. دوباره امتحان کن."
          );
        }
      }

    } catch (error) {
      console.error(
        "❌ خطا در دریافت پیام‌ها:",
        error.response?.data || error.message
      );

      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

startBot();